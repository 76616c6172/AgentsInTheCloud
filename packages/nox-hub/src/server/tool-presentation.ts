import type { AgentToolPresentation } from "@agents-in-the-cloud/agent/server";
import { detailTableHtml } from "@agents-in-the-cloud/agent/server/render-markup";
import type { ToolView } from "@agents-in-the-cloud/agent/server/transcript";
import { actionLinkHtml } from "@agents-in-the-cloud/design-system/action-link";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const stringFieldSchema = Type.String({ minLength: 1 });
const argsRecordSchema = Type.Record(Type.String(), Type.Unknown());
const waitArgsSchema = Type.Object({ workspace_ids: Type.Array(Type.String()) });
const parkArgsSchema = Type.Object({ parked: Type.Boolean() });

const workspaceItemSchema = Type.Object({
  id: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  state: Type.Optional(Type.String()),
  provisioningError: Type.Optional(Type.String()),
  agentTypeId: Type.Optional(Type.String()),
  latest_message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  template: Type.Optional(Type.Object({ title: Type.Optional(Type.String()) })),
});

const listProjectsResultSchema = Type.Object({
  projects: Type.Array(Type.Object({
    id: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
  })),
});

const listTemplatesResultSchema = Type.Object({
  templates: Type.Array(Type.Object({
    id: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
  })),
});

const listWorkspacesResultSchema = Type.Object({
  workspaces: Type.Array(workspaceItemSchema),
});

const createWorkspaceResultSchema = Type.Object({
  id: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  agentTypeId: Type.Optional(Type.String()),
  state: Type.Optional(Type.String()),
});

