import { workspaceTemplateChoiceHtml } from "./workspace-template-presentation.ts";
import { noxWorkspaceGlyph } from "./nox-workspace-glyph.ts";
import { disclosureHtml } from "@agents-in-the-cloud/design-system/disclosure";
import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { addBadgeHtml } from "@agents-in-the-cloud/design-system/add-badge";
import { buttonHtml, type ButtonVariant } from "@agents-in-the-cloud/design-system/button";
import { buttonGroupHtml } from "@agents-in-the-cloud/design-system/button-group";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { panelHtml } from "@agents-in-the-cloud/design-system/panel";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { tabHtml, tabStripHtml } from "@agents-in-the-cloud/design-system/tab-strip";
import { domId, escapeHtml, turboStream, workspaceWorkViewLabelDomId } from "@agents-in-the-cloud/shared";
import { formatShortcutBinding } from "../shortcut-binding.ts";
import { renderAgentViewSwitch, renderAgentPane, renderMobileAgentAttention, renderPhoneAgentTypeOptions, renderPhoneWorkspaceActions, type AgentPaneContribution } from "./agent-pane.ts";
import { renderPwaReminder } from "./pwa-reminder.ts";
import type { WorkspaceDeletionState } from "./workspace-registry.ts";
import { outdatedImageMessage } from "./workspace-warnings.ts";
import type { WorkspaceWorkViewState } from "@agents-in-the-cloud/workspace";
import { barButton, behaviorTurboStream, busyAttentionIndicator, fullscreenViewAttributes, selectorCloseForm, type ViewCloseAction } from "./workspace-view-markup.ts";

export type WorkViewAvailability =
  | { phase: "opening"; detail?: string }
  | { phase: "live" }
  | { phase: "reconnecting"; detail?: string }
  | { phase: "unavailable"; detail: string };

export interface WorkspacePaneEntry {
  id: string;
  title: string;
  active?: boolean;
  parked: boolean;
  workspaceTemplate?: { id: string; title: string; swatchColor?: string };
  busy?: boolean;
  requestingAttention?: boolean;
  attentionAt?: number;
  lastActivityAt?: number;
  busyAgentKeys?: readonly string[];
  outdated?: boolean;
  warnings?: readonly { message: string }[];
}

export interface WorkspacePaneWorkspaceTemplate {
  id: string;
  title: string;
  swatchColor?: string;
  lastUsedAt?: number;
}

export interface WorkPaneContribution {
  iconHtml?: string;
  /** Stable, type-native serialized identity supplied by the resource adapter. */
  key: string;
  label: string;
  kind: "resource" | "contextual";
  requestingAttention?: boolean;
  attentionSequence?: number;
  availability: WorkViewAvailability;
  bodyHtml?: string;
  sourceKey?: string;
  actionsHtml?: string;
  close?: ViewCloseAction;
}

export interface WorkspacePanePresentation {
  workspaceTemplates: readonly WorkspacePaneWorkspaceTemplate[];
  /** Already ordered by the workspace registry. */
  workspaces: readonly WorkspacePaneEntry[];
}

export interface WorkspacePresentation {
  initialSelection?: { agent?: string; workView?: string };
  workspace: Pick<WorkspacePaneEntry, "id" | "title">;
  agents: readonly AgentPaneContribution[];
  agentTypes: readonly { id: string; label: string; iconHtml: string }[];
  workViews: readonly WorkPaneContribution[];
  commands?: readonly { id: string; label: string; description?: string; scope: string; iconHtml?: string; placement?: "work-launcher" | "agent-action"; binding?: string; shortcutCommandId?: string }[];
  overlayHtml?: readonly string[];
  warningsHtml?: string;
  workPresentationIntent?: { key: string; revision: string };
}

function closeForm(close: ViewCloseAction, buttonHtml: string): string {
  return `<form data-turbo="true" method="post" action="${escapeHtml(close.action)}" data-close-label="${escapeHtml(close.label)}" data-action="submit->workspace-presentation#confirmClose">${buttonHtml}</form>`;
}

function workspaceStatusSlot(content: string): string {
  return `<span class="fixed-shell-workspace-status content-row__status">${content}</span>`;
}

/* Busy and attention live in the row's glyph (nox-workspace-glyph.ts); warnings stay trailing. */
function workspaceStatus(workspace: WorkspacePaneEntry) {
  const warnings = (workspace.warnings ?? []).map((warning) => warning.message);
  if (workspace.outdated) warnings.push(outdatedImageMessage);
  const activity = [workspace.busy && "Working", workspace.requestingAttention && "Needs attention"].filter(Boolean).join(" · ");
  const label = activity || warnings.join("\n") || (workspace.parked ? "Parked" : "Idle");
  const html = warnings.length ? workspaceStatusSlot(`<i class="fixed-shell-workspace-warning" role="img" aria-label="${escapeHtml(warnings.join("\n"))}" title="${escapeHtml(warnings.join("\n"))}">⚠︎</i>`) : "";
  return { label, html };
}

