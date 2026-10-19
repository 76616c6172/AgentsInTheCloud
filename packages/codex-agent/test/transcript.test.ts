import { expect, test } from "bun:test";
import { projectCodexTurns } from "../src/server/transcript.ts";

test("a subagent's activity reaches the transcript as an incoming message", () => {
  const [working] = projectCodexTurns([{
    id: "turn", itemsView: "full", status: "completed", error: null, startedAt: 1, completedAt: 2, durationMs: 1000,
    items: [{ type: "subAgentActivity", id: "activity", kind: "completed", agentThreadId: "thread-2", agentPath: "/root/researcher" }],
  }], new Set());
  expect(working).toMatchObject({ type: "working", items: [{ type: "message", key: "activity", sender: "/root/researcher", title: "completed", details: { Thread: "thread-2" } }] });
});
