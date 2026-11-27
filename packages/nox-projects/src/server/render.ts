import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { destructiveConfirmationHtml } from "@agents-in-the-cloud/design-system/destructive-confirmation";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { domId, escapeHtml, workspaceModuleModalFrameId } from "@agents-in-the-cloud/shared";
import type { ProjectTemplateInfo, ProjectWorkspaceInfo } from "./bridge.ts";
import { resolveTemplateProjectId, resolveWorkspaceProjectId, type NoxProjectRecord } from "./store.ts";

export const projectsDialogId = "nox_projects_dialog";
export const noxFolderIconHtml = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.58l1.32 1.32a2 2 0 0 0 1.4.58H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
export const noxFilterIconHtml = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"><path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/></svg>';
export const noxCheckIconHtml = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function projectOptionsHtml(projects: readonly NoxProjectRecord[], selectedProjectId: string | undefined): string {
  const none = `<option value=""${selectedProjectId === undefined ? " selected" : ""}>No Project</option>`;
  const items = projects.map((project) =>
    `<option value="${escapeHtml(project.id)}"${selectedProjectId === project.id ? " selected" : ""}>${escapeHtml(project.name)}</option>`,
  ).join("");
  return `${none}${items}`;
}

export function renderManageProjectsDialog(options: {
  projects: readonly NoxProjectRecord[];
  templates: readonly ProjectTemplateInfo[];
  workspaces: readonly ProjectWorkspaceInfo[];
  error?: string;
}): string {
  const { projects, templates, workspaces, error } = options;

  const errorBanner = error
    ? `<p class="nox-projects-error" role="alert">${escapeHtml(error)}</p>`
    : "";

  const createForm = `<form class="nox-projects-create" method="post" action="/projects" data-turbo-stream="true">
    <input class="text-field" type="text" name="name" placeholder="New project name…" aria-label="New project name" required autocomplete="off">
    ${buttonHtml({ type: "submit", variant: "primary", content: { kind: "caption", caption: "Add project" } })}
  </form>`;

  const projectRows = projects.length
    ? `<div class="nox-projects-list">${projects.map((project) => {
      const formId = domId("nox_project_rename", project.id);
      return `<div class="nox-projects-row">
        <form id="${escapeHtml(formId)}" class="nox-projects-rename" method="post" action="/projects/${encodeURIComponent(project.id)}/rename" data-turbo-stream="true">
          <span class="nox-projects-row-icon">${noxFolderIconHtml}</span>
          <input class="text-field nox-projects-name-input" type="text" name="name" value="${escapeHtml(project.name)}" aria-label="Project name" required>
          ${buttonHtml({ type: "submit", variant: "quiet", content: { kind: "caption", caption: "Save" } })}
        </form>
        <form class="nox-projects-delete" method="post" action="/projects/${encodeURIComponent(project.id)}/delete" data-turbo-stream="true">
          ${destructiveConfirmationHtml({
            id: domId("nox_project_delete", project.id),
            trigger: { type: "button", variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.Trash, label: `Delete ${project.name}` } },
            confirmCaption: "Delete",
            cancelCaption: "Keep",
          })}
        </form>
      </div>`;
    }).join("")}</div>`
    : `<p class="nox-projects-empty">Create a project to group templates and workspaces together, filter the sidebar, and scope Hub threads.</p>`;

  const templateSection = templates.length && projects.length
    ? `<section class="nox-projects-section">
        <h3 class="nox-projects-heading">Templates</h3>
        <div class="nox-projects-assignments">${templates.map((template) => {
          const selected = resolveTemplateProjectId(projects, template.id);
          const formId = domId("nox_project_tpl", template.id);
          return `<form id="${escapeHtml(formId)}" class="nox-projects-assign-row" method="post" action="/projects/assign-template" data-turbo-stream="true">
            <input type="hidden" name="templateId" value="${escapeHtml(template.id)}">
            <span class="nox-projects-assign-label">${escapeHtml(template.title)}</span>
            <select class="popup-select" name="projectId" aria-label="Project for template ${escapeHtml(template.title)}" data-controller="popup-select composer-selection-autosubmit" data-composer-selection-autosubmit-form-id-value="${escapeHtml(formId)}" data-action="change->composer-selection-autosubmit#submit">
              ${projectOptionsHtml(projects, selected)}
            </select>
          </form>`;
        }).join("")}</div>
      </section>`
    : "";

  const activeWorkspaces = workspaces.filter((ws) => !ws.parked);
  const workspaceSection = activeWorkspaces.length && projects.length
    ? `<section class="nox-projects-section">
        <h3 class="nox-projects-heading">Workspaces</h3>
        <div class="nox-projects-assignments">${activeWorkspaces.map((ws) => {
          const selected = resolveWorkspaceProjectId(projects, { workspaceId: ws.id, templateId: ws.templateId });
          const inherited = ws.templateId ? resolveTemplateProjectId(projects, ws.templateId) : undefined;
          const formId = domId("nox_project_ws", ws.id);
          const note = inherited && selected === inherited && ws.templateTitle ? `from ${ws.templateTitle}` : ws.templateTitle ?? "";
          return `<form id="${escapeHtml(formId)}" class="nox-projects-assign-row" method="post" action="/projects/assign-workspace" data-turbo-stream="true">
            <input type="hidden" name="workspaceId" value="${escapeHtml(ws.id)}">
            <input type="hidden" name="templateId" value="${escapeHtml(ws.templateId ?? "")}">
            <span class="nox-projects-assign-copy">
              <span class="nox-projects-assign-label">${escapeHtml(ws.title)}</span>
              ${note ? `<span class="nox-projects-assign-note">${escapeHtml(note)}</span>` : ""}
            </span>
            <select class="popup-select" name="projectId" aria-label="Project for workspace ${escapeHtml(ws.title)}" data-controller="popup-select composer-selection-autosubmit" data-composer-selection-autosubmit-form-id-value="${escapeHtml(formId)}" data-action="change->composer-selection-autosubmit#submit">
              ${projectOptionsHtml(projects, selected)}
            </select>
          </form>`;
        }).join("")}</div>
      </section>`
    : "";

  const bodyHtml = `<div class="nox-projects-modal">
    ${errorBanner}
    ${createForm}
    ${projectRows}
    ${templateSection}
    ${workspaceSection}
  </div>`;

  return dialogHtml({
    element: { id: projectsDialogId, attributesHtml: "data-dialog-auto-show" },
    iconHtml: noxFolderIconHtml,
    titleCaption: "Projects",
    bodyHtml,
  });
}

export function renderManageProjectsFrame(dialogMarkup: string): string {
  return `<turbo-frame id="${workspaceModuleModalFrameId}">${dialogMarkup}</turbo-frame>`;
}
