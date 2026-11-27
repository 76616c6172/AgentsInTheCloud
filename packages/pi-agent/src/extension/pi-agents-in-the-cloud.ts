import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const configSchema = Type.Object({
  url: Type.String(),
  token: Type.String(),
  turnSignalCommand: Type.String(),
  instructions: Type.String(),
  inboxDir: Type.Optional(Type.String()),
});
type AgentsInTheCloudSessionConfig = Static<typeof configSchema>;

const inboxMessageSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  deliverAs: Type.Optional(Type.Union([Type.Literal("followUp"), Type.Literal("steer")])),
});

export function registerPiAgentsInTheCloud(pi: ExtensionAPI, config: AgentsInTheCloudSessionConfig): void {
  pi.registerMcpServer("agents-in-the-cloud", {
    url: config.url,
    headers: { Authorization: `Bearer ${config.token}` },
    exposure: "codemode",
    timeout: 3_600,
  });

  pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${config.instructions}` }));

  async function signalTurn(boundary: "started" | "finished"): Promise<void> {
    const result = await pi.exec("sh", [config.turnSignalCommand, boundary]);
    if (result.code !== 0) throw new Error(result.stderr);
  }

  pi.on("agent_start", () => signalTurn("started"));
  pi.on("agent_end", () => signalTurn("finished"));

  if (config.inboxDir) {
    const inboxDir = config.inboxDir;
    let draining = false;
    let watcher: FSWatcher | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    async function drainInbox(): Promise<void> {
      if (draining) return;
      draining = true;
      try {
        const entries = (await readdir(inboxDir)).filter((name) => name.endsWith(".json")).sort();
        for (const name of entries) {
          const fullPath = join(inboxDir, name);
          let raw: string;
          try {
            raw = await readFile(fullPath, "utf8");
            await unlink(fullPath);
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
            throw error;
          }
          const parsed = Value.Parse(inboxMessageSchema, JSON.parse(raw));
          await pi.sendUserMessage(parsed.text, { deliverAs: parsed.deliverAs ?? "followUp" });
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          console.error("Could not process Pi inbox message", error);
        }
      } finally {
        draining = false;
      }
    }

    pi.on("session_start", async () => {
      await mkdir(inboxDir, { recursive: true, mode: 0o700 });
      void drainInbox();
      try {
        watcher = watch(inboxDir, () => { void drainInbox(); });
      } catch {
        watcher = undefined;
      }
      pollTimer = setInterval(() => { void drainInbox(); }, 500);
      pollTimer.unref?.();
    });

    pi.on("session_shutdown", () => {
      watcher?.close();
      watcher = undefined;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    });
  }
}

export default async function piAgentsInTheCloudExtension(pi: ExtensionAPI): Promise<void> {
  const config = Value.Parse(configSchema, JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8")));
  registerPiAgentsInTheCloud(pi, config);
}