const statusResultSchema = Type.Object({
  workspace: Type.Optional(workspaceItemSchema),
  latest_message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const readWorkspaceResultSchema = Type.Object({
  workspace_id: Type.Optional(Type.String()),
  workspace_title: Type.Optional(Type.String()),
  answer: Type.Optional(Type.String()),
  transcript: Type.Optional(Type.String()),
});

const sendMessageResultSchema = Type.Object({
  workspace_id: Type.Optional(Type.String()),
  workspace_title: Type.Optional(Type.String()),
  delivered: Type.Optional(Type.String()),
});

const waitResultSchema = Type.Object({
  workspaces: Type.Array(workspaceItemSchema),
});

function stringArg(tool: ToolView, key: string): string | undefined {
  if (!Value.Check(argsRecordSchema, tool.args)) return undefined;
  const value = tool.args[key];
  return Value.Check(stringFieldSchema, value) && value.trim() ? value.trim() : undefined;
}

function parseResult<S extends TSchema>(tool: ToolView, schema: S): Static<S> | undefined {
  if (!tool.resultText?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(tool.resultText);
    return Value.Check(schema, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function workspaceActionLink(workspaceId: string, label = "Open workspace"): string {
  return actionLinkHtml({
    href: `/workspaces/${encodeURIComponent(workspaceId)}`,
    variant: "quiet",
    content: { kind: "caption", caption: label },
    attributesHtml: `data-action="click->nox-hub#openWorkspace" data-nox-hub-workspace-id-param="${escapeHtml(workspaceId)}"`,
  });
}

export const hubToolPresentations: ReadonlyMap<string, AgentToolPresentation> = new Map([
  ["list_projects", {
    summary(tool) {
      const result = parseResult(tool, listProjectsResultSchema);
      return result ? `List projects · ${result.projects.length}` : "List projects";
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, listProjectsResultSchema);
      const projects = result?.projects ?? [];
      if (!projects.length) return `<p class="nox-hub-tool-empty">No projects configured.</p>`;
      return detailTableHtml(projects.map((item) => ({
        label: item.name ?? item.id ?? "Project",
        html: `<code>${escapeHtml(item.id ?? "")}</code>`,
      })));
    },
  }],
  ["list_templates", {
    summary(tool) {
      const result = parseResult(tool, listTemplatesResultSchema);
      return result ? `List templates · ${result.templates.length}` : "List templates";
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, listTemplatesResultSchema);
      const templates = result?.templates ?? [];
      if (!templates.length) return `<p class="nox-hub-tool-empty">No templates configured.</p>`;
      return detailTableHtml(templates.map((item) => ({
        label: item.title ?? item.id ?? "Template",
        html: `<code>${escapeHtml(item.url ?? item.id ?? "")}</code>`,
      })));
    },
  }],
  ["list_workspaces", {
    summary(tool) {
      const result = parseResult(tool, listWorkspacesResultSchema);
      const state = stringArg(tool, "state");
      const base = state ? `List ${state} workspaces` : "List workspaces";
      return result ? `${base} · ${result.workspaces.length}` : base;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, listWorkspacesResultSchema);
      const workspaces = result?.workspaces ?? [];
      if (!workspaces.length) return `<p class="nox-hub-tool-empty">No matching workspaces.</p>`;
      return `<div class="nox-hub-tool-list">${workspaces.map((ws) => {
        const id = ws.id ?? "";
        const title = ws.title ?? id;
        const meta = [ws.template?.title, ws.state].filter(Boolean).join(" · ");
        return `<div class="nox-hub-tool-workspace-row">
          <div class="nox-hub-tool-workspace-info">
            <strong>${escapeHtml(title)}</strong>
            ${meta ? `<span class="nox-hub-tool-meta">${escapeHtml(meta)}</span>` : ""}
          </div>
          ${id ? workspaceActionLink(id, "Open") : ""}
        </div>`;
      }).join("")}</div>`;
    },
  }],
  ["create_workspace", {
    summary(tool) {
      const result = parseResult(tool, createWorkspaceResultSchema);
      const title = result?.title || stringArg(tool, "title") || stringArg(tool, "template") || "New workspace";
      const agent = result?.agentTypeId || stringArg(tool, "agent_type") || "pi";
      return `Launch ${title} (${agent})`;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, createWorkspaceResultSchema);
      const id = result?.id;
      const prompt = stringArg(tool, "prompt");
      const template = stringArg(tool, "template");
      const rows = [
        ...(template ? [{ label: "Template", html: escapeHtml(template) }] : []),
        { label: "Agent", html: escapeHtml(result?.agentTypeId ?? stringArg(tool, "agent_type") ?? "pi") },
        ...(result?.state ? [{ label: "State", html: escapeHtml(result.state) }] : []),
        ...(prompt ? [{ label: "Prompt", html: `<pre class="nox-hub-tool-pre">${escapeHtml(prompt)}</pre>` }] : []),
      ];
      return `${detailTableHtml(rows)}${id ? `<div class="nox-hub-tool-actions">${workspaceActionLink(id)}</div>` : ""}`;
    },
  }],
  ["get_workspace_status", {
    summary(tool) {
      const result = parseResult(tool, statusResultSchema);
      const label = result?.workspace?.title ?? stringArg(tool, "workspace_id") ?? "workspace";
      return result?.workspace?.state ? `Status · ${label} (${result.workspace.state})` : `Status · ${label}`;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, statusResultSchema);
      const ws = result?.workspace;
      const latest = result?.latest_message ?? undefined;
      const id = ws?.id ?? stringArg(tool, "workspace_id");
      const rows = [
        { label: "Workspace", html: escapeHtml(ws?.title ?? id ?? "") },
        ...(ws?.state ? [{ label: "State", html: escapeHtml(ws.state) }] : []),
        ...(ws?.provisioningError ? [{ label: "Error", html: escapeHtml(ws.provisioningError) }] : []),
        ...(latest ? [{ label: "Latest", html: `<pre class="nox-hub-tool-pre">${escapeHtml(latest)}</pre>` }] : []),
      ];
      return `${detailTableHtml(rows)}${id ? `<div class="nox-hub-tool-actions">${workspaceActionLink(id)}</div>` : ""}`;
    },
  }],
  ["read_workspace", {
    summary(tool) {
      const result = parseResult(tool, readWorkspaceResultSchema);
      const title = result?.workspace_title || stringArg(tool, "workspace_id") || "workspace";
      const question = stringArg(tool, "question");
      return question ? `Read ${title} · "${question.slice(0, 48)}${question.length > 48 ? "…" : ""}"` : `Read ${title}`;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, readWorkspaceResultSchema);
      const id = result?.workspace_id || stringArg(tool, "workspace_id");
      const question = stringArg(tool, "question");
      const body = result?.answer || result?.transcript || tool.resultText || "";
      const rows = [
        ...(question ? [{ label: "Question", html: escapeHtml(question) }] : []),
        { label: question ? "Answer" : "Transcript", html: `<pre class="nox-hub-tool-pre">${escapeHtml(body.slice(0, 6000))}</pre>` },
      ];
      return `${detailTableHtml(rows)}${id ? `<div class="nox-hub-tool-actions">${workspaceActionLink(id)}</div>` : ""}`;
    },
  }],
  ["send_workspace_message", {
    summary(tool) {
      const result = parseResult(tool, sendMessageResultSchema);
      const title = result?.workspace_title || stringArg(tool, "workspace_id") || "workspace";
      return `Message ${title}`;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, sendMessageResultSchema);
      const id = result?.workspace_id || stringArg(tool, "workspace_id");
      const message = stringArg(tool, "message") ?? "";
      const rows = [
        ...(result?.delivered ? [{ label: "Delivery", html: escapeHtml(result.delivered) }] : []),
        { label: "Message", html: `<pre class="nox-hub-tool-pre">${escapeHtml(message)}</pre>` },
      ];
      return `${detailTableHtml(rows)}${id ? `<div class="nox-hub-tool-actions">${workspaceActionLink(id)}</div>` : ""}`;
    },
  }],
  ["wait_for_workspaces", {
    summary(tool) {
      const ids = Value.Check(waitArgsSchema, tool.args) ? tool.args.workspace_ids.length : 0;
      const mode = stringArg(tool, "mode") ?? "all";
      return `Wait for ${ids} workspace${ids === 1 ? "" : "s"} (${mode})`;
    },
    detail(_ctx, tool) {
      const result = parseResult(tool, waitResultSchema);
      const workspaces = result?.workspaces ?? [];
      if (!workspaces.length) return `<pre class="nox-hub-tool-pre">${escapeHtml(tool.resultText ?? "")}</pre>`;
      return `<div class="nox-hub-tool-list">${workspaces.map((ws) => {
        const id = ws.id ?? "";
        return `<div class="nox-hub-tool-workspace-row">
          <div class="nox-hub-tool-workspace-info">
            <strong>${escapeHtml(ws.title ?? id)}</strong>
            ${ws.state ? `<span class="nox-hub-tool-meta">${escapeHtml(ws.state)}</span>` : ""}
            ${ws.latest_message ? `<p class="nox-hub-tool-snippet">${escapeHtml(ws.latest_message)}</p>` : ""}
          </div>
          ${id ? workspaceActionLink(id, "Open") : ""}
        </div>`;
      }).join("")}</div>`;
    },
  }],
  ["park_workspace", {
    summary(tool) {
      const parked = Value.Check(parkArgsSchema, tool.args) ? tool.args.parked : false;
      return `${parked ? "Park" : "Unpark"} ${stringArg(tool, "workspace_id") ?? "workspace"}`;
    },
    detail(_ctx, tool) {
      const id = stringArg(tool, "workspace_id");
      return id ? `<div class="nox-hub-tool-actions">${workspaceActionLink(id)}</div>` : undefined;
    },
  }],
]);
