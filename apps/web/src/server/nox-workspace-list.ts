import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { renderNoxUsageGauge } from "@agents-in-the-cloud/agent/server";
import { noxHubIconHtml, renderHubSidebarStatus } from "@agents-in-the-cloud/nox-hub/server";
import { noxCheckIconHtml, noxFilterIconHtml, noxFolderIconHtml } from "@agents-in-the-cloud/nox-projects/server";
import { escapeHtml, workspaceModuleModalFrameId } from "@agents-in-the-cloud/shared";
import type { WorkspacePhase } from "./workspace-registry.ts";

export interface NoxSidebarProject {
  id: string;
  name: string;
}

export interface NoxWorkspaceListEntry {
  id: string;
  title: string;
  parked: boolean;
  workspaceTemplate?: { id: string; title: string; swatchColor?: string };
  projectId?: string;
  phase?: WorkspacePhase;
  busy?: boolean;
  requestingAttention?: boolean;
  attentionAt?: number;
  lastActivityAt?: number;
  busyAgentKeys?: readonly string[];
}

export type NoxWorkspaceRowState = "parked" | "attention" | "running" | "idle";

export interface NoxWorkspaceSubtitle {
  base: string;
  text: string;
  timestamp?: number;
  state: NoxWorkspaceRowState;
}

export interface NoxTemplateGroup<Entry extends NoxWorkspaceListEntry> {
  id: string;
  label: string;
  workspaces: Entry[];
}

const noxComposeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>';

const noxShortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatNoxRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return "Yesterday";
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return noxShortDateFormat.format(new Date(timestamp));
}

function validTimestamp(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function noxWorkspaceRowState(workspace: NoxWorkspaceListEntry): NoxWorkspaceRowState {
  if (workspace.parked) return "parked";
  if (workspace.requestingAttention) return "attention";
  if (workspace.busy) return "running";
  return "idle";
}

export interface NoxWorkspaceStatusCounts {
  done: number;
  running: number;
  idle: number;
}

export function countNoxWorkspaceStatuses(
  workspaces: readonly NoxWorkspaceListEntry[],
  projectFilter = "",
): NoxWorkspaceStatusCounts {
  let done = 0;
  let running = 0;
  let idle = 0;
  for (const workspace of workspaces) {
    if (workspace.parked) continue;
    const projectId = workspace.projectId || "none";
    if (projectFilter && projectId !== projectFilter) continue;
    if (workspace.requestingAttention) done++;
    if (workspace.busy) running++;
    if (!workspace.requestingAttention && !workspace.busy) idle++;
  }
  return { done, running, idle };
}

export function noxWorkspaceSubtitle(workspace: NoxWorkspaceListEntry, now = Date.now()): NoxWorkspaceSubtitle {
  const state = noxWorkspaceRowState(workspace);
  let base: string;
  let timestamp: number | undefined;

  if (workspace.phase?.kind === "provisioningPhase") {
    base = workspace.phase.status === "failed"
      ? "Setup failed"
      : workspace.phase.status === "waiting"
        ? "Waiting for confirmation"
        : "Starting…";
  } else if (workspace.phase?.kind === "deletingPhase") {
    const deletionStatus = workspace.phase.deletion.status;
    base = deletionStatus === "checking"
      ? "Checking changes…"
      : deletionStatus === "blocked"
        ? "Delete needs confirmation"
        : deletionStatus === "failed"
          ? "Delete failed"
          : "Deleting…";
  } else if (workspace.parked) {
    base = "Parked";
    timestamp = validTimestamp(workspace.lastActivityAt);
  } else if (workspace.requestingAttention && workspace.busy) {
    base = "Needs you · Working";
  } else if (workspace.requestingAttention) {
    base = "Needs you";
    timestamp = validTimestamp(workspace.attentionAt ?? workspace.lastActivityAt);
  } else if (workspace.busy) {
    const busyCount = workspace.busyAgentKeys?.length ?? 0;
    base = busyCount > 1 ? `Working · ${busyCount} agents` : "Working";
  } else {
    base = "Idle";
    timestamp = validTimestamp(workspace.lastActivityAt);
  }

  const text = timestamp !== undefined ? `${base} · ${formatNoxRelativeTime(timestamp, now)}` : base;
  return { base, text, timestamp, state };
}

function groupPriority(workspace: NoxWorkspaceListEntry): number {
  if (workspace.requestingAttention) return 0;
  if (workspace.busy) return 1;
  return 2;
}

export function compareWorkspacesInGroup(left: NoxWorkspaceListEntry, right: NoxWorkspaceListEntry): number {
  const tierDiff = groupPriority(left) - groupPriority(right);
  if (tierDiff !== 0) return tierDiff;
  if (left.requestingAttention && right.requestingAttention) {
    const leftAt = left.attentionAt ?? Number.MAX_SAFE_INTEGER;
    const rightAt = right.attentionAt ?? Number.MAX_SAFE_INTEGER;
    if (leftAt !== rightAt) return leftAt - rightAt;
  }
  const activityDiff = (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0);
  if (activityDiff !== 0) return activityDiff;
  return left.id.localeCompare(right.id);
}

export function groupWorkspacesByTemplate<Entry extends NoxWorkspaceListEntry>(workspaces: readonly Entry[]): NoxTemplateGroup<Entry>[] {
  const groups = new Map<string, NoxTemplateGroup<Entry>>();
  for (const workspace of workspaces) {
    const id = workspace.workspaceTemplate?.id ?? "";
    const label = workspace.workspaceTemplate?.title ?? "No Template";
    let group = groups.get(id);
    if (!group) {
      group = { id, label, workspaces: [] };
      groups.set(id, group);
    }
    group.workspaces.push(workspace);
  }
  const sortedGroups = [...groups.values()].sort((left, right) => {
    if (left.id === "" && right.id !== "") return 1;
    if (right.id === "" && left.id !== "") return -1;
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);
  });
  for (const group of sortedGroups) group.workspaces.sort(compareWorkspacesInGroup);
  return sortedGroups;
}

