import { formatTokens } from "@agents-in-the-cloud/agent/server/transcript";
import { backgroundOutputHtml, backgroundTranscriptHtml, backgroundTranscriptItemResponse, refreshingBackgroundDetail, type BackgroundActivity } from "@agents-in-the-cloud/agent/server/background-activity";
import type { AgentRenderContext } from "@agents-in-the-cloud/agent/server/render-context";
import { readClaudeSubagentRows } from "./rows.ts";
import { projectClaudeTranscript } from "./transcript.ts";
import type { ClaudeRuntime, ClaudeTask } from "./runtime.ts";

/** Claude Code's task types, named as people know them. Commands and monitors show their output in place; subagents have a page of their own. */
const kinds = new Map<string, Pick<BackgroundActivity, "kind" | "opens">>([
  ["local_bash", { kind: "command", opens: "inline" }],
  ["monitor", { kind: "monitor", opens: "inline" }],
  ["local_agent", { kind: "subagent", opens: "drill-in" }],
  ["local_workflow", { kind: "workflow", opens: "inline" }],
  ["mcp_task", { kind: "MCP task", opens: "inline" }],
  ["remote_agent", { kind: "remote agent", opens: "inline" }],
]);

function activity(task: ClaudeTask): BackgroundActivity {
  const { kind, opens } = kinds.get(task.type) ?? { kind: task.type, opens: "inline" };
  const details: Record<string, string> = {};
  if (task.subagentType) details.Type = task.subagentType;
  if (task.usage) {
    details["Tool uses"] = String(task.usage.toolUses);
    details.Tokens = formatTokens(task.usage.tokens);
  }
  return {
    key: task.id, kind, opens, details, running: true, stoppable: true,
    title: task.workflowName ?? task.description, startedAt: task.startedAt, parentKey: task.parentTaskId, startedBy: task.toolUseId ? { itemKey: task.toolUseId, label: "Tool call" } : undefined,
    progress: task.summary ?? (task.lastToolName ? `Using ${task.lastToolName}` : undefined),
  };
}

/** Claude's live background work. Monitors show although Claude won't report on them; other ambient tasks are Claude Code's own housekeeping. */
export function claudeBackgroundActivities(runtime: ClaudeRuntime): BackgroundActivity[] {
  return runtime.tasks.filter(task => !task.ambient || task.type === "monitor").map(activity);
}

async function subagentTranscript(runtime: ClaudeRuntime, activity: BackgroundActivity) {
  return projectClaudeTranscript({ rows: await readClaudeSubagentRows(runtime.sessions, runtime.record.sessionId, activity.key) }, true);
}

export async function claudeBackgroundDetail(runtime: ClaudeRuntime, activity: BackgroundActivity, ctx: AgentRenderContext): Promise<string> {
  const task = runtime.tasks.find(task => task.id === activity.key)!;
  if (task.type === "local_agent") return refreshingBackgroundDetail(activity, backgroundTranscriptHtml(ctx, activity, await subagentTranscript(runtime, activity)));
  if (task.type === "local_bash" || task.type === "monitor") {
    const output = await runtime.taskOutput(task.id);
    return refreshingBackgroundDetail(activity, backgroundOutputHtml(output.output, output.truncated ? "Output · the last part" : "Output"));
  }
  return "";
}

export async function claudeBackgroundRoute(runtime: ClaudeRuntime, activity: BackgroundActivity, path: string, url: URL, ctx: AgentRenderContext): Promise<Response | undefined> {
  return activity.opens === "drill-in" ? backgroundTranscriptItemResponse(ctx, activity, path, url, () => subagentTranscript(runtime, activity)) : undefined;
}