function renderWorkspaceRow(workspace: WorkspacePaneEntry, index: number): string {
  const { parked, workspaceTemplate } = workspace;
  const id = workspaceRowDomId(workspace.id);
  const attentionAt = workspace.attentionAt === undefined ? "" : ` data-workspace-attention-at="${workspace.attentionAt}"`;
  const lastActivityAt = workspace.lastActivityAt === undefined ? "" : ` data-workspace-last-activity-at="${workspace.lastActivityAt}"`;
  const workspaceTemplateAttribute = workspaceTemplate ? ` data-workspace-template-id="${escapeHtml(workspaceTemplate.id)}"` : "";
  const busyAgents = workspace.busyAgentKeys?.length ? ` data-workspace-busy-agents="${escapeHtml(JSON.stringify(workspace.busyAgentKeys))}"` : "";
  const label = parked ? `Unpark and open ${workspace.title}` : workspace.title;
  const status = workspaceStatus(workspace);
  const tooltip = [workspaceTemplate?.title, label, status.label].filter(Boolean).join(" · ");
  const newFromTemplate = workspaceTemplate ? `New workspace from ${workspaceTemplate.title}` : "New empty workspace";
  const glyph = noxWorkspaceGlyph(workspace);
  const row = contentRowHtml({
    width: "fill",
    kind: "compact",
    container: parked ? undefined : { attributesHtml: `data-workspace-order="${index}"` },
    label: { kind: "text", text: workspace.title },
    trailingHtml: status.html,
    leadingActionsHtml: `<button type="button" class="workspace-template-icon-button nox-workspace-glyph"${glyph.attributesHtml} title="${escapeHtml(newFromTemplate)}" aria-label="${escapeHtml(newFromTemplate)}" data-action="workspace-pane#openPickerFor" data-workspace-pane-workspace-template-param="${escapeHtml(workspaceTemplate?.id ?? "")}">${glyph.html}</button>`,
    primary: {
      tag: "button",
      attributesHtml: `${parked ? 'data-workspace-parked' : `id="${id}"`} type="${parked ? "submit" : "button"}" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(`${label} · ${status.label}`)}"${workspace.active ? ' aria-current="page"' : ""} data-workspace-entry-id="${escapeHtml(workspace.id)}"${attentionAt}${lastActivityAt}${busyAgents}${workspaceTemplateAttribute}${parked ? "" : ' data-action="click->workspace-navigation#selectWorkspace"'}`,
    },
  });
  return parked
    ? `<form id="${id}" method="post" action="/workspaces/${encodeURIComponent(workspace.id)}/unpark" data-action="submit->workspace-navigation#unparkWorkspace">${row}</form>`
    : row;
}

const workspaceTemplateDialogTarget = 'data-turbo-frame="_top" data-turbo-stream="true"';

function workspaceRowDomId(id: string): string { return domId("workspace_row", id); }

function renderWorkspaceRows(presentation: WorkspacePanePresentation): string {
  const active = presentation.workspaces.filter((workspace) => !workspace.parked);
  const parked = presentation.workspaces.filter((workspace) => workspace.parked);
  const parkedGroup = parked.length ? disclosureHtml({
    element: { id: "workspace_pane_parked" },
    summary: { kind: "compact", width: "fill", attributesHtml: "data-workspace-parked", label: { kind: "text", text: "Parked" } },
    bodyHtml: parked.map(renderWorkspaceRow).join(""),
  }) : "";
  return `${active.map(renderWorkspaceRow).join("")}${parkedGroup}${noxPhoneWorkspaceGroups}`;
}

/* Phone-only status headings. They follow the rows so CSS counters can total each
 * group, and CSS orders them visually; browser-owned row arrangement is unaffected. */
const noxPhoneWorkspaceGroups = [["attention", "Needs you"], ["busy", "Working"], ["idle", "Idle"]]
  .map(([group, label]) => `<div class="nox-workspace-group" data-nox-workspace-group="${group}" aria-hidden="true">${label}</div>`).join("");

function renderNewWorkspaceRow(presentation: WorkspacePanePresentation): string {
  const guide = presentation.workspaces.length ? "" : ' data-first-workspace-destination="new-workspace"';
  return contentRowHtml({
    width: "fill",
    kind: "compact",
    leadingHtml: Icons.Plus,
    label: { kind: "text", text: "New workspace" },
    element: { tag: "button", attributesHtml: `type="button" data-workspace-pane-target="newWorkspace" data-action="workspace-pane#openPicker"${guide}` },
  });
}

function renderWorkspaceTemplateOption(workspaceTemplate?: WorkspacePaneWorkspaceTemplate): string {
  return workspaceTemplateChoiceHtml(workspaceTemplate, {
    emptyLabel: "Nothing",
    primaryAttributesHtml: `type="submit" role="radio" aria-checked="false" tabindex="-1" data-workspace-pane-target="option" data-workspace-template-id="${escapeHtml(workspaceTemplate?.id ?? "")}" data-action="workspace-pane#choose keydown->workspace-pane#optionKeydown"`,
  });
}

