import { listWorkspaceAgents, durableWorkspaceOwner, WorkspaceAgents, type AgentLivePresentationSubscription, type AgentRouteHandler } from "@agents-in-the-cloud/builtin-agent/server";
import { ids } from "@agents-in-the-cloud/agent/server/render-context";
import { requestAcceptsJson } from "@agents-in-the-cloud/core";
import { createLivePresentation, escapeHtml as h } from "@agents-in-the-cloud/shared";
import { nativeSnapshot } from "./native-view-state.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Delegation } from "./native-state.ts";
import { renderBackgroundActivities } from "@agents-in-the-cloud/agent/server/background-activity";
import { subagentActivities } from "./background.ts";

/** Listens for the Agent's subagents while its pane shows, keeping its background bar current. */
export async function renderSubagentsControl(workspaceId: string, agentId: string): Promise<string> {
  return `<div hidden data-controller="subagents" data-subagents-workspace-id-value="${h(workspaceId)}" data-subagents-agent-id-value="${h(agentId)}"
    data-action="agents-in-the-cloud:workspace-agent-selected@document->subagents#sync agents-in-the-cloud:workspace-pane-visible@document->subagents#sync agents-in-the-cloud:workspace-pane-hidden@document->subagents#sync visibilitychange@document->subagents#sync"></div>`;
}

/** The selected Agent's subagents and their messages, for automation. */
export const handleSubagentRequest: AgentRouteHandler = async (request, url) => {
  const match = url.pathname.match(/^\/workspaces\/([^/]+)\/subagents$/);
  if (!match || request.method !== "GET" || !requestAcceptsJson(request)) return undefined;
  const workspaceId = decodeURIComponent(match[1]!);
  const roots = await listWorkspaceAgents(workspaceId);
  const parentId = url.searchParams.get("agent") ?? roots[0]?.agentId;
  const parent = roots.find((agent) => agent.agentId === parentId);
  if (!parent) return new Response("Agent not found", { status: 404 });
  const snapshot = await nativeSnapshot(workspaceId);
  const agents = snapshot.agents.filter(agent => agent.rootId === parent.agentId);
  return Response.json({ parent: { id: parentId, title: parent.title }, agents, messages: snapshot.messages.filter((message) => message.to === parentId || message.from === parentId || agents.some((agent) => agent.id === message.to || agent.id === message.from)) });
};

/** Publish the Agent's background bar as its subagents change. */
export async function subscribeSubagentBackground(workspaceId: string, rootId: string, listener: (html: string) => void): Promise<AgentLivePresentationSubscription> {
  const roots = await listWorkspaceAgents(workspaceId);
  if (!roots.some((root) => root.agentId === rootId)) throw new Error(`Agent not found: ${rootId}`);
  const owner = await durableWorkspaceOwner(workspaceId);
  let snapshot = await nativeSnapshot(workspaceId);
  const presentation = createLivePresentation(() => [{ target: ids.background({ workspaceId, agentId: rootId }), html: renderBackgroundActivities({ workspaceId, agentId: rootId }, subagentActivities(snapshot, rootId)) }]);
  const watches = await Promise.all([
    owner.harness.watchDoc(WorkspaceAgents, BACKGROUND_CONTEXT),
    owner.harness.watchDoc(Delegation, BACKGROUND_CONTEXT),
    owner.harness.watchTaskGraph(BACKGROUND_CONTEXT),
  ]);
  let updates = Promise.resolve();
  const refresh = () => updates = updates.then(async () => { snapshot = await nativeSnapshot(workspaceId); presentation.invalidate(); });
  for (const watch of watches) watch?.start(refresh);
  await refresh();

  const subscription = presentation.subscribe(listener);
  return { unsubscribe() { for (const watch of watches) void watch?.stop(); subscription.unsubscribe(); presentation.dispose(); } };
}
