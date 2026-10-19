import { expect, test } from "bun:test";
import { fetchOpenCodeGoSubscriptionUsage } from "../../src/server/opencode-go-subscription-usage.ts";

function usage(monthly: "ok" | "rate-limited" = "ok") {
  return {
    usage: {
      rolling: { status: "ok", percent: 25, resetsAt: "2026-10-19T15:00:00.000Z" },
      weekly: { status: "ok", percent: 40, resetsAt: "2026-10-26T00:00:00.000Z" },
      monthly: { status: monthly, percent: monthly === "ok" ? 60 : 100, resetsAt: "2026-11-01T00:00:00.000Z" },
    },
  };
}

test("OpenCode Go shows its five-hour and weekly limits, read with the API key", async () => {
  const reported = await fetchOpenCodeGoSubscriptionUsage("go-key", async (url, init) => {
    expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer go-key");
    return Response.json(usage());
  });
  expect(reported).toMatchObject({ allowed: true, limitReached: false });
  expect(reported.windows).toEqual([
    { limitName: "5-hour", meteredFeature: null, kind: "primary", usedPercent: 25, durationSeconds: 5 * 3600, resetsAt: "2026-10-19T15:00:00.000Z" },
    { limitName: "Weekly", meteredFeature: null, kind: "secondary", usedPercent: 40, durationSeconds: 7 * 86400, resetsAt: "2026-10-26T00:00:00.000Z" },
  ]);
});

test("a spent monthly OpenCode Go limit is reported as reached", async () => {
  expect(await fetchOpenCodeGoSubscriptionUsage("go-key", async () => Response.json(usage("rate-limited")))).toMatchObject({ allowed: false, limitReached: true });
});

test("OpenCode Go explains rejected keys and keys without a Go subscription", async () => {
  await expect(fetchOpenCodeGoSubscriptionUsage("go-key", async () => new Response("", { status: 401 }))).rejects.toThrow("Reconnect OpenCode Go");
  await expect(fetchOpenCodeGoSubscriptionUsage("go-key", async () => new Response("", { status: 403 }))).rejects.toThrow("doesn’t have an OpenCode Go subscription");
});

test("unrecognized OpenCode Go usage responses are errors", async () => {
  await expect(fetchOpenCodeGoSubscriptionUsage("go-key", async () => Response.json({ usage: {} }))).rejects.toThrow("unrecognized");
  const badReset = usage();
  badReset.usage.weekly.resetsAt = "soon";
  await expect(fetchOpenCodeGoSubscriptionUsage("go-key", async () => Response.json(badReset))).rejects.toThrow("unrecognized");
});