function renderWorkspaceTemplateOptions(presentation: WorkspacePanePresentation): string {
  const ordered = [...presentation.workspaceTemplates].sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0) || left.title.localeCompare(right.title));
  // Until the first template exists, the add action explains what a template is.
  const addWorkspaceTemplate = ordered.length
    ? contentRowHtml({
      width: "fill",
      kind: "compact",
      leadingHtml: addBadgeHtml(),
      label: { kind: "text", text: "A repo I haven’t added yet…" },
      element: { tag: "a", attributesHtml: `href="/workspace-templates/new" ${workspaceTemplateDialogTarget}` },
    })
    : `<a class="workspace-template-first" href="/workspace-templates/new" ${workspaceTemplateDialogTarget} data-workspace-pane-target="addFirst" data-action="click->workspace-pane#addFirstTemplate"${presentation.workspaces.length ? "" : ' data-first-workspace-destination="first-template"'}>${addBadgeHtml()}<span><strong>Add your first template</strong><span>Point us at a git repo once. Every new workspace can start as a fresh clone of it.</span></span></a>`;
  return `<div id="${workspaceTemplateOptionsDomId}" class="workspace-template-options action-list" role="radiogroup" aria-labelledby="workspace_template_question">
    <p class="workspace-template-question" id="workspace_template_question">What should we put in your new workspace?</p>
    ${addWorkspaceTemplate}
    ${ordered.map((workspaceTemplate) => renderWorkspaceTemplateOption(workspaceTemplate)).join("")}
    ${renderWorkspaceTemplateOption()}
  </div>`;
}

function renderWorkspaceTemplatePicker(presentation: WorkspacePanePresentation, launchComposerBinding: string | undefined): string {
  const tip = launchComposerBinding
    ? `<p class="workspace-template-picker-tip">Tip: <kbd>${escapeHtml(formatShortcutBinding(launchComposerBinding))}</kbd> starts one from the current workspace’s template, with a prompt.</p>`
    : "";
  return `<form class="workspace-template-picker" method="get" action="/launch-composer" data-turbo-frame="launch_composer" data-turbo="true" data-action="submit->workspace-pane#submitted keydown.esc->workspace-pane#back">
    <input type="hidden" name="workspaceTemplate" value="" data-workspace-pane-target="value">
    <input type="hidden" name="autoSelect" value="true">
    <div class="workspace-template-picker-scroll">${renderWorkspaceTemplateOptions(presentation)}</div>
  </form>${tip}`;
}

const workspacePaneScrollDomId = "fixed_shell_workspace_scroll";
const workspacePaneNewWorkspaceDomId = "fixed_shell_new_workspace";
const workspaceTemplateOptionsDomId = "workspace_template_options";

export function renderWorkspacePane(presentation: WorkspacePanePresentation, sidebarContributionsHtml = "", moduleActionsHtml = "", launchComposerBinding?: string): string {
  const settingsAttributes = 'data-controller="settings-prefetch" data-action="pointerenter->settings-prefetch#prefetch focus->settings-prefetch#prefetch click->settings-prefetch#open"';
  const settingsRow = contentRowHtml({
    width: "fill", kind: "compact", label: { kind: "text", text: "Settings" }, leadingHtml: Icons.Settings,
    element: { tag: "a", attributesHtml: `href="/settings" ${settingsAttributes}` },
  });
  const back = buttonHtml({ type: "button", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Back, label: "Back to workspaces" }, attributesHtml: 'data-action="workspace-pane#back"' });
  const revealActions = 'pointerenter->workspace-navigation#revealWorkspacePane pointerleave->workspace-navigation#leaveWorkspacePane focusout->workspace-navigation#leaveWorkspacePane';
  return `<div class="fixed-shell-workspace-pane" data-controller="workspace-pane" data-action="${revealActions}"><div class="fixed-shell-workspace-main">${panelHtml({
    element: { tag: "aside",  attributesHtml: 'aria-label="Workspaces"' },
    chrome: "outlined",
    headerHtml: `<div class="workspace-pane-header" data-workspace-pane-target="workspacesHeader">${barButton("Pin sidebar", "click->workspace-navigation#toggleWorkspacePanePinned", Icons.Sidebar, 'data-collapse-workspace-pane aria-pressed="false"', "quiet")}<span class="panel__title">${Icons.Cloud}Workspaces</span>${buttonGroupHtml({ orientation: "horizontal", semantics: "layout", itemsHtml: `${renderPwaReminder()}${moduleActionsHtml}` })}</div>
      <div class="workspace-pane-header" data-workspace-pane-target="pickerHeader" hidden>${back}<span class="panel__title">New workspace</span></div>`,
    bodyHtml: `<div class="workspace-pane-viewport" data-workspace-pane-target="body"><div class="workspace-pane-slides">
      <section class="workspace-pane-slide" data-workspace-pane-target="workspaces" aria-label="Workspaces">
        <div class="fixed-shell-pane-collections" data-workspace-pane-collections>
          <div id="${workspacePaneScrollDomId}" class="fixed-shell-workspace-scroll" data-workspace-navigation-target="scroll">${renderWorkspaceRows(presentation)}</div>
          <section id="global_sidebar_contributions">${sidebarContributionsHtml}</section>
        </div>
        <footer class="workspace-pane-footer"><div id="${workspacePaneNewWorkspaceDomId}">${renderNewWorkspaceRow(presentation)}</div>${settingsRow}</footer>
      </section>
      <section class="workspace-pane-slide" data-workspace-pane-target="picker" aria-label="New workspace" inert>${renderWorkspaceTemplatePicker(presentation, launchComposerBinding)}</section>
    </div></div>`,
  })}</div></div><div class="nox-workspace-edge" aria-hidden="true" data-action="pointerenter->workspace-navigation#revealWorkspacePane pointerleave->workspace-navigation#leaveWorkspacePane"></div><div class="nox-workspace-scrim" aria-hidden="true" data-action="click->workspace-navigation#closeWorkspacePane"></div>`;
}