function renderProjectFilterPopup<Entry extends NoxWorkspaceListEntry>(
  active: readonly Entry[],
  projects: readonly NoxSidebarProject[],
): string {
  const noProjectCount = active.filter((ws) => !ws.projectId).length;
  const counts = new Map<string, number>();
  for (const ws of active) {
    if (ws.projectId) counts.set(ws.projectId, (counts.get(ws.projectId) ?? 0) + 1);
  }
  const allRow = contentRowHtml({
    width: "fill",
    kind: "compact",
    label: { kind: "text", text: "All Projects" },
    trailingHtml: `<span class="nox-project-option__check" aria-hidden="true">${noxCheckIconHtml}</span>`,
    element: {
      tag: "button",
      attributesHtml: 'type="button" role="menuitemradio" aria-checked="true" data-nox-project-option="" data-action="click->nox-workspace-list#selectProject" data-nox-workspace-list-project-param=""',
    },
  });
  const noneRow = contentRowHtml({
    width: "fill",
    kind: "multiline",
    leadingHtml: noxFolderIconHtml,
    label: { kind: "text", text: "No Project" },
    description: String(noProjectCount),
    trailingHtml: `<span class="nox-project-option__check" aria-hidden="true">${noxCheckIconHtml}</span>`,
    primary: {
      tag: "button",
      attributesHtml: 'type="button" role="menuitemradio" aria-checked="false" data-nox-project-option="none" data-action="click->nox-workspace-list#selectProject" data-nox-workspace-list-project-param="none"',
    },
  });
  const projectRows = projects.map((project) => contentRowHtml({
    width: "fill",
    kind: "multiline",
    leadingHtml: noxFolderIconHtml,
    label: { kind: "text", text: project.name },
    description: String(counts.get(project.id) ?? 0),
    trailingHtml: `<span class="nox-project-option__check" aria-hidden="true">${noxCheckIconHtml}</span>`,
    primary: {
      tag: "button",
      attributesHtml: `type="button" role="menuitemradio" aria-checked="false" data-nox-project-option="${escapeHtml(project.id)}" data-action="click->nox-workspace-list#selectProject" data-nox-workspace-list-project-param="${escapeHtml(project.id)}"`,
    },
  })).join("");
  const manageLink = `<a class="nox-project-menu__manage" href="/projects/manage" data-turbo-frame="${workspaceModuleModalFrameId}">Manage</a>`;
  const contentHtml = `<div class="nox-project-menu">
    <div class="nox-project-menu__header">
      <span class="nox-project-menu__title">Project</span>
      ${manageLink}
    </div>
    ${allRow}
    <hr class="popup-menu__separator">
    ${noneRow}
    ${projectRows}
  </div>`;
  return `<div class="nox-project-filter-anchor" data-nox-project-filter-anchor>${popupHtml({
    id: "nox_project_filter_popup",
    label: "Filter by project",
    placement: "below",
    trigger: {
      variant: "quiet",
      content: { kind: "icon-only", iconHtml: noxFilterIconHtml, label: "Filter by project" },
      attributesHtml: 'data-nox-project-filter-trigger aria-pressed="false"',
    },
    contentHtml,
  })}</div>`;
}

