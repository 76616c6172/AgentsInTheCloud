/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";

// A vertical drag this far scrolls content far enough to count as reading; pulling back down
// takes a little more, so reading upward doesn't immediately bring the chrome back.
const condenseDistance = 32;
const expandDistance = 48;
const ownAttributes = new Set(["data-nox-condensed", "data-nox-tools-open"]);

/**
 * Nox phone chrome. The header condenses to its selected tab while you work in the content:
 * scrolling a transcript, terminal or list down, or tapping into an embedded page (whose
 * cross-origin touches never reach this document). Pulling down, tapping the header or moving
 * to another pane brings it back. Tapping an already selected Browser tab opens that Browser's
 * toolbar over the page instead of keeping it on screen.
 */
export class NoxPhoneChromeController extends Controller<HTMLElement> {
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private touch?: { x: number; y: number; scrolls: boolean };
  private destination?: string;

  connect(): void {
    this.destination = this.presentation.dataset.phoneDestination;
    this.presentation.addEventListener("touchstart", this.touchStarted, { passive: true });
    this.presentation.addEventListener("touchmove", this.touchMoved, { passive: true });
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
    this.presentation.removeEventListener("touchstart", this.touchStarted);
    this.presentation.removeEventListener("touchmove", this.touchMoved);
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

  private readonly touchStarted = (event: TouchEvent): void => {
    this.touch = undefined;
    const target = event.target;
    if (!this.media.matches || event.touches.length !== 1 || !(target instanceof Element)) return;
    if (!this.content.contains(target) || target.closest("input, textarea, select, [contenteditable]")) return;
    const { clientX: x, clientY: y } = event.touches[0]!;
    this.touch = { x, y, scrolls: this.scrollsVertically(target) };
  };

  private readonly touchMoved = (event: TouchEvent): void => {
    if (!this.touch) return;
    const { clientX, clientY } = event.touches[0]!;
    const dx = clientX - this.touch.x;
    const dy = clientY - this.touch.y;
    // Horizontal drags belong to the pane and drawer swipes.
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > condenseDistance) this.touch = undefined;
      return;
    }
    if (dy <= -condenseDistance && this.touch.scrolls && !this.condensed) {
      this.condense(true);
      this.touch = undefined;
    } else if (dy >= expandDistance && this.condensed) {
      this.condense(false);
      this.touch = undefined;
    }
  };

  /** Only content that can scroll condenses; short pages keep their chrome. */
  private scrollsVertically(target: Element): boolean {
    for (let element: Element | null = target; element && element !== this.content; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY)) return true;
    }
    return false;
  }

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
