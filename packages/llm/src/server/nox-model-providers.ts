import type { JsonObject } from "@agents-in-the-cloud/core";

const modalCompat = {
  maxTokensField: "max_tokens",
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
  supportsUsageInStreaming: true,
};

export const noxModelProviders: JsonObject = {
  modal: {
    name: "Modal · DeepSeek",
    baseUrl: "https://76616c6172--ep-pal-deepseek-v4-1-flash-server.us-west.modal.direct/v1",
    api: "openai-completions",
    authHeader: true,
    compat: modalCompat,
    models: [{
      id: "deepseek-ai/DeepSeek-V4.1-Flash",
      name: "DeepSeek V4.1 Flash · Modal",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  },
  "modal-kimi": {
    name: "Modal · Kimi K3",
    baseUrl: "https://76616c6172--ep-pi-kimi-k3-server.us-west.modal.direct/v1",
    api: "openai-completions",
    authHeader: true,
    compat: modalCompat,
    models: [{
      id: "moonshotai/Kimi-K3",
      name: "Kimi K3 · Modal",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 8192,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    }],
  },
};

export function isNoxModelProvider(provider: string): boolean {
  return Object.hasOwn(noxModelProviders, provider);
}
