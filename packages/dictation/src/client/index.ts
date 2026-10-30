import { isWorkspacePaneVisible, type WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createDictationComposerController } from "./dictation-controller.ts";
import { SharedMicrophone } from "./microphone.ts";

const sharedMicrophone = new SharedMicrophone();
const dictationButtonSelector = '[data-dictation-composer-target="button"]';

function activeDictationButton(): HTMLButtonElement | null {
  const dialogButton = document.querySelector<HTMLButtonElement>(`dialog[open] ${dictationButtonSelector}`);
  if (dialogButton) return dialogButton;
  return [...document.querySelectorAll<HTMLButtonElement>(dictationButtonSelector)]
    .find((button) => button.closest('[data-workspace-pane-role="agent"]') && isWorkspacePaneVisible(button)) ?? null;
}

export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "dictation",
  install({ application, Controller, hooks }) {
    application.register("dictation-composer", createDictationComposerController(Controller, sharedMicrophone));
    hooks.registerCommand({
      id: "dictation.toggle",
      label: "Start or stop dictation",
      description: "Toggle microphone dictation in the active composer.",
      scope: "agent",
      binding: "Meta+Alt+Backslash",
      run: () => activeDictationButton()?.click(),
    });
  },
};