const agentsInTheCloudNextAttentionDomId = "fixed_shell_agents-in-the-cloud_next_attention";

function renderAgentsInTheCloudNextAttentionButton(): string {
  const icon = `${Icons.Next}<i class="status-dot attention" aria-hidden="true"></i>`;
  return barButton("Next workspace requesting attention", "click->agents-in-the-cloud-shortcuts#openAttentionWorkspace", icon, `id="${agentsInTheCloudNextAttentionDomId}" disabled`);
}

export function renderAgentsInTheCloudBar(): string {
  const close = barButton("Close workspace list", "click->workspace-navigation#closeWorkspacePane", Icons.Close, "data-close-workspace-pane disabled");
  return `<nav class="fixed-shell-mobile-nav fixed-shell-agents-in-the-cloud-bar" aria-label="AgentsInTheCloud">${close}${renderAgentsInTheCloudNextAttentionButton()}</nav>`;
}

export function workspacePresentationDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId);
}

function workspaceRegionDomId(workspaceId: string, part: string): string {
  return domId("fixed_workspace", workspaceId, part);
}

function renderAvailability(view: WorkPaneContribution): string {
  const { availability } = view;
  if (availability.phase === "live") return "";
  const label = availability.phase === "opening" ? "Opening" : availability.phase === "reconnecting" ? "Reconnecting" : "Unavailable";
  const detail = availability.detail ?? (availability.phase === "opening" ? `Opening ${view.label}…` : `Reconnecting ${view.label}…`);
  return `<div class="fixed-shell-availability empty-state fixed-shell-availability-${availability.phase}" role="${availability.phase === "unavailable" ? "alert" : "status"}">
    <span class="fixed-shell-availability-mark" aria-hidden="true"></span><strong>${label}</strong><p>${escapeHtml(detail)}</p>
  </div>`;
}

function renderWorkViewSelector(workspaceId: string, view: WorkPaneContribution): string {
  const textAttributesHtml = `id="${workspaceWorkViewLabelDomId(workspaceId, view.key)}"`;
  return tabHtml({
    selected: false,
    label: { kind: "text", text: view.label, textAttributesHtml },
    iconHtml: view.iconHtml ?? Icons.Plus,
    status: { requestingAttention: view.attentionSequence !== undefined },
    containerAttributesHtml: `id="${workViewSelectorDomId(workspaceId, view.key)}" draggable="true" data-work-view-reorder-key="${escapeHtml(view.key)}" data-action="dragstart->workspace-presentation#beginWorkReorder dragover->workspace-presentation#allowWorkReorder drop->workspace-presentation#finishWorkReorder"`,
    primary: { tag: "button", attributesHtml: `type="button" data-work-view-key="${escapeHtml(view.key)}" data-work-view-kind="${view.kind}"${view.attentionSequence === undefined ? "" : ` data-attention-sequence="${view.attentionSequence}"`} ${fullscreenViewAttributes(view.sourceKey ?? view.key, view.label)} data-action="click->workspace-presentation#selectWorkView"` },
    closeHtml: view.close ? selectorCloseForm(view.close) : "",
  });
}

function renderWorkViewSelectors(workspaceId: string, views: readonly WorkPaneContribution[]): string {
  return views.map((view) => renderWorkViewSelector(workspaceId, view)).join("");
}

export function workContentId(workspaceId: string, key: string): string {
  return domId("work_content", workspaceId, key);
}

function renderWorkViewPane(workspaceId: string, view: WorkPaneContribution, active: boolean): string {
  const source = view.sourceKey ? ` data-source-work-view-key="${escapeHtml(view.sourceKey)}"` : "";
  return `<section id="${workViewPaneDomId(workspaceId, view.key)}" class="fixed-shell-surface${active ? " is-active" : ""}" data-workspace-pane-role="work" data-workspace-pane-id="${escapeHtml(view.key)}" data-agents-in-the-cloud-fullscreen-view-key="${escapeHtml(view.sourceKey ?? view.key)}" data-workspace-logically-visible="false"${source} tabindex="-1"><div id="${workViewAvailabilityDomId(workspaceId, view.key)}">${renderAvailability(view)}</div><div id="${workViewActionsDomId(workspaceId, view.key)}" class="fixed-shell-work-actions">${view.actionsHtml ?? ""}</div><div class="fixed-shell-live-body" id="${workContentId(workspaceId, view.key)}" data-turbo-permanent></div></section>`;
}



function workViewDomId(workspaceId: string, part: string): string {
  return workspaceRegionDomId(workspaceId, part);
}

export function workViewSelectorDomId(workspaceId: string, key: string): string {
  return domId("work_view_selector", workspaceId, key);
}

export function workViewPaneDomId(workspaceId: string, key: string): string {
  return domId("work_view_pane", workspaceId, key);
}

export function workViewAvailabilityDomId(workspaceId: string, key: string): string {
  return domId("work_view_availability", workspaceId, key);
}

export function workViewActionsDomId(workspaceId: string, key: string): string {
  return domId("work_view_actions", workspaceId, key);
}

function workViewType(view: WorkPaneContribution): string {
  return view.key.slice(0, view.key.indexOf(":"));
}

