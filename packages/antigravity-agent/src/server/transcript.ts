import { join } from "node:path";
import { getAgentsInTheCloudRuntimeContext, readTextIfExists } from "@agents-in-the-cloud/core";
import { nativeJsonlRows, nativeTimestamp } from "@agents-in-the-cloud/cli-agent/server";
import type { TranscriptRecord } from "@agents-in-the-cloud/agent/server/transcript";
import { Type } from "typebox";
import { Value } from "typebox/value";

const sessionSchema = Type.Object({ conversationId: Type.String({ pattern: "^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$" }), busy: Type.Optional(Type.Boolean()) });
const rowSchema = Type.Object({
  step_index: Type.Number(), type: Type.String(), status: Type.String(), created_at: Type.String(),
  content: Type.Optional(Type.String()), thinking: Type.Optional(Type.String()),
  tool_calls: Type.Optional(Type.Array(Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.String())) }))),
});

function toolArguments(args: Record<string, string> | undefined) {
  return Object.fromEntries(Object.entries(args ?? {}).map(([key, value]) => {
    try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
  }));
}

export function antigravityTranscriptRecords(jsonl: string, conversationId: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  const pending: string[] = [];
  for (const row of nativeJsonlRows(jsonl, rowSchema)) {
    const id = `${conversationId}:${row.step_index}`;
    const timestamp = nativeTimestamp(row.created_at);
    if (row.type === "USER_INPUT") {
      const text = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(row.content ?? "")?.[1] ?? row.content ?? "";
      records.push({ kind: "user", id, text, timestamp, images: [], rewindable: false });
    } else if (row.type === "PLANNER_RESPONSE") {
      const parts: Extract<TranscriptRecord, { kind: "assistant" }>["parts"] = [];
      if (row.thinking) parts.push({ type: "thinking", text: row.thinking });
      if (row.content) parts.push({ type: "text", text: row.content });
      for (const [index, tool] of (row.tool_calls ?? []).entries()) {
        const callId = `${id}:${index}`;
        parts.push({ type: "toolCall", callId, name: tool.name, args: toolArguments(tool.args) });
        pending.push(callId);
      }
      records.push({ kind: "assistant", id, parts, stopReason: row.status === "ERROR" ? "error" : row.tool_calls?.length ? "toolUse" : "stop", partial: row.status !== "DONE" && row.status !== "ERROR", timestamp });
    } else if (row.content) {
      const callId = pending.shift();
      if (callId) records.push({ kind: "toolResult", callId, text: row.content, images: [], isError: row.status === "ERROR", timestamp });
      else records.push({ kind: "note", id, text: row.content, tone: row.status === "ERROR" ? "error" : "system", timestamp });
    }
  }
  return records;
}

function sessionDirectory(workspaceId: string, sessionId: string): string {
  return join(getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir, "workspaces", workspaceId, "home-local", ".local", "share", "agents-in-the-cloud-agents", sessionId);
}

export async function antigravityConversationId(workspaceId: string, sessionId: string): Promise<string | undefined> {
  const text = await readTextIfExists(join(sessionDirectory(workspaceId, sessionId), "antigravity-session.json"));
  return text === undefined ? undefined : Value.Parse(sessionSchema, JSON.parse(text)).conversationId;
}

export async function antigravityHistoryFiles(workspaceId: string, sessionId: string): Promise<string[]> {
  const conversationId = await antigravityConversationId(workspaceId, sessionId);
  if (!conversationId) return [];
  const path = join(sessionDirectory(workspaceId, sessionId), "gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
  return await Bun.file(path).exists() ? [path] : [];
}

export async function loadAntigravityTranscript(workspaceId: string, sessionId: string): Promise<TranscriptRecord[] | undefined> {
  const files = await antigravityHistoryFiles(workspaceId, sessionId);
  if (!files.length) return undefined;
  const conversationId = (await antigravityConversationId(workspaceId, sessionId))!;
  return antigravityTranscriptRecords(await Bun.file(files[0]!).text(), conversationId);
}
