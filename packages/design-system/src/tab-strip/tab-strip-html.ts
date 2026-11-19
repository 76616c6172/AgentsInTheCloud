import { escapeHtml } from "@agents-in-the-cloud/shared";
import { contentRowHtml, type ContentRowLabel, type ContentRowElement } from "../content-row/content-row-html.ts";
import { attributesHtml } from "../html.ts";
import { Icons } from "../icons/icons-html.ts";
import { popupHtml, type PopupOptions } from "../popup/popup-html.ts";

export interface TabStatus {
  busy?: boolean;
  requestingAttention?: boolean;
  attributesHtml?: string;
}

function tabStatusHtml(status: TabStatus = {}): string {
  const label = [status.busy && "Busy", status.requestingAttention && "Requesting attention"].filter(Boolean).join("; ");
  return `<span class="tab-strip__status"${attributesHtml(status.attributesHtml)} role="img" aria-label="${escapeHtml(label)}"${label ? "" : " hidden"}><span class="status-indicator"><i class="status-dot running" aria-hidden="true"${status.busy ? "" : " hidden"}></i><i class="status-dot attention" aria-hidden="true"${status.requestingAttention ? "" : " hidden"}></i></span></span>`;
}

export function tabHtml(options: {
  label: ContentRowLabel;
  iconHtml?: string;
  status?: TabStatus;
  selected: boolean;
  primary: ContentRowElement;
  containerAttributesHtml?: string;
  closeHtml?: string;
  touchMenu?: Pick<PopupOptions, "id" | "label" | "contentHtml">;
}): string {
  const actions = options.touchMenu
    ? `<span class="tab-strip__pointer-actions">${options.closeHtml ?? ""}</span><span class="tab-strip__touch-actions">${popupHtml({
      ...options.touchMenu,
      trigger: { variant: "quiet", content: { kind: "icon-only", iconHtml: Icons.More, label: options.touchMenu.label } },
    })}</span>`
    : options.closeHtml;
  return contentRowHtml({
    kind: "compact", width: "fill", label: options.label, leadingHtml: options.iconHtml, trailingHtml: tabStatusHtml(options.status),
    container: { attributesHtml: options.containerAttributesHtml },
    primary: { tag: options.primary.tag, attributesHtml: `role="tab" aria-selected="${options.selected}" tabindex="${options.selected ? 0 : -1}" ${options.primary.attributesHtml ?? ""}` },
    engagedActionsHtml: actions,
  });
}

export function tabStripHtml(options: { id: string; label: string; tabsHtml: string }): string {
  const label = escapeHtml(options.label);
  const id = escapeHtml(options.id);
  return `<div id="${id}" class="tab-strip" data-controller="tab-strip" data-action="keydown->tab-strip#navigate mouseover->tab-strip#engage focusin->tab-strip#engage turbo:before-morph-element->tab-strip#schedule"><div id="${id}_tabs" class="tab-strip__tabs" data-tab-strip-target="list" data-action="scroll->tab-strip#syncScroll" role="tablist" aria-label="${label}">${options.tabsHtml}</div></div>`;
}