function renderWorkLauncherCommand(command: NonNullable<WorkspacePresentation["commands"]>[number], workspaceId: string, action = ""): string {
  const item = contentRowHtml({ width: "fill", kind: "compact", label: { kind: "text", text: command.label }, leadingHtml: `<span class="popup-menu__icon">${command.iconHtml ?? Icons.Plus}</span>`, element: { tag: "button", attributesHtml: 'type="submit" role="menuitem"' } });
  const actionAttribute = action ? ` data-action="${action}"` : "";
  return `<form data-turbo="true" method="post" action="/workspaces/${encodeURIComponent(workspaceId)}/commands/${encodeURIComponent(command.id)}"${actionAttribute}>${item}</form>`;
}

function renderEmptyWorkPane(workspaceId: string, commands: NonNullable<WorkspacePresentation["commands"]>): string {
  const launchers = commands.filter((command) => command.placement === "work-launcher").map((command) => {
    const shortcutCommand = command.shortcutCommandId
      ? commands.find((candidate) => candidate.id === command.shortcutCommandId)!
      : command;
    const item = contentRowHtml({
      width: "fill",
      kind: "compact",
      label: { kind: "text", text: command.label },
      leadingHtml: command.iconHtml ?? Icons.Plus,
      trailingHtml: shortcutCommand.binding
        ? `<span class="work-launcher-shortcut">${escapeHtml(formatShortcutBinding(shortcutCommand.binding))}</span>`
        : undefined,
      element: { tag: "button", attributesHtml: 'type="submit"' },
    });
    return `<form data-turbo="true" method="post" action="/workspaces/${encodeURIComponent(workspaceId)}/commands/${encodeURIComponent(command.id)}">${item}</form>`;
  }).join("");
  return `<div id="${workViewDomId(workspaceId, "empty")}" class="fixed-shell-empty-pane empty-state"><div class="fixed-shell-empty-pane-choices action-list">${launchers}</div></div>`;
}

function renderWorkPane(presentation: WorkspacePresentation): string {
  const selectors = renderWorkViewSelectors(presentation.workspace.id, presentation.workViews);
  const panes = presentation.workViews.map((view) => renderWorkViewPane(presentation.workspace.id, view, view.key === presentation.initialSelection?.workView)).join("");
  const workCommands = (presentation.commands ?? []).filter((command) => command.placement === "work-launcher");
  const addMenuId = workViewDomId(presentation.workspace.id, "add_menu");
  const addMenu = workCommands.length ? popupHtml({
    id: addMenuId,
    label: "Open Work view",
    trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Plus, label: "Open Work view" } },
    contentHtml: workCommands.map((command) => renderWorkLauncherCommand(command, presentation.workspace.id)).join(""),
  }) : "";
  return `<div class="fixed-shell-work-pane">${panelHtml({
    element: { tag: "section",  attributesHtml: 'data-workspace-role-region="work" data-workspace-presentation-target="workPane" aria-label="Work"' },
    chrome: "outlined",
    headerHtml: `${presentation.workViews.length ? "" : '<span class="panel__title">Work views</span>'}${tabStripHtml({ id: workViewDomId(presentation.workspace.id, "selectors"), label: "Work views", tabsHtml: selectors })}<span id="${workViewDomId(presentation.workspace.id, "launchers")}">${addMenu}</span>${barButton("Focus Work pane", "click->workspace-presentation#toggleWorkPane", Icons.Maximize, "data-collapse-work-pane")}`,
    bodyHtml: `<div id="${workViewDomId(presentation.workspace.id, "bodies")}" class="fixed-shell-work-bodies">${panes || renderEmptyWorkPane(presentation.workspace.id, presentation.commands ?? [])}</div>`,
  })}<div class="fixed-shell-work-resizer" role="separator" aria-label="Resize Work pane" aria-orientation="vertical" tabindex="0" data-action="pointerdown->workspace-presentation#beginWorkResize keydown->workspace-presentation#resizeWorkWithKeyboard"></div></div>`;
}

function mobileNavigationPriority(view: WorkPaneContribution): number {
  const type = workViewType(view);
  if (type === "browser") return 0;
  return 2;
}

function renderMobileWorkViews(views: readonly WorkPaneContribution[]) {
  const ordered = [...views].sort((left, right) => mobileNavigationPriority(left) - mobileNavigationPriority(right));
  return {
    overflowItems: ordered.map((view) => {

      const attention = view.attentionSequence === undefined ? "" : '<i class="status-dot attention content-row__status" aria-label="Attention"></i>';
      return contentRowHtml({
        width: "fill",
        kind: "compact",
        label: { kind: "text", text: view.label },
        leadingHtml: view.iconHtml ?? Icons.Plus,
        trailingHtml: attention,
        element: { tag: "button", attributesHtml: `type="button" role="menuitemradio" aria-checked="false" data-more-work-key="${escapeHtml(view.key)}" data-more-work-kind="${view.kind}" data-action="click->workspace-presentation#selectMoreWorkView"` },
      });
    }).join(""),
  };
}

function renderMobileCloser(destination: string, close: ViewCloseAction): string {
  const item = contentRowHtml({ width: "fill", kind: "compact", tone: "danger", label: { kind: "text", text: "Close current view" }, leadingHtml: `<span class="popup-menu__icon">${Icons.Close}</span>`, element: { tag: "button",  attributesHtml: 'type="submit" role="menuitem"' } });
  return `<div data-more-close-destination="${escapeHtml(destination)}" hidden>${closeForm(close, item)}</div>`;
}

