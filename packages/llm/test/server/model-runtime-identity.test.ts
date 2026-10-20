import { afterEach, expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { instrumentModelRuntime } from "../../src/server/pi-config-models.ts";
import { forgetSubscriptionInference, providersInLastInferenceWindow } from "../../src/server/recent-subscription-activity.ts";

afterEach(() => forgetSubscriptionInference("anthropic"));

async function anthropicRequest(credential: { type: "oauth"; access: string; refresh: string; expires: number } | { type: "api_key"; key: string }) {
  let received: Headers | undefined;
  const server = Bun.serve({ port: 0, fetch(request) {
    received = request.headers;
    return new Response(`event: message_stop\ndata: {"type":"message_stop"}\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("anthropic", async () => credential);
    const runtime = instrumentModelRuntime(await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false }));
    const model: Model<Api> = { ...runtime.getModels("anthropic")[0]!, baseUrl: `http://127.0.0.1:${server.port}` };
    await runtime.completeSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] }, { maxRetries: 0 });
    return received!;
  } finally { await server.stop(true); }
}

test("Builtin Agent requests on a Claude subscription identify as AgentsInTheCloud and count towards its usage", async () => {
  const headers = await anthropicRequest({ type: "oauth", access: "sk-ant-oat01-secret", refresh: "refresh", expires: Date.now() + 3_600_000 });
  expect(headers.get("authorization")).toBe("Bearer sk-ant-oat01-secret");
  expect(headers.get("user-agent")).toStartWith("AgentsInTheCloud (");
  expect(headers.get("x-app")).toBeNull();
  expect(providersInLastInferenceWindow()).toEqual(["anthropic"]);
});

test("Anthropic API key requests don't count as subscription use", async () => {
  const headers = await anthropicRequest({ type: "api_key", key: "sk-ant-api03-secret" });
  expect(headers.get("user-agent")).toStartWith("AgentsInTheCloud (");
  expect(providersInLastInferenceWindow()).toEqual([]);
});
