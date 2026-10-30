import { renderAgentTypePicker } from "./agent-type-picker.ts";
import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { buttonGroupHtml } from "@agents-in-the-cloud/design-system/button-group";
import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { panelHtml } from "@agents-in-the-cloud/design-system/panel";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { tabHtml, tabStripHtml } from "@agents-in-the-cloud/design-system/tab-strip";
import { domId, escapeHtml } from "@agents-in-the-cloud/shared";
import type { WorkspacePresentation } from "./workspace-presentation.ts";
import { barButton, behaviorTurboStream, fullscreenViewAttributes, paneContentHtml, selectorCloseForm, type LiveIslands, type ViewCloseAction } from "./workspace-view-markup.ts";

export interface AgentPaneContribution {
  busy?: boolean;
  requestingAttention?: boolean;
  attentionSequence?: number;
  untitled?: boolean;
  id: string;
  agentTypeId: string;
  iconHtml: string;
  title: string;
  close?: ViewCloseAction;
}

export function agentNavigationDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_navigation");
}

function agentTabListDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_tab_list");
}

export function agentBodiesDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_bodies");
}

export function agentActionsDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_actions");
}

export function agentTabDomId(workspaceId: string, agentId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_tab", agentId);
}

export function agentPaneSlotDomId(workspaceId: string, agentId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_pane", agentId);
}


export function renderMobileAgentAttention(islands: LiveIslands, workspaceId: string, agents: readonly AgentPaneContribution[]): string {
  const busy = agents.some((agent) => agent.busy);
  const attention = agents.some((agent) => agent.requestingAttention);
  const label = [busy && "Busy", attention && "Requesting attention"].filter(Boolean).join("; ");
  const status = `<span class="status-indicator"${label ? ` role="img" aria-label="${label}"` : ""}>${busy ? '<i class="status-dot running" aria-hidden="true"></i>' : ""}${attention ? '<i class="status-dot attention" aria-hidden="true"></i>' : ""}</span>`;
  return islands.island(domId("mobile_agent_attention", workspaceId), status, "span", "nox-mobile-nav-status");
}

function renderAgentTab(workspaceId: string, agent: AgentPaneContribution): string {
  return tabHtml({
    selected: false,
    label: { kind: "text", text: agent.title },
    status: {
      busy: agent.busy, requestingAttention: agent.requestingAttention,
      attributesHtml: `data-agent-attention-id="${escapeHtml(agent.id)}"${agent.attentionSequence === undefined ? "" : ` data-attention-sequence="${agent.attentionSequence}"`}`,
    },
    containerAttributesHtml: `id="${agentTabDomId(workspaceId, agent.id)}"`,
    primary: { tag: "button", attributesHtml: `type="button" data-agent-id="${escapeHtml(agent.id)}" ${fullscreenViewAttributes(agent.id, agent.title)} data-action="click->workspace-presentation#selectAgent"` },
    closeHtml: agent.close ? selectorCloseForm(agent.close) : "",
    touchMenu: agent.close ? {
      id: domId("agent_tab_menu", workspaceId, agent.id),
      label: `More for ${agent.title}`,
      contentHtml: `<form data-turbo="true" method="post" action="${escapeHtml(agent.close.action)}">${destructiveConfirmationHtml({
        id: domId("agent_tab_close", workspaceId, agent.id),
        trigger: { type: "button", variant: "danger", content: { kind: "caption", caption: "Close agent" }, attributesHtml: 'role="menuitem"' },
        confirmCaption: "Yes, close", cancelCaption: "Keep agent",
      })}</form>`,
    } : undefined,
  });
}

function agentTypeOptions(presentation: WorkspacePresentation, menu: boolean): string {
  const formId = (agentTypeId: string) => domId("create_agent", presentation.workspace.id, menu ? "menu" : "empty", agentTypeId);
  const forms = presentation.agentTypes.map(agentType => `<form id="${formId(agentType.id)}" method="post" action="/workspaces/${encodeURIComponent(presentation.workspace.id)}/commands/agent.create.${encodeURIComponent(agentType.id)}" data-turbo="true" hidden></form>`).join("");
  return forms + renderAgentTypePicker(presentation.agentTypes, {
    attributes: agentType => `type="submit" form="${formId(agentType.id)}"${menu ? ' role="menuitem"' : ""}`,
  });
}

