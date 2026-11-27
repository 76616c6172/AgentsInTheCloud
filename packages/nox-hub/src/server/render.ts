import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { ids } from "@agents-in-the-cloud/agent/server/render-context";
import { LiveTranscriptRenderer } from "@agents-in-the-cloud/builtin-agent/server/render-live-transcript";
import { renderSharedComposerSelections } from "@agents-in-the-cloud/llm/server";
import { noxCheckIconHtml, noxFolderIconHtml } from "@agents-in-the-cloud/nox-projects/server";
import { domId, escapeHtml, placeLiveRegions, workspaceModuleModalFrameId, type LiveRegion } from "@agents-in-the-cloud/shared";
import type { HubProjectSummary, HubTemplateSummary, HubWorkspaceSummary } from "./bridge.ts";
import { hubModelOptionsFor } from "./model-selection.ts";
import type { HubThreadSnapshot, HubThreadSummary } from "./runtime.ts";

export const hubHostId = "nox_hub_host";
export const hubSidebarStatusId = "nox_hub_sidebar_status";
export const hubThreadListId = "nox_hub_thread_list";
export const hubComposerActionsId = (threadId: string) => domId("nox_hub_actions", threadId);

export const noxHubIconHtml = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>';

const shortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return "Yesterday";
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return shortDateFormat.format(new Date(timestamp));
}

