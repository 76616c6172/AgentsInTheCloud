import { escapeHtml } from "@agents-in-the-cloud/shared";

/** The row remains a normal workspace button; only templated rows get the mobile shortcut. */
export const noxWorkspaceHoldAttributes = 'data-controller="nox-workspace-hold" data-action="pointerdown->nox-workspace-hold#start contextmenu->nox-workspace-hold#contextMenu blur@window->nox-workspace-hold#cancel visibilitychange@document->nox-workspace-hold#cancel agents-in-the-cloud:mobile-swipe-start@document->nox-workspace-hold#cancel turbo:before-morph-element->nox-workspace-hold#cancel"';

export function noxWorkspaceHoldLaunch(workspaceTemplateId: string): string {
  const query = new URLSearchParams({ workspaceTemplate: workspaceTemplateId, autoSelect: "true" });
  return `<a hidden href="/launch-composer?${escapeHtml(query.toString())}" data-turbo="true" data-turbo-frame="launch_composer" data-nox-workspace-hold-target="launch">New workspace from this template</a>`;
}

export const noxWorkspaceHoldInk = `<span class="nox-workspace-ink" aria-hidden="true">
  <span class="nox-workspace-ink__wash"></span><span class="nox-workspace-ink__halo"></span>
  <span class="nox-workspace-ink__window"><span class="nox-workspace-ink__texture"></span><span class="nox-workspace-ink__ripple"></span><span class="nox-workspace-ink__ripple nox-workspace-ink__ripple--inner"></span></span>
  <span class="nox-workspace-ink__crest"></span>
</span>`;
