import { expect, test } from "bun:test";
import { antigravityTranscriptRecords } from "../src/server/transcript.ts";
import { antigravityLaunchScript } from "../src/server/launch-command.ts";

const id = "703282a2-43ea-4cba-80b8-26b4c63f939f";
const timestamp = "2026-11-25T04:07:22Z";
function transcript(rows: Array<{ type: string; status?: string; content?: string; thinking?: string; tool_calls?: Array<{ name: string; args: Record<string, string> }> }>) {
  return rows.map((row, step_index) => JSON.stringify({ step_index, created_at: timestamp, status: "DONE", ...row })).join("\n");
}

test("native history preserves user text, reasoning, tool arguments/results and the final answer", () => {
  const records = antigravityTranscriptRecords(transcript([
    { type: "USER_INPUT", content: "<USER_REQUEST>\nCheck the terminal.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>not part of the prompt</ADDITIONAL_METADATA>" },
    { type: "PLANNER_RESPONSE", thinking: "Run a harmless command.", tool_calls: [{ name: "run_command", args: { CommandLine: '"printf verified"', WaitMsBeforeAsync: "5000" } }] },
    { type: "GENERIC", content: "Command exited with code 0.\nverified" },
    { type: "PLANNER_RESPONSE", content: "Verified." },
  ]), id);
  expect(records).toHaveLength(4);
  expect(records[0]).toMatchObject({ kind: "user", text: "Check the terminal.", rewindable: false });
  expect(records[1]).toMatchObject({ kind: "assistant", stopReason: "toolUse", partial: false, parts: [
    { type: "thinking", text: "Run a harmless command." },
    { type: "toolCall", callId: `${id}:1:0`, name: "run_command", args: { CommandLine: "printf verified", WaitMsBeforeAsync: 5000 } },
  ] });
  expect(records[2]).toMatchObject({ kind: "toolResult", callId: `${id}:1:0`, isError: false });
  expect(records[3]).toMatchObject({ kind: "assistant", parts: [{ type: "text", text: "Verified." }], stopReason: "stop" });
});

test("in-progress and failed responses retain their state, and malformed trailing writes are ignored", () => {
  const jsonl = transcript([
    { type: "PLANNER_RESPONSE", status: "RUNNING", content: "Partial" },
    { type: "PLANNER_RESPONSE", status: "ERROR", content: "Unavailable" },
    { type: "ERROR", status: "ERROR", content: "Connection lost" },
  ]);
  expect(antigravityTranscriptRecords(jsonl + '\n{"step_index":', id)).toMatchObject([
    { kind: "assistant", partial: true },
    { kind: "assistant", partial: false, stopReason: "error" },
    { kind: "note", tone: "error", text: "Connection lost" },
  ]);
});

test("launches quote prompts, select the catalogue variant, isolate profiles, and resume the recorded conversation", () => {
  const session = { id: "agent-a", directory: "/home/agents-in-the-cloud/session-a", turnSignalCommand: "/tmp/turn-signal" };
  const script = antigravityLaunchScript({ text: "Don't run $(touch /tmp/injected)", images: [], attachmentNotes: [] }, ["/tmp/image.png"], { model: "antigravity::gemini-4-neon", thinkingLevel: "medium" }, session, id);
  expect(script).toContain("'--gemini_dir' '/home/agents-in-the-cloud/session-a/gemini'");
  expect(script).toContain("'--model' 'gemini-4-neon-medium'");
  expect(script).toContain(`'--conversation' '${id}'`);
  expect(script).toContain("Read the attached image at");
  expect(script).toContain("Don'\\''t run $(touch /tmp/injected)");
  const second = antigravityLaunchScript({ text: "", images: [], attachmentNotes: [] }, [], {}, { ...session, directory: "/home/agents-in-the-cloud/session-b" });
  expect(second).toContain("'/home/agents-in-the-cloud/session-b/gemini'");
  expect(second).not.toContain("--conversation");
});
