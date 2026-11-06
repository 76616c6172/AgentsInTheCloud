import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { renderNoxUsageGauge } from "@agents-in-the-cloud/agent/server";

/* Nox: on phones and the spread the workspace list is a drawer with chrome of its own, since the
 * workspace header slides away beside it. Its header is just the title (nox-layout.css hides the
 * header's actions there), and a bottom bar holds New workspace and the app's other places, with
 * the usage gauge on Models. Desktop keeps the header actions and the footer. */

export function renderNoxWorkspaceListBar(settingsAttributesHtml: string): string {
  const item = (iconHtml: string, label: string) => `<span class="nox-list-bar__icon">${iconHtml}</span><span>${label}</span>`;
  return `<nav class="nox-list-bar" aria-label="App">
    <button type="button" class="nox-list-bar__item" data-action="workspace-pane#openPicker" aria-label="New workspace">${item(Icons.Plus, "New")}</button>
    <a class="nox-list-bar__item" href="/models" data-turbo-stream="true">${item(renderNoxUsageGauge(), "Models")}</a>
    <a class="nox-list-bar__item" href="/settings" ${settingsAttributesHtml}>${item(Icons.Settings, "Settings")}</a>
  </nav>`;
}
