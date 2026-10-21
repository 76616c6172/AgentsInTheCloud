import type { ToolView, TranscriptItem } from "@agents-in-the-cloud/agent/server/transcript";
import { registerBuiltinAgentIntegration } from "@agents-in-the-cloud/builtin-agent/server";
import { codemodeTranscript } from "../../src/server/transcript.ts";

// Transcripts show each script's calls as code mode adds them, as its module does when it initializes.
registerBuiltinAgentIntegration({ id: "codemode-test", transcript: codemodeTranscript });

/** The first code mode call in a transcript, in or out of a turn. */
export function codemodeTool(items: readonly TranscriptItem[]): ToolView | undefined {
  for (const item of items) {
    if (item.type === "tool" && item.tool.name === "codemode") return item.tool;
    const nested = item.type === "working" ? codemodeTool(item.items) : undefined;
    if (nested) return nested;
  }
  return undefined;
}
