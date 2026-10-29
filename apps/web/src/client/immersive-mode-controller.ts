import { Controller } from "@hotwired/stimulus";
import { setContentRowLabel } from "@agents-in-the-cloud/design-system/content-row/client";

/** Browser fullscreen belongs to this page, never to a Workspace or a saved setting. */
export class ImmersiveModeController extends Controller<HTMLElement> {
  static targets = ["button"];
  declare readonly buttonTarget: HTMLButtonElement;

  connect(): void {
    this.refresh();
  }

  refresh(event?: Event): void {
    // Turbo may keep this controller while restoring its server-rendered contents.
    if (event?.type === "turbo:morph-element" && event.target !== this.element) return;
    const active = document.fullscreenElement === document.documentElement;
    this.element.hidden = !document.fullscreenEnabled && !active;
    setContentRowLabel(this.buttonTarget, active ? "Exit immersive mode" : "Immersive mode");
    this.buttonTarget.title = active ? "Show browser and system bars" : "Hide browser and system bars";
  }

  async toggle(): Promise<void> {
    try {
      if (document.fullscreenElement === document.documentElement) {
        await document.exitFullscreen();
      } else {
        // Call in the click handler: awaiting other work would lose user activation.
        // Fullscreen the document so dialogs, popovers and all panes remain available.
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (error) {
      document.querySelector<HTMLDialogElement>("#immersive_mode_error")!.showModal();
      throw error;
    } finally {
      this.refresh();
    }
  }
}
