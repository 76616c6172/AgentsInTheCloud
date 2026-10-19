import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";

/** Resume following the transcript when the user edits their prompt. */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      class FollowOnTypeEditor extends CustomEditor {
        handleInput(data: string): void {
          const previousText = this.getText();
          super.handleInput(data);
          if (
            this.getText() !== previousText &&
            tui instanceof TuiAltScreen &&
            !tui.isFollowingOutput
          ) {
            tui.scrollToBottom();
          }
        }
      }
      return new FollowOnTypeEditor(tui, theme, keybindings);
    });
  });
}
