import { expect, test } from "bun:test";
import { antigravityAccessPlaceholder, antigravityCredentialTransform, antigravityWorkspaceCredential } from "../src/server/credentials.ts";

const authorization = `Bearer ${antigravityAccessPlaceholder}`;

test("workspaces receive no refresh token or real access credential", () => {
  const credential = JSON.parse(antigravityWorkspaceCredential());
  expect(credential.token.access_token).toBe(antigravityAccessPlaceholder);
  expect(credential.token.refresh_token).toBe("");
  expect(Date.parse(credential.token.expiry)).toBeGreaterThan(Date.now());
});

test("Google inference receives the current token while preserving method and body", async () => {
  const secrets: string[] = [];
  const transform = antigravityCredentialTransform(async () => "real-access");
  const request = new Request("https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent", { method: "POST", headers: { authorization }, body: "payload" });
  const result = await transform(request, secret => { secrets.push(secret); });
  expect(result.headers.get("authorization")).toBe("Bearer real-access");
  expect(result.method).toBe("POST");
  expect(await result.text()).toBe("payload");
  expect(secrets).toEqual(["real-access"]);
});

test.each([
  "http://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  "https://daily-cloudcode-pa.googleapis.com:8443/v1internal:loadCodeAssist",
  "https://daily-cloudcode-pa.googleapis.com.evil.example/",
  "https://example.com/",
  "https://www.googleapis.com/storage/v1/b",
  `https://daily-cloudcode-pa.googleapis.com/${antigravityAccessPlaceholder}`,
  `https://daily-cloudcode-pa.googleapis.com/?token=${antigravityAccessPlaceholder}`,
])("rejects credential use at %s without resolving the secret", async url => {
  let resolved = false;
  const transform = antigravityCredentialTransform(async () => { resolved = true; return "real-access"; });
  await expect(transform(new Request(url, { headers: { authorization } }), () => {})).rejects.toThrow("Google endpoints");
  expect(resolved).toBe(false);
});

test("rejects marker injection through unrelated headers", async () => {
  const transform = antigravityCredentialTransform(async () => "real-access");
  await expect(transform(new Request("https://aicode.googleapis.com/", { headers: { authorization, "x-debug": antigravityAccessPlaceholder } }), () => {})).rejects.toThrow();
});

test("leaves unrelated traffic unchanged and propagates disconnects", async () => {
  const transform = antigravityCredentialTransform(async () => { throw new Error("Disconnected"); });
  const request = new Request("https://example.com/");
  expect(await transform(request, () => {})).toBe(request);
  await expect(transform(new Request("https://aicode.googleapis.com/", { headers: { authorization } }), () => {})).rejects.toThrow("Disconnected");
});
