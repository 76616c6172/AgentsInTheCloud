import { ModelsError } from "@earendil-works/pi-ai";
import { SubscriptionUsageError, type SubscriptionUsage } from "./subscription-usage.ts";
import { anthropicUsageSource } from "./anthropic-subscription-usage.ts";
import { usageWindowTiming, type PacedUsageWindow } from "./usage-window.ts";
import { fetchCodexSubscriptionUsage } from "./codex-subscription-usage.ts";
import { fetchXaiSubscriptionUsage } from "./xai-subscription-usage.ts";
import { fetchRadiusUsage } from "./radius-usage.ts";
import { fetchGitHubCopilotSubscriptionUsage } from "./github-copilot-subscription-usage.ts";
import { fetchOpenCodeGoSubscriptionUsage } from "./opencode-go-subscription-usage.ts";
import { cheapestProviderModel, createPiModelRuntime, readStoredPiCredential } from "./pi-config-models.ts";
import type { AuthResult } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Only providers with implemented subscription adapters appear in the overview.
// Radius reports a credit balance without allowance windows, so it never drives the usage button.
// `credential` is what carries the limits: a subscription sign-in, or for OpenCode Go, its API key.
export const supportedUsageProviders = [
  { id: "anthropic", label: "Anthropic", credential: "oauth" },
  { id: "openai-codex", label: "ChatGPT / Codex", credential: "oauth" },
  { id: "xai", label: "xAI", credential: "oauth" },
  { id: "radius", label: "Radius", credential: "oauth" },
  { id: "github-copilot", label: "GitHub Copilot", credential: "oauth" },
  { id: "opencode-go", label: "OpenCode Go", credential: "api_key" },
] as const;
export type UsageProvider = typeof supportedUsageProviders[number];

/** Whether this connection is the kind that has usage limits, e.g. not an API key standing in for a subscription. */
export function hasUsageLimits(provider: UsageProvider, auth: AuthResult | undefined): boolean {
  return !!auth && (provider.credential === "api_key" || auth.source === "OAuth");
}
type UsageRequest = { runtime: ModelRuntime; refresh: boolean };
const subscriptionAdapters = {
  // Codex reports usage cheaply on every request, so it is always current.
  "openai-codex": (token) => fetchCodexSubscriptionUsage(token),
  xai: (token) => fetchXaiSubscriptionUsage(token),
  radius: (token) => fetchRadiusUsage(token),
  "opencode-go": (token) => fetchOpenCodeGoSubscriptionUsage(token),
  // The usage check needs the GitHub sign-in behind the Copilot token, which getAuth has just refreshed.
  "github-copilot": async () => {
    const credential = readStoredPiCredential("github-copilot");
    if (credential?.type !== "oauth") throw new SubscriptionUsageError("GitHub Copilot credentials are unavailable. Reconnect GitHub Copilot.");
    return fetchGitHubCopilotSubscriptionUsage(credential);
  },
  anthropic: (token, { runtime, refresh }) => {
    const model = cheapestProviderModel(runtime, "anthropic");
    if (!model) throw new Error("Anthropic has no models to check subscription usage with.");
    return anthropicUsageSource.usage(token, { model: model.id, refresh });
  },
} satisfies Record<UsageProvider["id"], (token: string, request: UsageRequest) => Promise<SubscriptionUsage>>;

/** Frames for one provider's usage; the scope keeps two lists of the same providers on one page apart. */
export function providerUsageFrameId(view: "rings" | "limits", provider: string, scope: string): string {
  return `usage_provider_${view}_${scope}_${provider}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export interface ProviderUsageOverview {
  provider: UsageProvider;
  connected: boolean;
  reported: SubscriptionUsage | null;
  error: string | null;
  windows: PacedUsageWindow[];
}

export async function connectedUsageProviders(): Promise<UsageProvider[]> {
  const runtime = await createPiModelRuntime();
  return supportedUsageProviders.filter((provider) => runtime.getProviderAuthStatus(provider.id).configured);
}

/** `refresh` asks the provider now instead of reusing what AgentsInTheCloud already knows. */
export async function getProviderUsageOverview(provider: UsageProvider, options: { refresh?: boolean } = {}): Promise<ProviderUsageOverview> {
  let reported: SubscriptionUsage | null = null;
  let error: string | null = null;
  const runtime = await createPiModelRuntime();
  const connected = runtime.getProviderAuthStatus(provider.id).configured;
  if (connected) {
    try {
      // Pi owns credential storage and serialized OAuth refresh.
      const auth = await runtime.getAuth(provider.id, { signal: AbortSignal.timeout(10_000) });
      if (!auth?.auth.apiKey) throw new SubscriptionUsageError(`${provider.label} credentials are unavailable. Reconnect ${provider.label}.`);
      if (!hasUsageLimits(provider, auth)) throw new SubscriptionUsageError(`${provider.label} subscription usage requires OAuth sign-in, not an API key. Reconnect ${provider.label} with your subscription.`);
      reported = await subscriptionAdapters[provider.id](auth.auth.apiKey, { runtime, refresh: options.refresh ?? false });
    } catch (cause) {
      if (cause instanceof ModelsError && cause.code === "oauth") {
        error = `${provider.label} sign-in could not be refreshed. Try again or reconnect ${provider.label}.`;
      } else if (cause instanceof SubscriptionUsageError) {
        error = cause.message;
      } else {
        throw cause;
      }
    }
  }
  const windows = reported ? reported.windows.map((window) => ({
    reported: window,
    timing: usageWindowTiming(window, new Date(reported.checkedAt)),
  })) : [];
  return { provider, connected, reported, error, windows };
}
