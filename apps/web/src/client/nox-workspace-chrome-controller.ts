/// <reference lib="dom" />

import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { controllerForElement } from "./workspace-controller-registry.ts";

/**
 * Nox workspace chrome. Clicking an already selected Browser tab opens its toolbar over
 * the page instead of keeping it on screen. Navigating, using a toolbar button, tapping
 * elsewhere, Escape or moving to another pane closes it again.
 *
 * The visible workspace's bar also tells the app its height, so the workspace list opens
 * below it (nox-layout.css).
 *
 * On a phone the bar's slots show the active agent and Work view, and measure their names so
 * the open slot can unfold to fit (nox-layout.css). The lit slot opens its switcher, and a lit
 * Browser its toolbar; taps on the other slots are swipes (mobile-swipe).
 */
export class NoxWorkspaceChromeController extends Controller<HTMLElement> {
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private destination?: string;
  private readonly resizeObserver = new ResizeObserver(() => this.publishHeight());
  private readonly segmentObserver = new ResizeObserver(() => this.measureSegments());

  connect(): void {
    this.destination = this.currentDestination;
    this.presentation.addEventListener("submit", this.submitted);
    this.presentation.addEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.presentation.addEventListener("click", this.headerClicked, true);
    this.presentation.addEventListener("turbo:before-morph-attribute", this.keepState);
    document.addEventListener("click", this.documentClicked, true);
    document.addEventListener("keydown", this.keyPressed);
    window.addEventListener("blur", this.closeTools);
    this.media.addEventListener("change", this.closeTools);
    this.resizeObserver.observe(this.element);
    document.addEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncSegments);
    this.segmentObserver.observe(this.segments);
    this.syncSegments();
  }

  disconnect(): void {
    this.presentation.removeEventListener("submit", this.submitted);
    this.presentation.removeEventListener("agents-in-the-cloud:presentation-changed", this.presentationChanged);
    this.presentation.removeEventListener("click", this.headerClicked, true);
    this.presentation.removeEventListener("turbo:before-morph-attribute", this.keepState);
    document.removeEventListener("click", this.documentClicked, true);
    document.removeEventListener("keydown", this.keyPressed);
    window.removeEventListener("blur", this.closeTools);
    this.media.removeEventListener("change", this.closeTools);
    this.resizeObserver.disconnect();
    document.removeEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncSegments);
    this.segmentObserver.disconnect();
  }

  private get segments(): HTMLElement {
    return this.element.querySelector<HTMLElement>(".nox-phone-segments")!;
  }

  /** Each slot's name at full width. Hidden workspaces measure nothing until they appear. */
  private measureSegments(): void {
    const segments = this.segments;
    segments.querySelectorAll<HTMLElement>("[data-nox-segment] .nox-phone-segment__face:not([hidden])").forEach(face => {
      const label = face.querySelector<HTMLElement>(".nox-phone-segment__label")!;
      const status = face.querySelector<HTMLElement>(".nox-phone-segment__status")!;
      const width = label.scrollWidth + (status.offsetWidth ? status.offsetWidth + 6 : 0);
      segments.style.setProperty(`--nox-${face.closest<HTMLElement>("[data-nox-segment]")!.dataset.noxSegment}-text`, `${Math.ceil(width)}px`);
    });
  }

  /** Shows the active agent's and view's faces, or the empty ones, and marks the lit slot. */
  private readonly syncSegments = (): void => {
    const active = (role: string) => this.presentation.querySelector<HTMLElement>(`[data-workspace-pane-role='${role}'].is-active`)?.dataset.workspacePaneId;
    const agentId = active("agent");
    const workKey = active("work");
    for (const [kind, key] of [["agent", agentId], ["work", workKey]] as const) {
      const faces = [...this.element.querySelectorAll<HTMLElement>(`[data-nox-${kind}-face]`)];
      const face = faces.find(candidate => candidate.getAttribute(`data-nox-${kind}-face`) === key) ?? faces[0];
      faces.forEach(candidate => { candidate.hidden = candidate !== face; });
    }
    this.measureSegments();
    this.element.querySelectorAll<HTMLElement>("[data-nox-pick-agent]").forEach(row => row.setAttribute("aria-checked", String(row.dataset.noxPickAgent === agentId)));
    this.segments.querySelectorAll<HTMLElement>("[data-more-work-key]").forEach(row => row.setAttribute("aria-checked", String(row.dataset.moreWorkKey === workKey)));
    const lit = this.litSegment;
    this.element.querySelectorAll<HTMLElement>("[data-nox-segment]").forEach(segment => {
      segment.querySelector(".nox-phone-segment__main")!.setAttribute("aria-current", String(segment.dataset.noxSegment === lit));
    });
  };

  private get litSegment(): string {
    if (this.element.closest(".is-mobile-workspace-pane-open")) return "list";
    return this.presentation.dataset.phoneDestination!.startsWith("work:") ? "work" : "agents";
  }

  /** Reached only on the lit slot: other slots' taps are swipes. */
  segmentTapped(event: Event): void {
    // SAFETY: The action is declared on a slot's main button.
    const segment = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-nox-segment]")!;
    if (segment.querySelector("[data-nox-browser]:not([hidden])")) this.toggleTools();
    else segment.querySelector<HTMLElement>("[data-popup-menu-trigger]")!.click();
  }

  pickAgent(event: Event): void {
    // SAFETY: The action is declared on a switcher row carrying its agent.
    const agentId = (event.currentTarget as HTMLElement).dataset.noxPickAgent!;
    controllerForElement<{ selectAgentById(agentId: string): void }>(this.presentation, "workspace-presentation")!.selectAgentById(agentId);
  }

  /** Hidden workspaces' bars measure nothing; the visible one reports again as it appears. */
  private publishHeight(): void {
    if (!this.element.closest(".workspace-detail-mount.visible")) return;
    this.element.closest<HTMLElement>(".fixed-shell-app")!.style.setProperty("--nox-phone-header-height", `${this.element.offsetHeight}px`);
  }

  private get presentation(): HTMLElement {
    return this.element.closest<HTMLElement>(".fixed-workspace-presentation")!;
  }

  private get currentDestination(): string | undefined {
    if (this.media.matches) return this.presentation.dataset.phoneDestination;
    return this.presentation.classList.contains("is-work-pane-open")
      ? this.presentation.querySelector<HTMLElement>(".fixed-shell-work-pane [data-work-view-key][aria-selected='true']")?.dataset.workViewKey
      : undefined;
  }

  private syncExpanded(): void {
    this.presentation.querySelectorAll<HTMLElement>(".fixed-shell-work-pane [data-nox-tools]").forEach(tab => {
      tab.setAttribute("aria-expanded", String(this.toolsOpen && tab.getAttribute("aria-selected") === "true"));
    });
  }

  private get toolsOpen(): boolean {
    return this.element.hasAttribute("data-nox-tools-open");
  }

  /** Also runs when focus moves into the page, the only sign of a tap inside it. */
  private readonly closeTools = (): void => {
    this.element.removeAttribute("data-nox-tools-open");
    this.syncExpanded();
  };

  private readonly headerClicked = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLElement>("[data-nox-tools]");
    if (tab?.getAttribute("aria-selected") !== "true") return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleTools();
  };

  private toggleTools(): void {
    this.element.toggleAttribute("data-nox-tools-open");
    this.syncExpanded();
    if (this.toolsOpen && !this.media.matches) {
      // A newly selected Browser may still be loading its live body.
      const address = this.presentation.querySelector<HTMLInputElement>(".fixed-shell-surface.is-active .browser-address-input");
      address?.focus({ preventScroll: true });
      address?.select();
    }
  }

  /** A tap anywhere else closes the toolbar; its own buttons close it once they've acted. */
  private readonly documentClicked = (event: MouseEvent): void => {
    if (!this.toolsOpen || !(event.target instanceof Element) || this.element.contains(event.target)) return;
    const tab = event.target.closest("[data-nox-tools][aria-selected='true']");
    if (tab && this.presentation.contains(tab)) return;
    const toolbar = event.target.closest(".browser-toolbar");
    if (!toolbar) this.closeTools();
    else if (event.target.closest(".button, a")) setTimeout(this.closeTools);
  };

  private readonly submitted = (event: SubmitEvent): void => {
    if (event.target instanceof Element && event.target.closest(".browser-toolbar")) this.closeTools();
  };

  private readonly keyPressed = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.toolsOpen) return;
    this.closeTools();
    if (!this.media.matches) this.presentation.querySelector<HTMLElement>(".fixed-shell-work-pane [data-nox-tools][aria-selected='true']")!.focus({ preventScroll: true });
  };

  private readonly presentationChanged = (): void => {
    const destination = this.currentDestination;
    if (destination !== this.destination) {
      this.destination = destination;
      this.closeTools();
    }
    this.syncExpanded();
    this.syncSegments();
  };

  /** Server morphs keep the browser-owned toolbar state. */
  private readonly keepState = (event: Event): void => {
    // SAFETY: Turbo emits this event with its attribute mutation descriptor.
    const detail = (event as CustomEvent<{ attributeName: string }>).detail;
    if (event.target === this.element && detail.attributeName === "data-nox-tools-open") event.preventDefault();
    if (event.target === this.segments && detail.attributeName === "style") event.preventDefault();
    if (event.target instanceof Element && event.target.matches("[data-nox-tools]") && detail.attributeName === "aria-expanded") event.preventDefault();
  };
}
