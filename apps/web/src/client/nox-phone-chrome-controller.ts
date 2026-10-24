/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";

/**
 * Nox phone chrome. Tapping an already selected Browser tab opens that Browser's toolbar over
 * the page instead of keeping it on screen. Navigating, using a toolbar button, tapping
 * elsewhere, Escape or moving to another pane closes it again.
 *
 * The visible workspace's bar also tells the app its height, so the workspace list opens
 * below it (nox-layout.css).
 */
export class NoxPhoneChromeController extends Controller<HTMLElement> {
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private destination?: string;
  private readonly resizeObserver = new ResizeObserver(() => this.publishHeight());

  connect(): void {
    this.destination = this.presentation.dataset.phoneDestination;
    this.presentation.addEventListener("submit", this.submitted);
    this.presentation.addEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.element.addEventListener("click", this.headerClicked, true);
    this.element.addEventListener("turbo:before-morph-attribute", this.keepState);
    document.addEventListener("click", this.documentClicked, true);
    document.addEventListener("keydown", this.keyPressed);
    window.addEventListener("blur", this.closeTools);
    this.media.addEventListener("change", this.closeTools);
    this.resizeObserver.observe(this.element);
  }

  disconnect(): void {
    this.presentation.removeEventListener("submit", this.submitted);
    this.presentation.removeEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.element.removeEventListener("click", this.headerClicked, true);
    this.element.removeEventListener("turbo:before-morph-attribute", this.keepState);
    document.removeEventListener("click", this.documentClicked, true);
    document.removeEventListener("keydown", this.keyPressed);
    window.removeEventListener("blur", this.closeTools);
    this.media.removeEventListener("change", this.closeTools);
    this.resizeObserver.disconnect();
  }

  /** Hidden workspaces' bars measure nothing; the visible one reports again as it appears. */
  private publishHeight(): void {
    if (!this.element.closest(".workspace-detail-mount.visible")) return;
    this.element.closest<HTMLElement>(".fixed-shell-app")!.style.setProperty("--nox-phone-header-height", `${this.element.offsetHeight}px`);
  }

  private get presentation(): HTMLElement {
    return this.element.closest<HTMLElement>(".fixed-workspace-presentation")!;
  }

  private get toolsOpen(): boolean {
    return this.element.hasAttribute("data-nox-tools-open");
  }

  /** Also runs when focus moves into the page, the only sign of a tap inside it. */
  private readonly closeTools = (): void => {
    this.element.removeAttribute("data-nox-tools-open");
  };

  private readonly headerClicked = (event: MouseEvent): void => {
    if (!this.media.matches || !(event.target instanceof Element)) return;
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
    else if (event.target.closest(".button, a")) setTimeout(this.closeTools);
  };

  private readonly submitted = (event: SubmitEvent): void => {
    if (event.target instanceof Element && event.target.closest(".browser-toolbar")) this.closeTools();
  };

  private readonly keyPressed = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.toolsOpen) this.closeTools();
  };

  private readonly presentationChanged = (): void => {
    const destination = this.presentation.dataset.phoneDestination;
    if (destination === this.destination) return;
    this.destination = destination;
    this.closeTools();
  };

  /** Server morphs keep the browser-owned toolbar state. */
  private readonly keepState = (event: Event): void => {
    // SAFETY: Turbo emits this event with its attribute mutation descriptor.
    const detail = (event as CustomEvent<{ attributeName: string }>).detail;
    if (event.target === this.element && detail.attributeName === "data-nox-tools-open") event.preventDefault();
  };
}