/** Agent types for the phone header's More menu, with their own form IDs. */
export function renderPhoneAgentTypeOptions(presentation: WorkspacePresentation): string {
  const formId = (agentTypeId: string) => domId("create_agent", presentation.workspace.id, "phone", agentTypeId);
  const forms = presentation.agentTypes.map(agentType => `<form id="${formId(agentType.id)}" method="post" action="/workspaces/${encodeURIComponent(presentation.workspace.id)}/commands/agent.create.${encodeURIComponent(agentType.id)}" data-turbo="true" hidden></form>`).join("");
  return forms + renderAgentTypePicker(presentation.agentTypes, { attributes: agentType => `type="submit" form="${formId(agentType.id)}" role="menuitem"` });
}

/** Park and delete for the phone More menu, with their own IDs. */
export function renderPhoneWorkspaceActions(presentation: WorkspacePresentation): string {
  const id = encodeURIComponent(presentation.workspace.id);
  const park = buttonHtml({ type: "submit", variant: "secondary", content: { kind: "caption", caption: "Park" } });
  const deleteConfirmation = destructiveConfirmationHtml({
    id: domId("phone_delete_workspace", presentation.workspace.id),
    trigger: { type: "button", variant: "secondary", content: { kind: "caption", caption: "Delete" } },
    confirmCaption: "Yes, delete",
    cancelCaption: "Oops",
  });
  return `<form class="fixed-shell-park-workspace" method="post" action="/workspaces/${id}/park" data-action="submit->workspace-navigation#parkWorkspace">${park}</form><form class="fixed-shell-delete-workspace" data-turbo="true" method="post" action="/workspaces/${id}/delete">${deleteConfirmation}</form>`;
}

function agentTabsDomId(workspaceId: string): string {
  return domId("fixed_workspace", workspaceId, "agent_tabs");
}

function renderAgentNavigation(islands: LiveIslands, presentation: WorkspacePresentation): string {
  const agents = presentation.agents.length
    ? tabStripHtml({
      label: "Agents",
      id: agentTabListDomId(presentation.workspace.id),
      tabsHtml: presentation.agents.map((agent) => renderAgentTab(presentation.workspace.id, { ...agent, title: presentation.agents.length === 1 && agent.untitled ? presentation.workspace.title : agent.title })).join(""),
    })
    : `<div class="fixed-shell-workspace-title"><strong>${escapeHtml(presentation.workspace.title)}</strong></div>`;
  const menu = popupHtml({
    id: domId("agent_types", presentation.workspace.id), label: "New agent",
    trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Plus, label: "New agent" } },
    width: "content",
    contentHtml: agentTypeOptions(presentation, true),
  });
  return `${islands.island(agentTabsDomId(presentation.workspace.id), agents, "span", "contents")}${menu}`;
}

function agentEmptyId(workspaceId: string): string { return domId("agent_empty", workspaceId); }

function renderAgentEmpty(presentation: WorkspacePresentation): string {
  return `<div id="${agentEmptyId(presentation.workspace.id)}" class="fixed-shell-empty-pane empty-state"><div class="fixed-shell-empty-pane-choices">${agentTypeOptions(presentation, false)}</div></div>`;
}

function renderAgentPaneSlot(workspaceId: string, agent: AgentPaneContribution): string {
  return `<section id="${agentPaneSlotDomId(workspaceId, agent.id)}" class="fixed-shell-surface" data-workspace-pane-role="agent" data-workspace-pane-id="${escapeHtml(agent.id)}" data-agents-in-the-cloud-fullscreen-view-key="${escapeHtml(agent.id)}" data-workspace-logically-visible="false" tabindex="-1">${paneContentHtml(workspaceId, "agent-pane", agent.id)}</section>`;
}

