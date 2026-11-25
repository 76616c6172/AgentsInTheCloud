import { shellQuote } from "@agents-in-the-cloud/core";
import { writeCliSessionFiles, type CliAgentConnection, type CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";
import { antigravityWorkspaceCredential } from "./credentials.ts";
import { antigravityConversationId } from "./transcript.ts";

export function antigravityProfile(session: Pick<CliAgentSession, "directory">): string { return `${session.directory}/gemini`; }

export async function prepareAntigravitySession(workspaceId: string, session: CliAgentSession, connection: CliAgentConnection): Promise<Record<string, string>> {
  const hook = (event: string) => [{ type: "command", command: `node ${shellQuote(`${session.directory}/antigravity-hook.mjs`)} ${event}` }];
  const hooks = { "agents-in-the-cloud": { SessionStart: hook("session"), PreInvocation: hook("started"), Stop: hook("finished") } };
  const hookScript = `import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const directory = dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.conversationId)) throw new Error("Invalid Antigravity conversation ID");
const stateFile = join(directory, "antigravity-session.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const event = process.argv[2];
if (event === "session" || !state.conversationId) state.conversationId = input.conversationId;
if (state.conversationId === input.conversationId) {
  const busy = event === "started";
  if (event !== "session" && state.busy !== busy) {
    const result = spawnSync("sh", [${JSON.stringify(session.turnSignalCommand)}, event], { stdio: ["ignore", "ignore", "inherit"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Could not signal Antigravity turn " + event);
    state.busy = busy;
  }
  const temporary = stateFile + "." + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, stateFile);
}
process.stdout.write("{}");
`;
  const conversationId = await antigravityConversationId(workspaceId, session.id);
  const files = {
    "gemini/antigravity-cli/antigravity-oauth-token": antigravityWorkspaceCredential(),
    "gemini/config/mcp_config.json": JSON.stringify({ mcpServers: { "agents-in-the-cloud": { serverUrl: connection.url, headers: { Authorization: `Bearer ${connection.token}` } } } }),
    "gemini/config/AGENTS.md": connection.instructions,
    "gemini/config/hooks.json": JSON.stringify(hooks),
    "antigravity-hook.mjs": hookScript,
  };
  await writeCliSessionFiles(workspaceId, session, conversationId
    ? { ...files, "antigravity-session.json": JSON.stringify({ conversationId, busy: false }) }
    : files);
  return {};
}
