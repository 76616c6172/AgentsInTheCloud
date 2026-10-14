import { escapeHtml } from "@agents-in-the-cloud/shared";
import { attributesHtml, classNames } from "../html.ts";

export interface PanelOptions {
  element: {
    tag: "aside" | "div" | "section";
    /** Caller-owned attributes. Attribute values containing external input must be escaped. */
    attributesHtml?: string;
  };
  /** Trusted, already-escaped header contents. */
  headerHtml: string;
  /** Trusted, already-escaped body contents. */
  bodyHtml: string;
  /** Integrated panels sit flush inside a split layout instead of drawing an outer rim. */
  chrome?: "outlined" | "integrated";
  bodyLayout?: "padded" | "full-bleed";
  bodyOverflow?: "scroll" | "contained";
  /** Trusted, already-escaped footer contents. Omit when the surface has no footer actions. */
  footerHtml?: string;
}

/** Renders a bounded surface with fixed chrome around a flexible body. */
export function panelHtml(options: PanelOptions): string {
  const { element } = options;
  const footer = options.footerHtml === undefined ? "" : `<footer class="panel__footer">${options.footerHtml}</footer>`;
  return `<${element.tag} class="${escapeHtml(classNames("panel", options.chrome === "integrated" && "panel--integrated"))}"${attributesHtml(element.attributesHtml)}><header class="panel__header">${options.headerHtml}</header><div class="${escapeHtml(classNames("panel__body", options.bodyLayout === "padded" && "panel__body--padded", options.bodyOverflow === "scroll" && "panel__body--scroll"))}">${options.bodyHtml}</div>${footer}</${element.tag}>`;
}
