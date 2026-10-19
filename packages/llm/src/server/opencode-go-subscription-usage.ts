import { Type } from "typebox";
import { requestSubscriptionUsage, readSubscriptionUsageJson, subscriptionUsageMessages, SubscriptionUsageError, type Fetcher, type SubscriptionUsage } from "./subscription-usage.ts";

const windowSchema = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("rate-limited")]),
  percent: Type.Number({ minimum: 0, maximum: 100 }),
  resetsAt: Type.String(),
});
const payloadSchema = Type.Object({ usage: Type.Object({ rolling: windowSchema, weekly: windowSchema, monthly: windowSchema }) });

/** Go reads usage with the same API key it runs inference on.
 * The monthly limit still counts toward availability, but without its period start it can't be paced, so it isn't a window. */
export async function fetchOpenCodeGoSubscriptionUsage(apiKey: string, fetcher: Fetcher = fetch): Promise<SubscriptionUsage> {
  const messages = subscriptionUsageMessages("OpenCode Go");
  const response = await requestSubscriptionUsage("https://opencode.ai/zen/go/v1/usage", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  }, messages.unreachable, fetcher);
  if (response.status === 401) throw new SubscriptionUsageError(messages.rejected);
  if (response.status === 403) throw new SubscriptionUsageError("This API key doesn’t have an OpenCode Go subscription. Check your subscription in OpenCode Console.");
  if (!response.ok) throw new SubscriptionUsageError(messages.unavailable(response.status));
  const { usage } = await readSubscriptionUsageJson(response, payloadSchema, messages);
  const windows = ([["rolling", "5-hour", 5 * 3600, "primary"], ["weekly", "Weekly", 7 * 86400, "secondary"]] as const).map(([key, limitName, durationSeconds, kind]) => {
    const reset = new Date(usage[key].resetsAt).getTime();
    if (!Number.isFinite(reset)) throw new SubscriptionUsageError(messages.unrecognized);
    return { limitName, meteredFeature: null, kind, usedPercent: usage[key].percent, durationSeconds, resetsAt: new Date(reset).toISOString() };
  });
  const limitReached = Object.values(usage).some((window) => window.status === "rate-limited");
  return { plan: null, checkedAt: new Date().toISOString(), allowed: !limitReached, limitReached, windows };
}