function renderMobileWorkViewCloser(view: WorkPaneContribution): string {
  return view.close ? renderMobileCloser(`work:${view.key}`, view.close) : "";
}

interface MobileWorkspaceBarOptions {
  agentHtml?: string;
  workHtml?: string;
  inert?: boolean;
}

/* With a phone header, this bar is hidden; its stops still carry the pane status slots. */
export function renderMobileWorkspaceBar({ agentHtml = "", workHtml = "", inert = false }: MobileWorkspaceBarOptions = {}): string {
  const workspace = barButton("Show workspaces", "click->workspace-navigation#showWorkspacePane", Icons.Workspace, "data-show-workspace-list");
  return `<nav class="fixed-shell-mobile-nav fixed-shell-workspace-bar" aria-label="Workspace panes"${inert ? " inert" : ""}>
    ${workspace}${agentHtml}${workHtml}
  </nav>`;
}

function renderWorkspaceBar(presentation: WorkspacePresentation, inert = false): string {
  const agentsDestination = barButton("Agent", "click->workspace-presentation#selectMobileDestination", `${Icons.Agent}${renderMobileAgentAttention(presentation.workspace.id, presentation.agents)}`, `data-mobile-destination="agents" aria-describedby="${domId("mobile_agent_attention", presentation.workspace.id)}"`);
  const workStatusId = workViewDomId(presentation.workspace.id, "mobile_work_attention");
  const workStatus = busyAttentionIndicator({ requestingAttention: presentation.workViews.some((view) => view.attentionSequence !== undefined) });
  const workDestination = barButton("Work", "click->workspace-presentation#selectMobileWork", `${Icons.Panel}<span id="${workStatusId}" class="nox-mobile-nav-status">${workStatus}</span>`, `data-mobile-work aria-describedby="${workStatusId}"`);
  return renderMobileWorkspaceBar({ agentHtml: agentsDestination, workHtml: workDestination, inert });
}

function renderMobileMoreMenu(presentation: WorkspacePresentation): string {
  const workViews = renderMobileWorkViews(presentation.workViews);
  const closers = presentation.workViews.map(renderMobileWorkViewCloser).join("");
  const moreMenuId = workViewDomId(presentation.workspace.id, "mobile_more_menu");
  return popupHtml({
    id: moreMenuId, label: "More", placement: "below",
    trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.More, label: "More" }, attributesHtml: "data-mobile-more" },
    menuAttributesHtml: 'data-workspace-presentation-target="moreMenu" data-action="toggle->workspace-presentation#syncMore"',
    contentHtml: `${renderPhoneMoreHeading(presentation)}${renderAgentViewSwitch(true)}${renderPhoneNewTabOptions(presentation)}<span id="${workViewDomId(presentation.workspace.id, "mobile_overflow")}" class="contents action-list">${workViews.overflowItems}</span>
      <div id="${workViewDomId(presentation.workspace.id, "mobile_closers")}" class="fixed-shell-more-close-section">${closers}</div>`,
  });
}

/** Nox: the phone bar has no title row, so More names the workspace and holds its actions. */
function renderPhoneMoreHeading(presentation: WorkspacePresentation): string {
  return `<div class="nox-phone-more-heading"><strong class="nox-phone-more-title">${escapeHtml(presentation.workspace.title)}</strong><div class="nox-phone-more-actions">${renderPhoneWorkspaceActions(presentation)}</div></div><hr class="popup-menu__separator">`;
}

/** Nox: More offers new tabs for the visible pane; CSS shows the matching section. */
function renderPhoneNewTabOptions(presentation: WorkspacePresentation): string {
  const launchers = (presentation.commands ?? []).filter((command) => command.placement === "work-launcher");
  const agents = presentation.agentTypes.length
    ? `<div class="nox-phone-more-section" data-nox-more-pane="agents"><span class="nox-phone-more-label">New agent</span>${renderPhoneAgentTypeOptions(presentation)}</div>` : "";
  const work = launchers.length
    ? `<div class="nox-phone-more-section" data-nox-more-pane="work"><span class="nox-phone-more-label">Open</span>${launchers.map((command) => renderWorkLauncherCommand(command, presentation.workspace.id, "submit->workspace-presentation#closeMore")).join("")}</div>` : "";
  return agents + work;
}

/* Nox phone chrome: one bar that stays put while the Agent and Work panes swap beneath it.
 * A single rail holds both panes' tabs; the hidden pane's tabs fold to icons on their side
 * of the rail, so the bar maps Agents ← → Work. The sidebar button sits on the side the
 * workspace list is reached from: left on Agents, right (after More) on Work, where the swipe
 * loops round to the list (see mobile-swipe). Tabs select by the visible pane (see
 * syncMobileNavigationSelection), not by the desktop selection. Tapping a selected Browser tab
 * (data-nox-tools) opens that Browser's toolbar (see nox-phone-chrome). */
