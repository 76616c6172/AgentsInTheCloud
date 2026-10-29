import { contentRowHtml } from "@agents-in-the-cloud/design-system/content-row";
import { dialogHtml } from "@agents-in-the-cloud/design-system/dialog";
import { Icons } from "@agents-in-the-cloud/design-system/icons";

export function renderImmersiveMode(menuItem = false): string {
  const button = contentRowHtml({
    kind: "compact", width: "fill",
    label: { kind: "text", text: "Immersive mode" },
    leadingHtml: Icons.Maximize,
    element: {
      tag: "button",
      attributesHtml: `type="button"${menuItem ? ' role="menuitem"' : ""} data-immersive-mode-target="button" data-action="click->immersive-mode#toggle"`,
    },
  });
  return `<div data-controller="immersive-mode" data-action="fullscreenchange@document->immersive-mode#refresh turbo:morph-element->immersive-mode#refresh" hidden>${button}</div>`;
}

/** Outside menus and the workspace drawer: either may be hidden when the request fails. */
export function renderImmersiveModeError(): string {
  return dialogHtml({
    element: { id: "immersive_mode_error" },
    iconHtml: Icons.Exclamation,
    titleCaption: "Couldn’t change fullscreen",
    bodyHtml: "<p>Try again, or open AgentsInTheCloud directly rather than inside a preview.</p>",
  });
}
