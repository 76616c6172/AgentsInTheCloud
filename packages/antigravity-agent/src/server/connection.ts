import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentsInTheCloudCoreError, createKeyedOperationQueue, readTextIfExists } from "@agents-in-the-cloud/core";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { CliModelConnection } from "@agents-in-the-cloud/llm/server";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { antigravityDataDirectory, antigravityExecutable } from "./installation.ts";
import { parseAntigravityModels, type AntigravityModel } from "./models.ts";

export const antigravityProvider = "antigravity";
const credentialSchema = Type.Object({
  token: Type.Object({ access_token: Type.String({ minLength: 1 }), token_type: Type.String(), refresh_token: Type.String({ minLength: 1 }), expiry: Type.String() }),
  auth_method: Type.Literal("consumer"),
  id_token_email: Type.String(),
});

export class AntigravitySignInError extends Error {
  constructor() { super("Google Antigravity could not refresh your connection. Check your connection or sign in again."); }
}

export function antigravitySetupRequired(): AgentsInTheCloudCoreError {
  return new AgentsInTheCloudCoreError("agent_setup_required", "Sign in with Google before starting Antigravity CLI.", { setupUrl: "/models?connect=antigravity" });
}

export function antigravityAuthorizationUrl(output: string): string | undefined {
  const match = /https:\/\/accounts\.google\.com\/[^\s]+/.exec(output);
  if (!match) return undefined;
  const url = new URL(match[0]);
  if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/auth" || url.searchParams.get("redirect_uri") !== "https://antigravity.google/oauth-callback" || url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("state")) throw new Error("Antigravity returned an unexpected sign-in URL.");
  return url.href;
}

export function createAntigravityConnection(options: { directory(): string; executable(): Promise<string> }) {
  const serialize = createKeyedOperationQueue();
  const profile = () => join(options.directory(), "profile");
  const credentialPath = (directory = profile()) => join(directory, "antigravity-cli", "antigravity-oauth-token");
  const cataloguePath = () => join(options.directory(), "models.txt");

  async function credential(directory = profile()) {
    const text = await readTextIfExists(credentialPath(directory));
    if (text === undefined) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("Invalid Antigravity credential file."); }
    if (!Value.Check(credentialSchema, parsed)) throw new Error("Unexpected Antigravity credential format. Sign in with a personal Google account.");
    if (!Number.isFinite(Date.parse(parsed.token.expiry))) throw new Error("Invalid Antigravity credential expiry.");
    return parsed;
  }

  async function save(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${crypto.randomUUID()}`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  }

  async function fetchModels(directory: string, signal?: AbortSignal): Promise<string> {
    const executable = await options.executable();
    const process = Bun.spawn([executable, "--gemini_dir", directory, "models"], {
      cwd: options.directory(), stdin: "ignore", stdout: "pipe", stderr: "pipe",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const [status, stdout] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (status !== 0) throw new AntigravitySignInError();
    parseAntigravityModels(stdout);
    return stdout;
  }

  async function refresh(): Promise<void> {
    const output = await fetchModels(profile());
    await save(cataloguePath(), output);
  }

  async function accessTokenUnlocked(): Promise<string> {
    let stored = await credential();
    if (!stored) throw antigravitySetupRequired();
    if (Date.parse(stored.token.expiry) <= Date.now() + 5 * 60_000) {
      await refresh();
      stored = await credential();
      if (!stored || Date.parse(stored.token.expiry) <= Date.now()) throw new AntigravitySignInError();
    }
    return stored.token.access_token;
  }

  async function login(interaction: AuthInteraction): Promise<void> {
    await serialize(options.directory(), async () => {
      await mkdir(options.directory(), { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(join(options.directory(), "login-"));
      const finished = new AbortController();
      const signal = AbortSignal.any([finished.signal, AbortSignal.timeout(10 * 60_000), ...(interaction.signal ? [interaction.signal] : [])]);
      try {
        const executable = await options.executable();
        signal.throwIfAborted();
        const process = Bun.spawn([executable, "acp", "--gemini_dir", staging, "--login"], { cwd: staging, stdin: "pipe", stdout: "pipe", stderr: "pipe", signal });
        let pendingInput: Promise<void> | undefined;
        let promptError: unknown;
        let output = "";
        async function consume(stream: ReadableStream<Uint8Array>) {
          const decoder = new TextDecoder();
          for await (const chunk of stream) {
            output += decoder.decode(chunk, { stream: true });
            if (output.length > 64_000) throw new Error("Antigravity sign-in produced too much output.");
            if (pendingInput || !output.includes("Then paste the authorization code")) continue;
            const url = antigravityAuthorizationUrl(output);
            if (!url) continue;
            interaction.notify({ type: "auth_url", url });
            pendingInput = (async () => {
              const input = (await interaction.prompt({ type: "manual_code", message: "Paste the code or redirect URL from Google", signal })).trim();
              if (!input || /[\r\n]/.test(input)) throw new Error("Paste one authorization code or redirect URL.");
              signal.throwIfAborted();
              process.stdin.write(`${input}\n`);
              await process.stdin.end();
            })().catch(error => { promptError = error; process.kill(); });
          }
        }
        const [status] = await Promise.all([process.exited, consume(process.stdout), consume(process.stderr)]);
        if (promptError) throw promptError;
        if (status !== 0) throw new Error("Google sign-in did not finish. Start again and use the new sign-in link.");
        const models = await fetchModels(staging, signal);
        const stored = await credential(staging);
        if (!stored) throw new Error("Antigravity did not save a Google connection.");
        signal.throwIfAborted();
        await save(credentialPath(), JSON.stringify(stored));
        await save(cataloguePath(), models);
      } finally {
        finished.abort();
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  const connection: CliModelConnection = {
    id: antigravityProvider, label: "Google Antigravity", agentLabel: "Antigravity CLI", login,
    async account() {
      const stored = await credential();
      if (!stored) return undefined;
      let state: "connected" | "needs_attention" = "connected";
      try { await api.accessToken(); }
      catch (error) { if (!(error instanceof AntigravitySignInError)) throw error; state = "needs_attention"; }
      return { id: antigravityProvider, provider: antigravityProvider, label: "Google Antigravity", method: "subscription", description: stored.id_token_email, connection: state };
    },
    async disconnect() {
      await serialize(options.directory(), async () => {
        await rm(profile(), { recursive: true, force: true });
        await rm(cataloguePath(), { force: true });
      });
    },
  };
  const api = {
    connection,
    accessToken: () => serialize(options.directory(), accessTokenUnlocked),
    async models(): Promise<AntigravityModel[]> {
      return serialize(options.directory(), async () => {
        await accessTokenUnlocked();
        if (await readTextIfExists(cataloguePath()) === undefined) await refresh();
        return parseAntigravityModels((await readTextIfExists(cataloguePath()))!);
      });
    },
    async connected(): Promise<boolean> { return (await credential()) !== undefined; },
  };
  return api;
}

export const antigravity = createAntigravityConnection({ directory: antigravityDataDirectory, executable: antigravityExecutable });