function renderPhoneHeader(presentation: WorkspacePresentation, inert: boolean): string {
  const workspaceId = presentation.workspace.id;
  const agentTab = (agent: AgentPaneContribution) => tabHtml({
    selected: false,
    label: { kind: "text", text: agent.title },
    iconHtml: agent.iconHtml,
    status: { busy: agent.busy, requestingAttention: agent.requestingAttention },
    primary: { tag: "button", attributesHtml: `type="button" data-nox-phone-tab="agents" data-agent-id="${escapeHtml(agent.id)}" data-action="click->workspace-presentation#selectAgent"` },
  });
  const workTab = (view: WorkPaneContribution) => tabHtml({
    selected: false,
    label: { kind: "text", text: view.label },
    iconHtml: view.iconHtml ?? Icons.Plus,
    status: { requestingAttention: view.attentionSequence !== undefined },
    primary: { tag: "button", attributesHtml: `type="button" data-nox-phone-tab="work:${escapeHtml(view.key)}"${view.key.startsWith("browser:") ? " data-nox-tools" : ""} data-work-view-key="${escapeHtml(view.key)}" data-work-view-kind="${view.kind}" data-action="click->workspace-presentation#selectWorkView"` },
  });
  const launchers = (presentation.commands ?? []).filter((command) => command.placement === "work-launcher");
  const agentFold = tabStripHtml({ id: domId("phone_agent_tabs", workspaceId), label: "Agents", tabsHtml: presentation.agents.map(agentTab).join("") });
  const workFold = presentation.workViews.length
    ? tabStripHtml({ id: domId("phone_work_tabs", workspaceId), label: "Work views", tabsHtml: presentation.workViews.map(workTab).join("") })
    : renderPhoneLaunchers(workspaceId, launchers);
  // The dot shows (in CSS) when another workspace needs attention.
  const sidebarIcon = `${Icons.Sidebar}<i class="status-dot attention nox-phone-header__attention" aria-hidden="true"></i>`;
  const sidebar = barButton("Show workspaces", "click->workspace-navigation#showWorkspacePane", sidebarIcon, "data-show-workspace-list");
  const loopSidebar = barButton("Show workspaces", "click->mobile-swipe#loopToWorkspaces", sidebarIcon, "data-show-workspace-list");
  return `<header class="nox-phone-header" aria-label="Workspace" data-controller="nox-phone-chrome"${inert ? " inert" : ""}>
    <div class="nox-phone-header__row"><span class="nox-phone-dock" data-nox-dock="agents">${sidebar}</span><div class="nox-phone-rail"><div class="nox-phone-fold" data-nox-fold="agents">${agentFold}</div><span class="nox-phone-rail__divider" aria-hidden="true"></span><div class="nox-phone-fold" data-nox-fold="work">${workFold}</div></div>${renderMobileMoreMenu(presentation)}<span class="nox-phone-dock" data-nox-dock="work">${loopSidebar}</span></div>
  </header>`;
}

/** With nothing open on Work, its strip offers the launchers in place of tabs. */
function renderPhoneLaunchers(workspaceId: string, launchers: NonNullable<WorkspacePresentation["commands"]>): string {
  const formId = (commandId: string) => domId("phone_launch", workspaceId, commandId);
  const forms = launchers.map((command) => `<form id="${formId(command.id)}" method="post" action="/workspaces/${encodeURIComponent(workspaceId)}/commands/${encodeURIComponent(command.id)}" data-turbo="true" hidden></form>`).join("");
  const buttons = launchers.map((command) => contentRowHtml({
    width: "fill", kind: "compact", label: { kind: "text", text: command.label }, leadingHtml: command.iconHtml ?? Icons.Plus,
    element: { tag: "button", attributesHtml: `type="submit" form="${formId(command.id)}"` },
  })).join("");
  return `${forms}<div class="nox-phone-launchers" role="group" aria-label="Open a Work view">${buttons}</div>`;
}

export function renderWorkspaceDeletionPresentation(workspaceId: string, deletion: WorkspaceDeletionState, evidenceHtml = ""): string {
  const id = encodeURIComponent(workspaceId);
  const deletionButton = (caption: string, variant: ButtonVariant = "secondary") => buttonHtml({
    type: "submit",
    variant,
    content: { kind: "caption", caption },
  });
  let content: string;
  if (deletion.status === "checking") {
    content = '<div class="workspace-deletion-heading"><span class="status-spinner" aria-hidden="true"></span><h1>Checking if it’s safe to delete…</h1><p>AgentsInTheCloud is checking for local Git work and saved review comments.</p></div>';
  } else if (deletion.status === "deleting") {
    const title = deletion.forced ? "Force deleting workspace…" : "Deleting workspace…";
    const detail = deletion.forced ? "Local changes may be discarded." : "The safety check passed. AgentsInTheCloud is removing the workspace.";
    content = `<div class="workspace-deletion-heading"><span class="status-spinner" aria-hidden="true"></span><h1>${title}</h1><p>${detail}</p></div>`;
  } else if (deletion.status === "blocked") {
    content = `<div class="workspace-deletion-evidence" aria-label="Work that may be lost">${evidenceHtml}</div><footer class="workspace-deletion-actions"><form method="post" action="/workspaces/${id}/delete/cancel" data-turbo="true">${deletionButton("Cancel deletion")}</form><form method="post" action="/workspaces/${id}/delete/confirm" data-turbo="true" data-controller="submit-shortcut" data-action="keydown@window->submit-shortcut#windowKeydown submit->submit-shortcut#submit turbo:submit-end->submit-shortcut#submitted"><input type="hidden" name="fingerprint" value="${escapeHtml(deletion.fingerprint)}">${deletionButton("Delete anyway", "danger")}</form></footer>`;
  } else {
    const bypass = deletion.operation === "checking" ? `<form method="post" action="/workspaces/${id}/delete?force=1" data-turbo="true">${deletionButton("Delete without review", "danger")}</form>` : "";
    content = `<div class="workspace-deletion-heading"><h1>${deletion.operation === "checking" ? "Deletion review failed" : "Workspace deletion failed"}</h1><p class="workspace-deletion-error">${escapeHtml(deletion.error)}</p></div><footer class="workspace-deletion-actions"><form method="post" action="/workspaces/${id}/delete/cancel" data-turbo="true">${deletionButton("Cancel deletion")}</form><form method="post" action="/workspaces/${id}/delete/retry" data-turbo="true">${deletionButton("Retry review")}</form>${bypass}</footer>`;
  }
  const role = deletion.status === "failed" ? ' role="alert"' : deletion.status === "blocked" ? "" : ' role="status"';
  return `<div id="${domId("fixed_workspace", workspaceId)}" class="fixed-workspace-presentation workspace-deletion-presentation" data-workspace-id="${escapeHtml(workspaceId)}" data-workspace-commands="[]"><main class="workspace-deletion-state" data-deletion-status="${deletion.status}"${role}>${content}</main>${renderMobileWorkspaceBar()}</div>`;
}