export function renderAgentViewSwitch(menu = false): string {
  // Reuse the module commands; the active pane remains the source of view/draft state.
  const commandAction = "click->agents-in-the-cloud-shortcuts#runCommand";
  return ([
    ["transcript", "View transcript", Icons.Transcript],
    ["terminal", "Back to terminal", Icons.Terminal],
    ["pending", "Will autoswitch to transcript when agent is done", Icons.TranscriptPending],
  ] as const).map(([state, label, icon]) => `<span class="nox-agent-action nox-agent-${state}-action">${menu ? contentRowHtml({
    kind: "compact", width: "fill", label: { kind: "text", text: label }, leadingHtml: icon,
    element: { tag: "button", attributesHtml: `type="button" role="menuitem" data-action="${commandAction}" data-command-id="cli-agent.toggle-mode"` },
  }) : barButton(label, commandAction, icon, 'data-command-id="cli-agent.toggle-mode"')}</span>`).join("");
}

function renderAgentComposerAction(): string {
  const action = barButton("Open composer", "click->agents-in-the-cloud-shortcuts#runCommand", Icons.Keyboard, 'data-command-id="agent.toggle-composer"');
  return `<span class="nox-agent-action nox-agent-composer-action">${action}<span class="status-dot attention agent-composer-draft-dot" aria-hidden="true"></span></span>`;
}

function renderAgentActions(presentation: WorkspacePresentation): string {
  const parkButton = buttonHtml({ type: "submit", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Park, label: "Park workspace" } });
  const parkWorkspace = `<form class="fixed-shell-park-workspace" method="post" action="/workspaces/${encodeURIComponent(presentation.workspace.id)}/park" data-action="submit->workspace-navigation#parkWorkspace">${parkButton}</form>`;
  const deleteConfirmation = destructiveConfirmationHtml({
    id: domId("delete_workspace", presentation.workspace.id),
    trigger: { type: "button", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Trash, label: "Delete workspace" } },
    confirmCaption: "Yes, delete",
    cancelCaption: "Oops",
  });
  const deleteWorkspace = `<form class="fixed-shell-delete-workspace" data-turbo="true" method="post" action="/workspaces/${encodeURIComponent(presentation.workspace.id)}/delete">${deleteConfirmation}</form>`;
  const itemsHtml = `${renderAgentViewSwitch()}${renderAgentComposerAction()}${parkWorkspace}${deleteWorkspace}${barButton("Show Work pane", "click->workspace-presentation#toggleWorkPane", Icons.Panel, "data-show-work-pane")}`;
  return buttonGroupHtml({ orientation: "horizontal", semantics: "layout", itemsHtml });
}

export function renderAgentPane(islands: LiveIslands, presentation: WorkspacePresentation): string {
  const panes = presentation.agents.map((agent) => renderAgentPaneSlot(presentation.workspace.id, agent)).join("");
  return `<div class="fixed-shell-agent-pane">${islands.island(domId("workspace_warnings", presentation.workspace.id), presentation.warningsHtml ?? "", "div", "workspace-warning-stack")}${panelHtml({
    element: { tag: "section",  attributesHtml: 'data-workspace-role-region="agent" data-workspace-presentation-target="agentPane" aria-label="Agent"' },
    chrome: "outlined",
    headerHtml: `${barButton("Pin sidebar", "click->workspace-navigation#toggleWorkspacePanePinned", `${Icons.Cloud}<i class="status-dot attention nox-workspace-attention" aria-hidden="true"></i>`, 'data-show-workspace-pane aria-pressed="false"')}<div id="${agentNavigationDomId(presentation.workspace.id)}" class="fixed-shell-agent-navigation">${renderAgentNavigation(islands, presentation)}</div><div id="${agentActionsDomId(presentation.workspace.id)}" class="fixed-shell-agent-actions">${renderAgentActions(presentation)}</div>`,
    bodyHtml: `<div id="${agentBodiesDomId(presentation.workspace.id)}" class="fixed-shell-agent-bodies">${panes || renderAgentEmpty(presentation)}</div>`,
  })}</div>`;
}

export function selectAgentTurboStream(workspaceId: string, agentId: string): string {
  return behaviorTurboStream("select-agent", workspaceId, { "agent-id": agentId });
}
