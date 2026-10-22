import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import type { JsonRepresentation } from "@earendil-works/chord";
import { acceptablePromptSuggestion, addModelUsage, promptSuggestionDue, promptSuggestionEligible, promptSuggestionMissedCache, subscriptionNearLimit } from "../../src/server/prompt-suggestion.ts";

function usage(input: number, cacheRead: number, output = 20): Usage {
  return { input, output, cacheRead, cacheWrite: 0, totalTokens: input + cacheRead + output, cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 } };
}

function reply(stopReason: AssistantMessage["stopReason"], used = usage(200, 12_000)): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "Done." }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6.1-sol", usage: used, stopReason, timestamp: 0 };
}

const prompt = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });

describe("prompt suggestion eligibility", () => {
  test("waits for the second prompt", () => {
    expect(promptSuggestionEligible([prompt("Write hello.py"), reply("stop")])).toBe(false);
    expect(promptSuggestionEligible([prompt("Write hello.py"), reply("stop"), prompt("Take a name"), reply("stop")])).toBe(true);
  });

  test("skips turns that failed, stopped or would mostly miss the cache", () => {
    const earlier = [prompt("Write hello.py"), reply("stop"), prompt("Take a name")];
    expect(promptSuggestionEligible([...earlier, reply("error")])).toBe(false);
    expect(promptSuggestionEligible([...earlier, reply("aborted")])).toBe(false);
    expect(promptSuggestionEligible([...earlier, reply("stop", usage(12_000, 0))])).toBe(false);
  });

  test("a suggestion that mostly paid full price missed the cache", () => {
    expect(promptSuggestionMissedCache(usage(177, 12_416))).toBe(false);
    expect(promptSuggestionMissedCache(usage(12_647, 0))).toBe(true);
  });

  test("backs off after three ignored suggestions until one is used", () => {
    expect(promptSuggestionDue(2, 0)).toBe(true);
    expect([1, 2, 3, 4, 5, 6].map(turn => promptSuggestionDue(3, turn))).toEqual([false, false, true, false, false, true]);
  });

  test("a subscription near its limit keeps the rest for real prompts", () => {
    const window = (usedPercent: number) => ({ limitName: "5h", meteredFeature: null, kind: "primary" as const, usedPercent, durationSeconds: 18_000, resetsAt: null });
    const reported = (usedPercent: number, limitReached = false) => ({ reported: { plan: "pro", checkedAt: "", allowed: true, limitReached, windows: [window(usedPercent)] } });
    expect(subscriptionNearLimit(reported(40))).toBe(false);
    expect(subscriptionNearLimit(reported(92))).toBe(true);
    expect(subscriptionNearLimit(reported(10, true))).toBe(true);
    expect(subscriptionNearLimit({ reported: null })).toBe(false);
  });
});

describe("prompt suggestion replies", () => {
  test("keeps short prompts the user might type", () => {
    expect(acceptablePromptSuggestion("  run the tests ")).toBe("run the tests");
    expect(acceptablePromptSuggestion("\"Now make it read the name from the command line.\"")).toBe("Now make it read the name from the command line.");
    expect(acceptablePromptSuggestion("yes")).toBe("yes");
    expect(acceptablePromptSuggestion("/review")).toBe("/review");
  });

  test("drops silence, meta talk, praise, questions and the Agent's own voice", () => {
    for (const text of ["", "Nothing to suggest", "(silence)", "Looks good, thanks", "Can you add tests?", "Let me run the tests", "Suggestion: run the tests", "Run the tests. Then commit.", "**run the tests**", "maybe", "one two three four five six seven eight nine ten eleven twelve thirteen"]) {
      expect(acceptablePromptSuggestion(text)).toBeUndefined();
    }
  });
});

describe("prompt suggestion usage", () => {
  test("adds to the model's usage as pi-durable records responses", () => {
    const models: Record<string, JsonRepresentation<Usage>> = {};
    addModelUsage(models, "openai-codex/gpt-6.1-sol", usage(100, 1_000));
    addModelUsage(models, "openai-codex/gpt-6.1-sol", { ...usage(50, 2_000), reasoning: 7 });
    expect(models["openai-codex/gpt-6.1-sol"]).toEqual({ input: 150, output: 40, cacheRead: 3_000, cacheWrite: 0, totalTokens: 3_190, reasoning: 7, cost: { input: 0.02, output: 0.04, cacheRead: 0.002, cacheWrite: 0, total: 0.062 } });
  });
});