export function renderWorkspacePresentation(presentation: WorkspacePresentation): string {
  const id = workspacePresentationDomId(presentation.workspace.id);
  const trustPending = presentation.overlayHtml?.some(html => html.includes('class="workspace-ssh-trust-overlay"')) ?? false;
  return `<div id="${id}" class="fixed-workspace-presentation${presentation.initialSelection?.workView ? " is-work-pane-open" : ""}" data-controller="workspace-presentation" data-phone-destination="${presentation.initialSelection?.workView ? `work:${escapeHtml(presentation.initialSelection.workView)}` : "agents"}" data-workspace-initial-agent="${escapeHtml(presentation.initialSelection?.agent ?? "")}" data-workspace-initial-work="${escapeHtml(presentation.initialSelection?.workView ?? "")}" data-workspace-presentation-work-intent-value="${escapeHtml(JSON.stringify(presentation.workPresentationIntent ?? {}))}" data-workspace-presentation-workspace-id-value="${escapeHtml(presentation.workspace.id)}" data-workspace-id="${escapeHtml(presentation.workspace.id)}" data-workspace-commands="${escapeHtml(JSON.stringify(presentation.commands ?? []))}">
    ${renderPhoneHeader(presentation, trustPending)}
    <div class="fixed-shell-main"${trustPending ? " inert" : ""}>${renderAgentPane(presentation)}${renderWorkPane(presentation)}</div>
    ${renderWorkspaceBar(presentation, trustPending)}
    ${(presentation.overlayHtml ?? []).join("")}
  </div>`;
}

export function presentWorkViewTurboStream(workspaceId: string, key: string): string {
  return behaviorTurboStream("present-work-view", workspaceId, { "work-view-key": key });
}

export function workspacePaneCollectionsRegions(presentation: WorkspacePanePresentation): import("@agents-in-the-cloud/shared").LiveRegion[] {
  return [
    { target: workspacePaneScrollDomId, html: renderWorkspaceRows(presentation) },
    { target: workspacePaneNewWorkspaceDomId, html: renderNewWorkspaceRow(presentation) },
    { target: workspaceTemplateOptionsDomId, html: renderWorkspaceTemplateOptions(presentation), action: "replace" },
  ];
}

export function renderWorkspaceParkConfirmation(id: string, title: string, workViews: readonly WorkspaceWorkViewState[]): string {
  const terminals = workViews.filter(({ reference }) => reference.type === "terminal").length;
  const editors = workViews.filter(({ reference }) => reference.type === "vscode").length;
  const openViews = [
    ...(terminals ? [`${terminals} terminal ${terminals === 1 ? "session" : "sessions"}`] : []),
    ...(editors ? [`${editors} VS Code ${editors === 1 ? "editor" : "editors"}`] : []),
  ].join(" and ");
  const singular = terminals + editors === 1;
  return dialogHtml({
    element: { id: domId("workspace_park_confirmation", id), attributesHtml: "data-dialog-auto-show" },
    iconHtml: Icons.Park,
    titleCaption: `Park “${title}”?`,
    bodyHtml: `<p>You have ${openViews} open in this workspace.</p><p>Parking will close ${singular ? "it" : "them"}. ${singular ? "It" : "They"} won’t reopen when you unpark.</p>`,
    footerHtml: `<form method="dialog">${buttonHtml({ type: "submit", variant: "primary", content: { kind: "caption", caption: "Cancel" } })}</form><form method="post" action="/workspaces/${encodeURIComponent(id)}/park?force=1" data-action="submit->workspace-navigation#parkWorkspace">${buttonHtml({ type: "submit", variant: "secondary", content: { kind: "caption", caption: "Force park" } })}</form>`,
  });
}

export function dismissWorkspaceParkConfirmationTurboStream(id: string): string {
  return turboStream("remove", domId("workspace_park_confirmation", id));
}
