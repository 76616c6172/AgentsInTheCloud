import { appendComposerQuote, composerViewportHeight, focusComposerText, sizeComposer } from "./composer-editor.ts";
import { changeLayout, focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, mobileComposerMediaQuery, type AgentComposerQuoteDetail, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";

/** The composer may grow to this share of the space above the keyboard (or of the window). */
const composerMaxShare = 0.4;

/**
 * Composer visibility, height and draft indicator. Every change is applied in
 * one layout transaction so whatever sits above is pushed up in a single step.
 */
export function createAgentComposerController(Controller: WorkspaceClientControllerConstructor) {
  return class AgentComposerController extends Controller {
    static targets = ["opener"];
    static values = { openOnSelect: { type: Boolean, default: true }, openOnCreate: Boolean };
    declare readonly openOnSelectValue: boolean;
    declare readonly openOnCreateValue: boolean;
    declare readonly element: HTMLElement;
    declare readonly openerTarget: HTMLButtonElement;
    declare readonly hasOpenerTarget: boolean;
    private activeSelection = false;
    private pane!: HTMLElement;

    connect(): void {
      this.pane = this.element.closest<HTMLElement>('[data-workspace-pane-role="agent"]')!;
      this.updateDraftIndicator();
      // Sizes a composer that is already open; opening it here sizes it as it opens.
      this.autosize();
      this.selected();
    }

    disconnect(): void {
      this.activeSelection = false;
      this.blurInput();
    }

    private get composer(): HTMLElement | null {
      return this.element.querySelector<HTMLElement>(":scope > .composer");
    }

    private get input(): HTMLTextAreaElement | null {
      return this.element.querySelector<HTMLTextAreaElement>(":scope > .composer .composer-input");
    }

    private get isOpen(): boolean {
      return this.element.classList.contains("agent-composer-open");
    }

    private get mobile(): boolean {
      return window.matchMedia(mobileComposerMediaQuery).matches;
    }

    /** Programmatic focus cannot raise a soft keyboard, so touch devices wait for a tap. */
    private get focusesOnOpen(): boolean {
      return !this.mobile && !focusLikelyOpensSoftwareKeyboard();
    }

    private blurInput(): void {
      const active = document.activeElement;
      if (active instanceof HTMLElement && this.composer?.contains(active)) active.blur();
    }

    private setOpen(open: boolean): void {
      if (open === this.isOpen) return;
      changeLayout(() => {
        if (!open) this.blurInput();
        this.element.classList.toggle("agent-composer-open", open);
        this.autosize();
      });
    }

    selected(event?: Event): void {
      if (event && event.target !== this.pane) return;
      if (!isWorkspacePaneVisible(this.element) || this.activeSelection) return;
      this.activeSelection = true;
      const input = this.input;
      if (!input) return; // Ended CLI sessions are read-only.
      // Some agent types start ready to write, including on mobile.
      const created = this.pane.dataset.workspaceAgentCreated === "true";
      delete this.pane.dataset.workspaceAgentCreated;
      // Otherwise, reading comes first on mobile and in CLI views.
      this.setOpen((created && this.openOnCreateValue) || (this.openOnSelectValue && !this.mobile));
      if (focusLikelyOpensSoftwareKeyboard()) this.blurInput();
      else if (document.hasFocus()) {
        if (this.isOpen) input.focus({ preventScroll: true });
        else this.element.dispatchEvent(new Event("agents-in-the-cloud:workspace-agent-focus"));
      }
    }

    hidden(event: Event): void {
      if (event.target !== this.pane) return;
      // Live-surface replacement briefly hides and re-shows the same pane.
      setTimeout(() => {
        if (this.element.isConnected && isWorkspacePaneVisible(this.element)) return;
        this.activeSelection = false;
        this.blurInput();
      }, 0);
    }

    reveal(): void {
      this.open();
    }

    open(): void {
      this.setOpen(true);
      if (this.focusesOnOpen) this.input!.focus({ preventScroll: true });
    }

    close(): void {
      this.setOpen(false);
    }

    /** Selected transcript text, to comment on: the composer opens with it and grows in one step. */
    quote(event: CustomEvent<AgentComposerQuoteDetail>): void {
      const input = this.input!;
      changeLayout(() => {
        this.setOpen(true);
        appendComposerQuote(input, event.detail.quote, event.detail.comment);
      });
    }

    /** A prompt was accepted for sending. On mobile the composer and keyboard go away at once. */
    sending(): void {
      if (this.mobile) this.close();
    }

    sent(): void {
      this.updateDraftIndicator();
      if (this.mobile) this.close();
    }

    /** Sending failed after the mobile composer closed: bring the draft and its error back. */
    failed(): void {
      if (this.mobile) this.setOpen(true);
    }

    focusText(event: MouseEvent): void {
      if (this.composer && this.input) focusComposerText(this.composer, event);
    }

    /** A focused terminal takes the space; the composer collapses and keeps its draft. */
    focused(event: FocusEvent): void {
      if (event.target instanceof Element && event.target.closest(".observable-terminal-host") && this.isOpen) this.close();
    }

    draftChanged(event: Event): void {
      if (event.target !== this.input) return;
      this.autosize();
      this.updateDraftIndicator();
    }

    /** The keyboard arrangement changed: the maximum height depends on the space above it. */
    layout(): void {
      this.autosize();
    }

    autosize(): void {
      const composer = this.composer;
      if (!composer || !this.input || !this.isOpen) return;
      sizeComposer(composer, Math.floor(composerViewportHeight() * composerMaxShare));
    }

    private updateDraftIndicator(): void {
      if (!this.hasOpenerTarget) return;
      const input = this.input;
      const draft = Boolean(input?.value.trim() || this.composer?.querySelector(".agent-chip"));
      this.openerTarget.parentElement!.toggleAttribute("data-draft", draft);
    }
  };
}
