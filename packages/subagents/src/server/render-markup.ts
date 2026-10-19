import type { AgentRenderContext } from "@agents-in-the-cloud/agent/server/render-context";
import { escapeHtml } from "@agents-in-the-cloud/shared";

export function communicationTraceHtml(ctx: AgentRenderContext, agentId: string, messageId: string, label: string): string {
  const query = new URLSearchParams({ child: agentId, message: messageId });
  return `<a href="/workspaces/${encodeURIComponent(ctx.workspaceId)}/subagents/reveal?${escapeHtml(query.toString())}" data-turbo="false" class="agent-trace-link">${escapeHtml(label)}</a>`;
}
