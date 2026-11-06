import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { popupHtml } from "@agents-in-the-cloud/design-system/popup";
import { tabHtml, tabStripHtml } from "@agents-in-the-cloud/design-system/tab-strip";
import { domId, escapeHtml } from "@agents-in-the-cloud/shared";
import { renderAgentViewSwitch, renderPhoneAgentTypeOptions, renderPhoneWorkspaceActions, type AgentPaneContribution } from "./agent-pane.ts";
import { barButton, type LiveIslands } from "./workspace-view-markup.ts";
import { closeForm, renderMobileWorkViewCloser, renderMobileWorkViews, renderWorkLauncherCommand, workViewDomId, type WorkPaneContribution, type WorkspacePresentation } from "./workspace-presentation.ts";

/* Nox phone chrome, on phones and the spread (nox-spread.ts) alike. Two rows that travel with the
 * workspace: when the workspace list opens, the whole workspace, this header included, slides
 * aside beside it (nox-layout.css).
 *
 * The top row names the workspace: a sidebar button that opens the list, the workspace's glyph,
 * title and template (which open More), and More. The tab row below lists every agent and Work
 * view as a labelled tab; the open one is filled, and shows × when it can close. Tapping a tab
 * switches at once. Swipes still move between the agent and Work sides (mobile-swipe), and a
 * selected Browser tab (data-nox-tools) opens its toolbar (nox-workspace-chrome). + opens new
 * agents and Work views. In the spread both sides are on screen, so each keeps its own tab lit
 * (syncMobileNavigationSelection). */
export function renderNoxPhoneHeader(islands: LiveIslands, presentation: WorkspacePresentation, inert: boolean): string {
  const workspaceId = presentation.workspace.id;
  const tabs = [...presentation.agents.map(renderAgentTab), ...presentation.workViews.map(renderWorkTab)].join("");
  const strip = islands.island(domId("phone_tabs_region", workspaceId), tabStripHtml({ id: domId("phone_tabs", workspaceId), label: "Agents and Work views", tabsHtml: tabs }), "span", "contents");
  return `<header class="nox-phone-header" aria-label="Workspace" data-controller="nox-workspace-chrome"${inert ? " inert" : ""}>
    ${renderTitleRow(islands, presentation)}
    <div class="nox-phone-header__row">${strip}${renderNewTabMenu(presentation)}</div>
  </header>`;
}

function renderAgentTab(agent: AgentPaneContribution): string {
  return tabHtml({
    selected: false,
    label: { kind: "text", text: agent.title },
    iconHtml: agent.iconHtml,
    status: { busy: agent.busy, requestingAttention: agent.requestingAttention },
    primary: { tag: "button", attributesHtml: `type="button" data-nox-phone-tab="agents" data-agent-id="${escapeHtml(agent.id)}" data-action="click->workspace-presentation#selectAgent"` },
  });
}

function renderWorkTab(view: WorkPaneContribution): string {
  const close = view.close
    ? closeForm(view.close, buttonHtml({ type: "submit", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Close, label: `Close ${view.label}` } }))
    : "";
  return tabHtml({
    selected: false,
    label: { kind: "text", text: view.label },
    iconHtml: view.iconHtml ?? Icons.Plus,
    status: { requestingAttention: view.attentionSequence !== undefined },
    primary: { tag: "button", attributesHtml: `type="button" data-nox-phone-tab="work:${escapeHtml(view.key)}"${view.key.startsWith("browser:") ? " data-nox-tools" : ""} data-work-view-key="${escapeHtml(view.key)}" data-work-view-kind="${view.kind}" data-action="click->workspace-presentation#selectWorkView"` },
    closeHtml: close,
  });
}

function renderTitleRow(islands: LiveIslands, presentation: WorkspacePresentation): string {
  const { id, title, workspaceTemplate } = presentation.workspace;
  const moreMenuId = workViewDomId(id, "mobile_more_menu");
  // The dot shows (in CSS) when another workspace needs attention.
  const list = barButton("Workspaces", "click->workspace-navigation#showWorkspacePane", `${Icons.Sidebar}<i class="status-dot attention nox-phone-header__attention" aria-hidden="true"></i>`, "data-show-workspace-list");
  const name = `<strong class="nox-phone-title__name">${escapeHtml(title)}</strong>${workspaceTemplate ? `<span class="nox-phone-title__template">${escapeHtml(workspaceTemplate.title)}</span>` : ""}`;
  return `<div class="nox-phone-header__top">${list}
    <button type="button" class="nox-phone-title" aria-haspopup="menu" aria-controls="${moreMenuId}" popovertarget="${moreMenuId}"><span class="nox-phone-title__glyph" aria-hidden="true"></span>${islands.island(domId("phone_title", id), name, "span", "nox-phone-title__text")}</button>
    ${renderMoreMenu(islands, presentation)}
  </div>`;
}

/** Workspace actions, the agent's transcript toggle, and closing the open Work view. */
function renderMoreMenu(islands: LiveIslands, presentation: WorkspacePresentation): string {
  const workspaceId = presentation.workspace.id;
  const heading = `<div class="nox-phone-more-heading"><div class="nox-phone-more-actions">${renderPhoneWorkspaceActions(presentation)}</div></div>`;
  const closers = presentation.workViews.map(renderMobileWorkViewCloser).join("");
  return popupHtml({
    id: workViewDomId(workspaceId, "mobile_more_menu"), label: "More", placement: "below",
    trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.More, label: "More" }, attributesHtml: "data-mobile-more" },
    menuAttributesHtml: 'data-workspace-presentation-target="moreMenu" data-action="toggle->workspace-presentation#syncMore"',
    contentHtml: `${islands.island(workViewDomId(workspaceId, "phone_more_heading"), heading, "div", "contents")}${renderAgentViewSwitch(true)}${islands.island(workViewDomId(workspaceId, "mobile_overflow"), renderMobileWorkViews(presentation.workViews).overflowItems, "span", "contents action-list")}
      ${islands.island(workViewDomId(workspaceId, "mobile_closers"), closers, "div", "fixed-shell-more-close-section")}`,
  });
}

/** + at the end of the tab row: new agents and Work views. */
function renderNewTabMenu(presentation: WorkspacePresentation): string {
  const launchers = (presentation.commands ?? []).filter((command) => command.placement === "work-launcher");
  const agents = presentation.agentTypes.length ? `<span class="nox-phone-more-label">New agent</span>${renderPhoneAgentTypeOptions(presentation)}` : "";
  const work = launchers.length ? `${agents ? '<hr class="popup-menu__separator">' : ""}<span class="nox-phone-more-label">Open</span>${launchers.map((command) => renderWorkLauncherCommand(command, presentation.workspace.id)).join("")}` : "";
  if (!agents && !work) return "";
  return popupHtml({
    id: domId("phone_new_tab", presentation.workspace.id), label: "New tab", placement: "below",
    trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Plus, label: "New tab" }, attributesHtml: "data-nox-new-tab" },
    contentHtml: agents + work,
  });
}
