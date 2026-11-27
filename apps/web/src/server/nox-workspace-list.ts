import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { renderNoxUsageGauge } from "@agents-in-the-cloud/agent/server";
import { escapeHtml } from "@agents-in-the-cloud/shared";
import type { WorkspacePhase } from "./workspace-registry.ts";

/* Nox: Whisper Minimal workspace sidebar — template grouping with within-group
 * attention -> working -> idle priority, quiet 2nd-line status on every row,
 * an inline status filter strip, centered Parked disclosure, and a unified
 * calm footer shared between desktop and mobile. */

export interface NoxWorkspaceListEntry {
  id: string;
  title: string;
  parked: boolean;
  workspaceTemplate?: { id: string; title: string; swatchColor?: string };
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

export function renderNoxWorkspaceRows<Entry extends NoxWorkspaceListEntry>(
  workspaces: readonly Entry[],
  renderRow: (workspace: Entry, index: number) => string,
): string {
  const active = workspaces.filter((workspace) => !workspace.parked);
  const parked = workspaces.filter((workspace) => workspace.parked);
  const doneCount = active.filter((workspace) => workspace.requestingAttention).length;
  const runningCount = active.filter((workspace) => workspace.busy).length;
  const idleCount = active.filter((workspace) => !workspace.requestingAttention && !workspace.busy).length;

  const statusStrip = active.length
    ? `<div class="nox-status-strip" role="toolbar" aria-label="Workspace status">
        <button type="button" class="nox-status-chip${doneCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="attention" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="attention" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--attention" aria-hidden="true"></i><span>${doneCount} Done</span></button>
        <button type="button" class="nox-status-chip${runningCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="running" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="running" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--running" aria-hidden="true"></i><span>${runningCount} Running</span></button>
        <button type="button" class="nox-status-chip${idleCount === 0 ? " is-zero" : ""}" data-nox-filter-chip="idle" data-action="click->nox-workspace-list#toggleFilter" data-nox-workspace-list-filter-param="idle" aria-pressed="false"><i class="nox-status-chip__dot nox-status-chip__dot--idle" aria-hidden="true"></i><span>${idleCount} Idle</span></button>
        <span class="nox-status-strip__spacer" aria-hidden="true"></span>
        <button type="button" class="nox-status-clear" data-action="click->nox-workspace-list#clearFilter" aria-label="Clear filter" title="Clear filter">${Icons.Close}</button>
      </div>`
    : "";

  let index = 0;
  const groupsHtml = groupWorkspacesByTemplate(active).map((group) => {
    const addLabel = group.id ? `New workspace from ${group.label}` : "New empty workspace";
    const rowsHtml = group.workspaces.map((workspace) => renderRow(workspace, index++)).join("");
    return `<section class="nox-template-group" data-nox-template-group="${escapeHtml(group.id)}">
      <div class="nox-template-group__header">
        <span class="nox-template-group__name">${escapeHtml(group.label)}</span>
        <span class="nox-template-group__rule" aria-hidden="true"></span>
        <button type="button" class="nox-template-group__add" title="${escapeHtml(addLabel)}" aria-label="${escapeHtml(addLabel)}" data-action="workspace-pane#openPickerFor" data-workspace-pane-workspace-template-param="${escapeHtml(group.id)}">${Icons.Plus}</button>
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
