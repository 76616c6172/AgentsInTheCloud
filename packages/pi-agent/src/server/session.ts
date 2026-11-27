import { fileURLToPath } from "node:url";
import { shellQuote } from "@agents-in-the-cloud/core";
import { execWorkspaceShell } from "@agents-in-the-cloud/workspace";
import { writeCliSessionFiles, type CliAgentConnection, type CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";

export function piAgentsInTheCloudExtensionPath(session: CliAgentSession): string {
  return `${session.directory}/pi-agents-in-the-cloud/extension.mjs`;
}

export function piInboxDirectory(sessionId: string): string {
  return `/home/agents-in-the-cloud/.local/share/agents-in-the-cloud-agents/${sessionId}/pi-agents-in-the-cloud/inbox`;
}

let bundledExtension: Promise<string> | undefined;
function buildExtension(): Promise<string> {
  return bundledExtension ??= (async () => {
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../extension/pi-agents-in-the-cloud.ts", import.meta.url))],
      target: "node",
      format: "esm",
      minify: true,
      sourcemap: "none",
    });
    if (!result.success) throw new Error(`Could not bundle the pi-agents-in-the-cloud extension: ${result.logs.map(String).join("\n")}`);
    return await result.outputs[0]!.text();
  })();
}

export async function preparePiSession(workspaceId: string, session: CliAgentSession, connection: CliAgentConnection): Promise<Record<string, string>> {
  const extension = await buildExtension();
  const inboxDir = `${session.directory}/pi-agents-in-the-cloud/inbox`;
  const config = JSON.stringify({ ...connection, turnSignalCommand: session.turnSignalCommand, inboxDir });
  await writeCliSessionFiles(workspaceId, session, {
    "pi-agents-in-the-cloud/extension.mjs": extension,
    "pi-agents-in-the-cloud/config.json": config,
  });
  return {};
}

export async function sendPiInboxMessage(
  workspaceId: string,
  sessionId: string,
  text: string,
  whenBusy: "followUp" | "steer" = "followUp",
): Promise<"queued" | "steered"> {
  const inboxDir = piInboxDirectory(sessionId);
  const name = `${Date.now()}-${crypto.randomUUID()}.json`;
  const tmpPath = `${inboxDir}/.${name}.tmp`;
  const finalPath = `${inboxDir}/${name}`;
  const payload = JSON.stringify({ text, deliverAs: whenBusy });
  const result = await execWorkspaceShell(
    workspaceId,
    `set -eu\numask 077\nmkdir -p ${shellQuote(inboxDir)}\ncat > ${shellQuote(tmpPath)}\nmv ${shellQuote(tmpPath)} ${shellQuote(finalPath)}`,
    { stdin: payload },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Could not deliver message to Pi session ${sessionId}`);
  }
  return whenBusy === "steer" ? "steered" : "queued";
}
