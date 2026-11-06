import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { Icons } from "@agents-in-the-cloud/design-system/icons";

/* Nox: on phones and the spread the workspace list is a drawer with chrome of its own, since the
 * workspace header slides away beside it. Its header gets a round New workspace button, and a
 * bottom bar reaches the app's other places. Desktop keeps the footer (nox-layout.css). */

export function renderNoxNewWorkspaceButton(): string {
  return `<span class="nox-list-new">${buttonHtml({ type: "button", variant: "primary", content: { kind: "icon-only", iconHtml: Icons.Plus, label: "New workspace" }, attributesHtml: 'data-action="workspace-pane#openPicker"' })}</span>`;
}

export function renderNoxWorkspaceListBar(settingsAttributesHtml: string): string {
  const item = (iconHtml: string, label: string) => `<span class="nox-list-bar__icon">${iconHtml}</span><span>${label}</span>`;
  return `<nav class="nox-list-bar" aria-label="App">
    <span class="nox-list-bar__item" aria-current="page">${item(Icons.Cloud, "Workspaces")}</span>
    <a class="nox-list-bar__item" href="/models" data-turbo-stream="true">${item(Icons.Usage, "Models")}</a>
    <a class="nox-list-bar__item" href="/settings" ${settingsAttributesHtml}>${item(Icons.Settings, "Settings")}</a>
  </nav>`;
}
