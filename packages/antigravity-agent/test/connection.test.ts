import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAntigravityConnection, antigravityAuthorizationUrl } from "../src/server/connection.ts";
import { parseAntigravityModels, selectAntigravityModel } from "../src/server/models.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const catalogue = "Fetching available models...\ngemini-4-neon-medium\tGemini 4 Neon (Medium)\ngemini-4-neon-xhigh\tGemini 4 Neon (XHigh)\ngemini-pro-orchestrator-neon\tOrchestrator (Neon)\n";
const url = "https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&code_challenge_method=S256&state=example";
const stored = { token: { access_token: "test-access", refresh_token: "test-refresh", token_type: "Bearer", expiry: "2099-01-01T00:00:00Z" }, auth_method: "consumer", id_token_email: "test@example.test" };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "antigravity-connection-"));
  directories.push(directory);
  const binary = join(directory, "fake-agy");
  const credentialPath = join(directory, "profile", "antigravity-cli", "antigravity-oauth-token");
  await writeFile(binary, `#!/usr/bin/env bun
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
const root = process.argv[process.argv.indexOf("--gemini_dir") + 1];
const file = join(root, "antigravity-cli", "antigravity-oauth-token");
if (process.argv.includes("--login")) {
  process.stdout.write(${JSON.stringify(url + "\nThen paste the authorization code, or the full URL:\n")});
  const input = await Bun.stdin.text();
  if (input.trim() !== "test-code") process.exit(1);
  await mkdir(join(root, "antigravity-cli"), {recursive:true});
  await writeFile(file, ${JSON.stringify(JSON.stringify(stored))});
} else {
  const credential = JSON.parse(await readFile(file, "utf8"));
  if (credential.token.refresh_token === "revoked") process.exit(1);
  credential.token.expiry = "2099-01-01T00:00:00Z";
  credential.token.access_token = "refreshed-access";
  await writeFile(file, JSON.stringify(credential));
  process.stdout.write(${JSON.stringify(catalogue)});
}
`);
  await chmod(binary, 0o755);
  const api = createAntigravityConnection({ directory: () => directory, executable: async () => binary });
  async function seed(expiry = stored.token.expiry, refresh = stored.token.refresh_token) {
    await mkdir(join(directory, "profile", "antigravity-cli"), { recursive: true });
    await writeFile(credentialPath, JSON.stringify({ ...stored, token: { ...stored.token, expiry, refresh_token: refresh } }));
  }
  return { api, seed, directory, credentialPath };
}

test("discovers account-specific model variants without treating Orchestrator as adjustable effort", () => {
  const models = parseAntigravityModels(catalogue);
  expect(models).toHaveLength(2);
  expect(selectAntigravityModel(models).variant).toBe("gemini-4-neon-medium");
  expect(selectAntigravityModel(models, "gemini-4-neon", "xhigh").variant).toBe("gemini-4-neon-xhigh");
  expect(selectAntigravityModel(models, "gemini-pro-orchestrator-neon").effort).toBe("");
  expect(() => selectAntigravityModel(models, "gemini-pro-orchestrator-neon", "high")).toThrow();
  expect(() => selectAntigravityModel(models, "unavailable-model")).toThrow();
  expect(() => parseAntigravityModels("no models")).toThrow();
});

test("only accepts Google's PKCE sign-in URL with the official callback", () => {
  expect(antigravityAuthorizationUrl(url)).toBe(url);
  expect(antigravityAuthorizationUrl("https://example.com/oauth")).toBeUndefined();
  expect(() => antigravityAuthorizationUrl(url.replace("antigravity.google", "evil.example"))).toThrow();
  expect(() => antigravityAuthorizationUrl(url.replace("S256", "plain"))).toThrow();
});

test("login exchanges through the official CLI interface and persists a private account and catalogue", async () => {
  const { api, directory, credentialPath } = await fixture();
  const notifications: string[] = [];
  await api.connection.login({ notify: event => { if (event.type === "auth_url") notifications.push(event.url); }, prompt: async () => "test-code" });
  expect(notifications).toEqual([url]);
  expect(await api.connected()).toBe(true);
  expect((await api.connection.account())?.connection).toBe("connected");
  expect((await api.models()).map(model => model.id)).toEqual(["gemini-4-neon", "gemini-pro-orchestrator-neon"]);
  expect((await Bun.file(credentialPath).stat()).mode & 0o777).toBe(0o600);
  expect((await readdir(directory)).some(name => name.startsWith("login-"))).toBe(false);
});

test("an unsuccessful reconnect preserves the previous credential", async () => {
  const { api, seed, credentialPath } = await fixture();
  await seed();
  const before = await readFile(credentialPath, "utf8");
  await expect(api.connection.login({ notify: () => {}, prompt: async () => "bad-code" })).rejects.toThrow("did not finish");
  expect(await readFile(credentialPath, "utf8")).toBe(before);
});

test("cancelled login releases the operation queue and deletes temporary credentials", async () => {
  const { api, directory } = await fixture();
  const abort = new AbortController();
  await expect(api.connection.login({ signal: abort.signal, notify: () => abort.abort(), prompt: async () => "test-code" })).rejects.toThrow();
  expect((await readdir(directory)).some(name => name.startsWith("login-"))).toBe(false);
  await api.connection.disconnect();
  expect(await api.connected()).toBe(false);
});

test("expired tokens refresh through the CLI, survive a new connection object, and disconnect stops access", async () => {
  const { api, seed, directory } = await fixture();
  await seed("2000-01-01T00:00:00Z");
  expect(await Promise.all([api.accessToken(), api.accessToken()])).toEqual(["refreshed-access", "refreshed-access"]);
  const reopened = createAntigravityConnection({ directory: () => directory, executable: async () => join(directory, "fake-agy") });
  expect(await reopened.accessToken()).toBe("refreshed-access");
  await reopened.connection.disconnect();
  expect(await api.connected()).toBe(false);
  await expect(api.accessToken()).rejects.toMatchObject({ code: "agent_setup_required" });
});

test("revoked refresh credentials report needs_attention without discarding the account", async () => {
  const { api, seed } = await fixture();
  await seed("2000-01-01T00:00:00Z", "revoked");
  expect((await api.connection.account())?.connection).toBe("needs_attention");
});


test("invalid external credential files fail without exposing their contents", async () => {
  const { api, seed, credentialPath } = await fixture();
  await seed();
  for (const content of ['{"secret":"private-sentinel",', '{"token":{"access_token":"private-sentinel"}}']) {
    await writeFile(credentialPath, content);
    let failure: unknown;
    try { await api.accessToken(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("private-sentinel");
  }
});