export function renderHubSidebarStatusInner(status: { busy: boolean; requestingAttention: boolean; runningCount: number }): string {
  const cls = status.requestingAttention
    ? "nox-hub-sidebar-dot nox-hub-sidebar-dot--attention"
    : status.busy
      ? "nox-hub-sidebar-dot nox-hub-sidebar-dot--running"
      : "nox-hub-sidebar-dot";
  const label = status.requestingAttention
    ? "Hub has an update"
    : status.busy
      ? `Hub is working (${status.runningCount})`
      : "";
  return `<span class="${cls}"${label ? ` title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}></span>`;
}

export function renderHubSidebarStatus(status: { busy: boolean; requestingAttention: boolean; runningCount: number }): string {
  return `<span id="${hubSidebarStatusId}" class="nox-hub-sidebar-status">${renderHubSidebarStatusInner(status)}</span>`;
}

export function renderHubThreadListItems(
  threads: readonly HubThreadSummary[],
  selectedThreadId: string,
  projects: readonly HubProjectSummary[] = [],
): string {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  return threads.map((thread) => {
    const active = thread.threadId === selectedThreadId;
    const stateClass = thread.requestingAttention
      ? "is-attention"
      : thread.busy
        ? "is-running"
        : "is-idle";
    const projectName = thread.projectId ? projectNames.get(thread.projectId) : undefined;
    const statusText = thread.busy
      ? "Working"
      : thread.requestingAttention
        ? "Done"
        : relativeTime(thread.updatedAt);
    const meta = projectName ? `${projectName} · ${statusText}` : statusText;
    const deleteForm = threads.length > 1
      ? `<form class="nox-hub-thread-delete" method="post" action="/hub/threads/${encodeURIComponent(thread.threadId)}/delete" data-turbo-stream="true">
          ${destructiveConfirmationHtml({
            id: domId("nox_hub_delete", thread.threadId),
            trigger: { type: "button", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Trash, label: `Delete ${thread.title}` } },
            confirmCaption: "Delete",
            cancelCaption: "Keep",
          })}
        </form>`
      : "";
    return `<div class="nox-hub-thread-row${active ? " is-active" : ""}">
      <a class="nox-hub-thread-link" href="/hub/${encodeURIComponent(thread.threadId)}" data-turbo-stream="true"${active ? ' aria-current="page"' : ""}>
        <span class="nox-hub-thread-dot ${stateClass}" aria-hidden="true"></span>
        <span class="nox-hub-thread-copy">
          <span class="nox-hub-thread-title">${escapeHtml(thread.title)}</span>
          <span class="nox-hub-thread-meta">${escapeHtml(meta)}</span>
        </span>
      </a>
      ${deleteForm}
    </div>`;
  }).join("");
}

export function renderHubThreadList(
  threads: readonly HubThreadSummary[],
  selectedThreadId: string,
  projects: readonly HubProjectSummary[] = [],
): string {
  return `<div id="${hubThreadListId}" class="nox-hub-thread-list">${renderHubThreadListItems(threads, selectedThreadId, projects)}</div>`;
}

export function renderHubComposerControlsInner(threadId: string, busy: boolean): string {
  const send = buttonHtml({
    type: "submit",
    variant: "primary",
    content: { kind: "caption", caption: busy ? "Queue" : "Send" },
    attributesHtml: `form="${escapeHtml(domId("nox_hub_composer_form", threadId))}"`,
  });
  const stop = busy
    ? `<form class="nox-hub-stop-form" method="post" action="/hub/threads/${encodeURIComponent(threadId)}/abort" data-turbo-stream="true">
        ${buttonHtml({ type: "submit", variant: "secondary", content: { kind: "caption", caption: "Stop" } })}
      </form>`
    : "";
  return `${stop}${send}`;
}

export function renderHubComposerControls(threadId: string, busy: boolean): string {
  return `<div id="${hubComposerActionsId(threadId)}" class="nox-hub-composer-actions">${renderHubComposerControlsInner(threadId, busy)}</div>`;
}

export function hubComposerControlRegions(threadId: string, busy: boolean): LiveRegion[] {
  return [{ target: hubComposerActionsId(threadId), html: renderHubComposerControlsInner(threadId, busy) }];
}

function renderLaunchedWorkspacesBar(
  launchedIds: readonly string[],
  workspaces: readonly HubWorkspaceSummary[],
): string {
  if (!launchedIds.length) return "";
  const byId = new Map(workspaces.map((ws) => [ws.id, ws]));
  const pills = launchedIds.flatMap((id) => {
    const ws = byId.get(id);
    if (!ws) return [];
    const dotClass = ws.requestingAttention
      ? "is-attention"
      : ws.busy || ws.state === "provisioning"
        ? "is-running"
        : "is-idle";
    return [`<a class="nox-hub-launched-pill" href="${escapeHtml(ws.url)}" data-action="click->nox-hub#openWorkspace" data-nox-hub-workspace-id-param="${escapeHtml(ws.id)}">
      <span class="nox-hub-thread-dot ${dotClass}" aria-hidden="true"></span>
      <span>${escapeHtml(ws.title)}</span>
    </a>`];
  });
  if (!pills.length) return "";
  return `<div class="nox-hub-launched-bar" aria-label="Workspaces launched in this thread">${pills.join("")}</div>`;
}

function renderEmptyWelcome(templates: readonly HubTemplateSummary[], workspaces: readonly HubWorkspaceSummary[]): string {
  const activeCount = workspaces.filter((ws) => !ws.parked).length;
  const runningCount = workspaces.filter((ws) => !ws.parked && (ws.busy || ws.state === "provisioning")).length;
  const templateChips = templates.slice(0, 6).map((template) =>
    `<span class="nox-hub-welcome-chip">${escapeHtml(template.title)}</span>`,
  ).join("");
  return `<div class="nox-hub-welcome">
    <div class="nox-hub-welcome-mark">${noxHubIconHtml}</div>
    <h2 class="nox-hub-welcome-title">Hub</h2>
    <p class="nox-hub-welcome-body">Coordinate parallel work across isolated workspaces. Ask Hub to spin up tasks, inspect active threads, or follow up with running agents.</p>
    <div class="nox-hub-welcome-stats">
      <span>${activeCount} active workspace${activeCount === 1 ? "" : "s"}</span>
      ${runningCount ? `<span>· ${runningCount} running</span>` : ""}
      ${templates.length ? `<span>· ${templates.length} template${templates.length === 1 ? "" : "s"}</span>` : ""}
    </div>
    ${templateChips ? `<div class="nox-hub-welcome-templates">${templateChips}</div>` : ""}
  </div>`;
}

function renderHubProjectScopeSelector(
  threadId: string,
  currentProjectId: string | undefined,
  projects: readonly HubProjectSummary[],
): string {
  const formId = domId("nox_hub_project_form", threadId);
  const activeProject = currentProjectId ? projects.find((project) => project.id === currentProjectId) : undefined;
  const caption = activeProject ? activeProject.name : "All Projects";
  const allItem = contentRowHtml({
    width: "fill",
    kind: "compact",
    label: { kind: "text", text: "All Projects" },
    trailingHtml: activeProject ? "" : noxCheckIconHtml,
    element: {
      tag: "button",
      attributesHtml: `type="submit" name="projectId" value="" form="${escapeHtml(formId)}" role="menuitemradio" aria-checked="${!activeProject}"`,
    },
  });
  const projectItems = projects.map((project) => contentRowHtml({
    width: "fill",
    kind: "compact",
    leadingHtml: noxFolderIconHtml,
    label: { kind: "text", text: project.name },
    trailingHtml: activeProject?.id === project.id ? noxCheckIconHtml : "",
    element: {
      tag: "button",
      attributesHtml: `type="submit" name="projectId" value="${escapeHtml(project.id)}" form="${escapeHtml(formId)}" role="menuitemradio" aria-checked="${activeProject?.id === project.id}"`,
    },
  })).join("");
  const manageItem = contentRowHtml({
    width: "fill",
    kind: "compact",
    label: { kind: "text", text: "Manage projects…" },
    element: {
      tag: "a",
      attributesHtml: `href="/projects/manage" data-turbo-frame="${workspaceModuleModalFrameId}" role="menuitem"`,
    },
  });
  const popup = popupHtml({
    id: domId("nox_hub_project_popup", threadId),
    label: "Scope Hub thread to project",
    placement: "below",
    trigger: {
      variant: "quiet",
      content: { kind: "caption", caption, iconHtml: noxFolderIconHtml },
    },
    contentHtml: `${allItem}${projectItems ? `<hr class="popup-menu__separator">${projectItems}` : ""}<hr class="popup-menu__separator">${manageItem}`,
  });
  return `<form id="${escapeHtml(formId)}" method="post" action="/hub/threads/${encodeURIComponent(threadId)}/project" data-turbo-stream="true" hidden></form><div class="nox-hub-project-scope${activeProject ? " is-scoped" : ""}">${popup}</div>`;
}

export async function renderHubSurface(options: {
  threads: readonly HubThreadSummary[];
  active: HubThreadSnapshot;
  projects: readonly HubProjectSummary[];
  templates: readonly HubTemplateSummary[];
  workspaces: readonly HubWorkspaceSummary[];
}): Promise<string> {
  const { threads, active, projects, templates, workspaces } = options;
  const { summary, items, modelContext, ctx } = active;
  const threadId = summary.threadId;
  const { models, thinkingLevels } = await hubModelOptionsFor(summary.model ?? null);

  const modelFormId = domId("nox_hub_model_form", threadId);
  const thinkingFormId = domId("nox_hub_thinking_form", threadId);
  const composerFormId = domId("nox_hub_composer_form", threadId);
  const selectionsHtml = renderSharedComposerSelections({
    modelFormId,
    thinkingLevelFormId: thinkingFormId,
    models,
    thinkingLevels,
    selectedThinkingLevel: summary.thinkingLevel ?? thinkingLevels[0] ?? "",
    autosubmitThinking: true,
    connectedProvider: models.some((model) => model.available),
  });

  const newThreadProjectInput = summary.projectId
    ? `<input type="hidden" name="projectId" value="${escapeHtml(summary.projectId)}">`
    : "";
  const newThreadButton = `<form method="post" action="/hub/threads" data-turbo-stream="true">
    ${newThreadProjectInput}
    ${buttonHtml({
      type: "submit",
      variant: "quiet",
      content: { kind: "icon-only", iconHtml: Icons.Plus, label: "New Hub thread" },
    })}
  </form>`;

  const toggleThreadsButton = buttonHtml({
    type: "button",
    variant: "quiet",
    content: { kind: "icon-only", iconHtml: Icons.Sidebar, label: "Toggle Hub threads" },
    attributesHtml: 'data-action="click->nox-hub#toggleRail"',
  });

  const launchedBar = renderLaunchedWorkspacesBar(summary.launchedWorkspaceIds, workspaces);
  const threadUrl = `/hub/${encodeURIComponent(threadId)}`;
  const scopedWorkspaces = summary.projectId ? workspaces.filter((ws) => ws.projectId === summary.projectId) : workspaces;
  const scopedTemplates = summary.projectId ? templates.filter((tpl) => tpl.projectId === summary.projectId) : templates;
  const welcomeHtml = items.length ? "" : renderEmptyWelcome(scopedTemplates, scopedWorkspaces);
  const projectScopeHtml = renderHubProjectScopeSelector(threadId, summary.projectId, projects);

  const shell = `<section id="nox_hub_surface" class="nox-hub-surface" data-controller="nox-hub" data-nox-hub-thread-id-value="${escapeHtml(threadId)}" data-nox-hub-location-value="${escapeHtml(threadUrl)}" data-action="keydown->nox-hub#keydown">
    <aside class="nox-hub-rail" data-nox-hub-target="rail" aria-label="Hub threads">
      <header class="nox-hub-rail-header">
        <span class="nox-hub-rail-brand">${noxHubIconHtml}<span>Hub</span></span>
        ${newThreadButton}
      </header>
      <div class="nox-hub-rail-scroll">
        ${renderHubThreadList(threads, threadId, projects)}
      </div>
    </aside>
    <div class="nox-hub-main">
      <header class="nox-hub-header">
        <div class="nox-hub-header-left">
          <span class="nox-hub-rail-toggle">${toggleThreadsButton}</span>
          <h1 class="nox-hub-header-title">${escapeHtml(summary.title)}</h1>
        </div>
        <div class="nox-hub-header-right">
          ${projectScopeHtml}
        </div>
      </header>
      ${launchedBar}
      <div class="nox-hub-scroll" data-nox-hub-target="scroll">
        ${welcomeHtml}
        <div id="${ids.transcript(ctx)}" class="nox-hub-transcript agent-transcript" data-nox-hub-target="transcript"></div>
      </div>
      <div class="nox-hub-composer-wrap">
        <form id="${escapeHtml(modelFormId)}" method="post" action="/hub/threads/${encodeURIComponent(threadId)}/model" data-turbo-stream="true" hidden></form>
        <form id="${escapeHtml(thinkingFormId)}" method="post" action="/hub/threads/${encodeURIComponent(threadId)}/thinking-level" data-turbo-stream="true" hidden></form>
        <form id="${escapeHtml(composerFormId)}" class="nox-hub-composer-form" method="post" action="/hub/threads/${encodeURIComponent(threadId)}/messages" data-turbo-stream="true" data-action="submit->nox-hub#afterSubmit">
          <div class="composer-surface nox-hub-composer-surface">
            <textarea class="composer-input nox-hub-composer-input" name="text" rows="2" placeholder="Ask Hub to launch, inspect, or coordinate workspaces…" aria-label="Message Hub" data-nox-hub-target="input" data-action="keydown->nox-hub#inputKeydown input->nox-hub#resizeInput"></textarea>
            <div class="nox-hub-composer-footer">
              <div class="nox-hub-composer-selections">${selectionsHtml}</div>
              ${renderHubComposerControls(threadId, summary.busy)}
            </div>
          </div>
        </form>
      </div>
    </div>
  </section>`;

  if (!items.length) return shell;
  const renderer = new LiveTranscriptRenderer();
  return placeLiveRegions(shell, [renderer.renderTranscript(ctx, items, modelContext)], "nox_hub_surface");
}