export function renderNoxWorkspaceRows<Entry extends NoxWorkspaceListEntry>(
  workspaces: readonly Entry[],
  renderRow: (workspace: Entry, index: number) => string,
  projects: readonly NoxSidebarProject[] = [],
): string {
  const active = workspaces.filter((workspace) => !workspace.parked);
  const parked = workspaces.filter((workspace) => workspace.parked);
  const { done: doneCount, running: runningCount, idle: idleCount } = countNoxWorkspaceStatuses(active);

  const statusStrip = active.length || projects.length
    ? `<div class="nox-status-strip" role="toolbar" aria-label="Workspace status">
        <button type="button" class="nox-status-chip${doneCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="attention" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="attention" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--attention" aria-hidden="true"></i><span data-nox-filter-chip-label>${doneCount} Done</span></button>
        <button type="button" class="nox-status-chip${runningCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="running" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="running" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--running" aria-hidden="true"></i><span data-nox-filter-chip-label>${runningCount} Running</span></button>
        <button type="button" class="nox-status-chip${idleCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="idle" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="idle" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--idle" aria-hidden="true"></i><span data-nox-filter-chip-label>${idleCount} Idle</span></button>
        <span class="nox-status-strip__spacer" aria-hidden="true"></span>
        ${renderProjectFilterPopup(active, projects)}
      </div>`
    : "";

  let index = 0;
  const groupsHtml = groupWorkspacesByTemplate(active).map((group) => {
    const addLabel = group.id ? `New workspace from ${group.label}` : "New empty workspace";
    const addHref = group.id ? `/launch-composer?workspaceTemplate=${encodeURIComponent(group.id)}` : "/launch-composer";
    const rowsHtml = group.workspaces.map((workspace) => renderRow(workspace, index++)).join("");
    return `<section class="nox-template-group" data-nox-template-group="${escapeHtml(group.id)}">
      <div class="nox-template-group__header">
        <span class="nox-template-group__name">${escapeHtml(group.label)}</span>
        <span class="nox-template-group__rule" aria-hidden="true"></span>
        <a class="nox-template-group__add" href="${escapeHtml(addHref)}" data-turbo="true" data-turbo-frame="launch_composer" title="${escapeHtml(addLabel)}" aria-label="${escapeHtml(addLabel)}">${Icons.Plus}</a>
      </div>
      <div class="nox-template-group__rows">${rowsHtml}</div>
    </section>`;
  }).join("");

  const emptyFilter = active.length
    ? '<p class="nox-list-empty-filter">No workspaces match this filter.</p>'
    : "";

  const parkedHtml = parked.length
    ? `<details id="workspace_pane_parked" class="nox-parked">
        <summary class="nox-parked__toggle" data-workspace-parked>
          <span class="nox-parked__label-closed">Parked (${parked.length})</span>
          <span class="nox-parked__label-open">Hide Parked</span>
        </summary>
        <div class="nox-parked__rows">${parked.map((workspace, parkedIndex) => renderRow(workspace, parkedIndex)).join("")}</div>
      </details>`
    : "";

  return `${statusStrip}<div class="nox-workspace-groups">${groupsHtml}${emptyFilter}</div>${parkedHtml}`;
}

export function renderNoxHubSidebarButton(): string {
  return `<div class="nox-hub-sidebar-slot" data-controller="nox-hub-sidebar">
    <a class="nox-hub-sidebar-button" href="/hub" title="Open Hub" aria-expanded="false" aria-controls="nox_hub_host" data-turbo-stream="true" data-nox-hub-sidebar-link>
      <span class="nox-hub-sidebar-button__icon">${noxHubIconHtml}</span>
      <span class="nox-hub-sidebar-button__label">Hub</span>
      ${renderHubSidebarStatus({ busy: false, requestingAttention: false, runningCount: 0 })}
    </a>
  </div>`;
}

export function renderNoxWorkspaceListHeaderAction(hasWorkspaces: boolean): string {
  const guide = hasWorkspaces ? "" : ' data-first-workspace-destination="new-workspace"';
  return `<button type="button" class="nox-header-new" title="New workspace" aria-label="New workspace" data-workspace-pane-target="newWorkspace" data-action="workspace-pane#openPicker"${guide}>${noxComposeIcon}</button>`;
}

export function renderNoxWorkspaceListBar(settingsAttributesHtml: string): string {
  const item = (iconHtml: string, label: string) => `<span class="nox-list-bar__icon">${iconHtml}</span><span class="nox-list-bar__label">${label}</span>`;
  return `<nav class="nox-list-bar" aria-label="App">
    <a class="nox-list-bar__item" href="/models" data-turbo-stream="true">${item(renderNoxUsageGauge(), "Models")}</a>
    <a class="nox-list-bar__item" href="/settings" ${settingsAttributesHtml}>${item(Icons.Settings, "Settings")}</a>
    <span class="nox-list-bar__spacer" aria-hidden="true"></span>
    <button type="button" class="nox-list-bar__new" data-action="workspace-pane#openPicker" aria-label="New workspace" title="New workspace">${noxComposeIcon}</button>
  </nav>`;
}
