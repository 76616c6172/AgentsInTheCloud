/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isReadingScrollMessage, observeReadingScroll, type ReadingScrollDirection } from "@agents-in-the-cloud/shared/nox-reading-scroll";

const ownAttributes = new Set(["data-nox-condensed", "data-nox-tools-open"]);

/**
 * Nox phone chrome. The header condenses to its selected tab while you work in the content:
 * scrolling a transcript, terminal, list or Browser page down. Embedded pages report their own
 * scrolling (see the ingress swipe bridge), and focus moving into any other embedded page
 * counts too, since its touches never reach this document. Pulling down, tapping the header or moving
 * to another pane brings it back. Tapping an already selected Browser tab opens that Browser's
 * toolbar over the page instead of keeping it on screen.
 */
export class NoxPhoneChromeController extends Controller<HTMLElement> {
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private stopReading?: () => void;
  private destination?: string;

  connect(): void {
    this.destination = this.presentation.dataset.phoneDestination;
    this.stopReading = observeReadingScroll(this.content, this.read);
    window.addEventListener("message", this.frameRead);
    this.presentation.addEventListener("submit", this.submitted);
    this.presentation.addEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.element.addEventListener("click", this.headerClicked, true);
    this.element.addEventListener("turbo:before-morph-attribute", this.keepState);
    document.addEventListener("click", this.documentClicked, true);
    document.addEventListener("keydown", this.keyPressed);
    window.addEventListener("blur", this.windowBlurred);
    this.media.addEventListener("change", this.reset);
  }

  disconnect(): void {
    this.stopReading!();
    window.removeEventListener("message", this.frameRead);
    this.presentation.removeEventListener("submit", this.submitted);
    this.presentation.removeEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.element.removeEventListener("click", this.headerClicked, true);
    this.element.removeEventListener("turbo:before-morph-attribute", this.keepState);
    document.removeEventListener("click", this.documentClicked, true);
    document.removeEventListener("keydown", this.keyPressed);
    window.removeEventListener("blur", this.windowBlurred);
    this.media.removeEventListener("change", this.reset);
  }

  private get presentation(): HTMLElement {
    return this.element.closest<HTMLElement>(".fixed-workspace-presentation")!;
  }

  private get content(): HTMLElement {
    return this.presentation.querySelector<HTMLElement>(":scope > .fixed-shell-main")!;
  }

  private get condensed(): boolean {
    return this.element.hasAttribute("data-nox-condensed");
  }

  private get toolsOpen(): boolean {
    return this.element.hasAttribute("data-nox-tools-open");
  }

  private condense(condensed: boolean): void {
    if (condensed) this.closeTools();
    this.element.toggleAttribute("data-nox-condensed", condensed);
  }

  private closeTools(): void {
    this.element.removeAttribute("data-nox-tools-open");
  }

  private readonly reset = (): void => {
    this.condense(false);
    this.closeTools();
  };

  private readonly read = (direction: ReadingScrollDirection): void => {
    if (!this.media.matches) return;
    if (direction === "down" && !this.condensed) this.condense(true);
    else if (direction === "up" && this.condensed) this.condense(false);
  };

  private readonly frameRead = (event: MessageEvent): void => {
    if (!isReadingScrollMessage(event.data) || event.origin === "null") return;
    const frame = [...this.content.querySelectorAll("iframe")].find((candidate) => candidate.contentWindow === event.source);
    if (frame?.closest("[data-workspace-logically-visible='true']")) this.read(event.data.direction);
  };

  /** Focus moving into an embedded page is the only sign of a tap inside it. */
  private readonly windowBlurred = (): void => {
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (this.media.matches && focused instanceof HTMLIFrameElement && this.content.contains(focused)) this.condense(true);
    });
  };

  private readonly headerClicked = (event: MouseEvent): void => {
    if (!this.media.matches || !(event.target instanceof Element)) return;
    if (this.condensed) {
      event.preventDefault();
      event.stopPropagation();
      this.condense(false);
      return;
    }
    const tab = event.target.closest<HTMLElement>("[data-nox-tools]");
    if (tab?.getAttribute("aria-selected") !== "true") return;
    event.preventDefault();
    event.stopPropagation();
    this.element.toggleAttribute("data-nox-tools-open");
  };

  /** A tap anywhere else closes the toolbar; its own buttons close it once they've acted. */
  private readonly documentClicked = (event: MouseEvent): void => {
    if (!this.toolsOpen || !(event.target instanceof Element) || this.element.contains(event.target)) return;
    const toolbar = event.target.closest(".browser-toolbar");
    if (!toolbar) this.closeTools();
    else if (event.target.closest(".button, a")) setTimeout(() => this.closeTools());
  };

  private readonly submitted = (event: SubmitEvent): void => {
    if (event.target instanceof Element && event.target.closest(".browser-toolbar")) this.closeTools();
  };

  private readonly keyPressed = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.toolsOpen) this.closeTools();
  };

  /** Moving to another pane shows where you are. */
  private readonly presentationChanged = (): void => {
    const destination = this.presentation.dataset.phoneDestination;
    if (destination === this.destination) return;
    this.destination = destination;
    this.reset();
  };

  /** Server morphs keep the browser-owned chrome state. */
  private readonly keepState = (event: Event): void => {
    // SAFETY: Turbo emits this event with its attribute mutation descriptor.
    const detail = (event as CustomEvent<{ attributeName: string }>).detail;
    if (event.target === this.element && ownAttributes.has(detail.attributeName)) event.preventDefault();
  };
}
