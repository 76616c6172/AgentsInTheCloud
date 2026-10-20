import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Pi stores one credential per provider (see accounts.ts), so an OAuth credential means the provider is connected only through a subscription. */
export async function usesProviderSubscription(runtime: Pick<ModelRuntime, "listCredentials">, provider: string): Promise<boolean> {
  return (await runtime.listCredentials()).some((credential) => credential.providerId === provider && credential.type === "oauth");
}

/** Subscription CLI agents cannot run on an API key; send the user to that provider's subscription setup. */
export async function requireProviderSubscription(runtime: Pick<ModelRuntime, "listCredentials">, provider: string, agentLabel: string): Promise<void> {
  if (!await usesProviderSubscription(runtime, provider)) {
    throw new AgentsInTheCloudCoreError("agent_setup_required", `Connect a ${agentLabel} subscription before creating a ${agentLabel} agent.`, { setupUrl: `/models?connect=${provider}` });
  }
}
