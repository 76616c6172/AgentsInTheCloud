import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { backgroundReportHtml, refreshingBackgroundDetail, renderBackgroundGone, renderBackgroundPage, type BackgroundActivity } from "@agents-in-the-cloud/agent/server/background-activity";
import { ids, type AgentRenderContext } from "@agents-in-the-cloud/agent/server/render-context";
import { commitDurableStop, durableWorkspaceOwner, markGatedDurableWork, settleStoppedDurableWork } from "@agents-in-the-cloud/builtin-agent/server";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { response } from "@agents-in-the-cloud/shared/http";
import { nativeSnapshot, type NativeSubagentView } from "./native-view-state.ts";
import type { Receipt } from "./native-state.ts";

/** What the list reads of the workspace's subagents and their messages. */
type SubagentState = { agents: ReadonlyArray<Pick<NativeSubagentView, "id" | "parentId" | "rootId" | "taskName" | "status" | "task">>; messages: ReadonlyArray<Pick<Receipt, "id" | "from" | "to" | "kind" | "callId">> };

/** The Agent's latest task for a subagent working for it directly, and the final answer it sent back to that task. */
function latestExchange(snapshot: SubagentState, rootId: string, agentId: string) {
  const exchange = snapshot.messages.filter(message => (message.kind === "task" && message.from === rootId && message.to === agentId) || (message.kind === "completion" && message.from === agentId && message.to === rootId));
  const task = exchange.findLastIndex(message => message.kind === "task");
  return { task: exchange[task], answer: exchange.findLast((message, index) => message.kind === "completion" && index > task) };
}

/** An Agent's subagents, nested under the subagent that started them. A finished subagent stays listed while it can be given more work; a closed one can't. */
export function subagentActivities(snapshot: SubagentState, rootId: string): BackgroundActivity[] {
  return snapshot.agents.filter(agent => agent.rootId === rootId && agent.status !== "closed").map(agent => {
    const running = agent.status === "running" || agent.status === "pending";
    // A nested subagent starts and reports in its parent's transcript, not this Agent's.
    const exchange = agent.parentId === rootId ? latestExchange(snapshot, rootId, agent.id) : undefined;
    return {
      key: agent.id, kind: "subagent", title: agent.taskName, running, details: { Task: agent.task }, stoppable: true, opens: "drill-in",
      progress: agent.status === "pending" ? "Waiting to start" : agent.status === "failed" ? "Failed" : agent.status === "interrupted" ? "Stopped" : undefined,
      startedBy: exchange?.task?.callId ? { itemKey: exchange.task.callId, label: "Tool call" } : undefined, parentKey: agent.parentId === rootId ? undefined : agent.parentId,
    };
  });
}

/** A subagent is an Agent of its own: its page follows that Agent's live transcript. */
function transcriptHtml(workspaceId: string, agentId: string): string {
  // Kept as the page reloads its header: the transcript fills it live.
  return `<div class="agent-transcript-content" id="${ids.transcript({ workspaceId, agentId })}" data-turbo-permanent data-controller="subagent-transcript" data-subagent-transcript-workspace-id-value="${escapeHtml(workspaceId)}" data-subagent-transcript-agent-id-value="${escapeHtml(agentId)}"
    data-action="click->subagent-transcript#follow agents-in-the-cloud:workspace-agent-selected@document->subagent-transcript#sync agents-in-the-cloud:workspace-pane-visible@document->subagent-transcript#sync agents-in-the-cloud:workspace-pane-hidden@document->subagent-transcript#sync visibilitychange@document->subagent-transcript#sync"></div>`;
}

/** `/workspaces/:id/agents/:agentId/background/:subagentId`, its page, and `/stop`. */
export async function handleSubagentBackgroundRequest(request: Request, url: URL): Promise<Response | undefined> {
  const match = url.pathname.match(/^\/workspaces\/([^/]+)\/agents\/([^/]+)\/background\/([^/]+)(\/stop)?$/);
  if (!match) return undefined;
  const workspaceId = decodeURIComponent(match[1]!);
  const key = decodeURIComponent(match[3]!);
  const snapshot = await nativeSnapshot(workspaceId);
  // A subagent's own transcript links to the work it started, which is listed under their root Agent.
  const agentId = decodeURIComponent(match[2]!);
  const rootId = snapshot.agents.find(agent => agent.id === agentId)?.rootId ?? agentId;
  const ctx: AgentRenderContext = { workspaceId, agentId: rootId };
  const activity = subagentActivities(snapshot, rootId).find(activity => activity.key === key);
  if (match[4] && request.method === "POST") {
    if (activity?.running) {
      const owner = await durableWorkspaceOwner(workspaceId);
      const record = (await owner.catalog()).find(record => record.agentId === key)!;
      // As the interrupt_agent tool stops one: saved first, then its running work is ended.
      await owner.harness.commit(tx => commitDurableStop(tx, record.durableId), BACKGROUND_CONTEXT);
      await markGatedDurableWork(owner.harness);
      await settleStoppedDurableWork(owner.harness);
    }
    return new Response(null, { status: 204 });
  }
  if (match[4] || request.method !== "GET") return undefined;
  if (!activity) return response(renderBackgroundGone(ctx, key, true));
  // Its final answer to the latest task arrives in the Agent's conversation as an incoming message.
  const answer = activity.parentKey ? undefined : latestExchange(snapshot, rootId, key).answer;
  // The transcript is live; the page reloads around it so its header, Stop and closing row follow the subagent.
  return response(renderBackgroundPage(ctx, activity, refreshingBackgroundDetail(activity, transcriptHtml(workspaceId, key) + (answer ? backgroundReportHtml(ctx, answer.id) : ""))));
}
