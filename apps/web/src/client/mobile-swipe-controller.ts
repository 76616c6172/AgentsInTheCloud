import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection, type MobileSwipeDrag } from "@agents-in-the-cloud/shared/mobile-swipe";
import { controllerForElement, workspaceNavigationController } from "./workspace-controller-registry.ts";

interface SwipePresentation {
  mobileSwipeNavigation(direction: MobileSwipeDirection): (() => void) | undefined;
  previewMobileSwipe(): void;
  endMobileSwipePreview(): void;
  prepareMobileTab(tab: HTMLElement): void;
  selectAgentById(agentId: string): void;
  selectMobileWork(): void;
}

interface SwipeNavigation {
  navigate: () => void;
  /** The workspace list reveal, rather than a move between the Agent and Work panes. */
  drawer: boolean;
}

// A flick commits regardless of distance; a slow drag commits past halfway.
const flickVelocity = 0.3;

export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  /** An Agent↔Work move still settling; it commits its navigation when the motion ends. */
  private paneMotion?: { finish: () => void };

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.navigationFor, this.dragFor);
    window.addEventListener("message", this.receive);
    this.element.addEventListener("click", this.tabTapped, true);
    this.element.addEventListener("load", this.frameLoaded, true);
    this.element.addEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames, true);
    document.addEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncFrames);
    this.media.addEventListener("change", this.syncFrames);
    this.syncFrames();
  }

  disconnect(): void {
    this.stopObserving!();
    window.removeEventListener("message", this.receive);
    this.element.removeEventListener("click", this.tabTapped, true);
    this.element.removeEventListener("load", this.frameLoaded, true);
    this.element.removeEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames, true);
    document.removeEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncFrames);
    this.media.removeEventListener("change", this.syncFrames);
  }

  private get presentationElement(): HTMLElement | null {
    const element = this.element.querySelector<HTMLElement>(".workspace-detail-resident.visible [data-controller~=workspace-presentation]");
    return element && !element.closest("[inert]") ? element : null;
  }

  private get presentation(): SwipePresentation | null {
    const element = this.presentationElement;
    return element ? controllerForElement<SwipePresentation>(element, "workspace-presentation") : null;
  }

  private get sidebarOpen(): boolean {
    return this.element.classList.contains("is-mobile-workspace-pane-open");
  }

  private resolveNavigation(direction: MobileSwipeDirection): SwipeNavigation | undefined {
    const presentation = this.presentation;
    if (!this.media.matches || this.element.closest("[inert]") || !presentation
      || document.querySelector("dialog[open], :popover-open, .workspace-ssh-trust-overlay")) return;
    if (this.sidebarOpen) {
      return direction === 1 ? { navigate: () => workspaceNavigationController()!.closeWorkspacePane(), drawer: true } : undefined;
    }
    const navigate = presentation.mobileSwipeNavigation(direction);
    if (navigate) return { navigate, drawer: false };
    // The sidebar sits before the first content destination; never wrap at the end.
    return direction === -1 ? { navigate: () => workspaceNavigationController()!.showWorkspacePane(), drawer: true } : undefined;
  }

  private readonly navigationFor = (direction: MobileSwipeDirection): (() => void) | undefined => {
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    if (resolved.drawer) return resolved.navigate;
    // Frames navigate in one step: play the same depth swap a drag would.
    return () => {
      this.settlePaneMotion();
      const current = this.resolveNavigation(direction);
      if (!current || current.drawer) return current?.navigate();
      this.playPaneMotion(direction, current.navigate);
    };
  };

  /** Tabs across the Agent/Work boundary play the depth swap; tabs within a side switch in place. */
  private readonly tabTapped = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLElement>("[data-nox-phone-tab]");
    const presentation = this.presentation;
    if (!tab || !presentation || !this.media.matches) return;
    this.settlePaneMotion();
    const onWork = this.presentationElement!.dataset.phoneDestination!.startsWith("work:");
    const toWork = tab.dataset.noxPhoneTab!.startsWith("work:");
    if (onWork === toWork) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    presentation.prepareMobileTab(tab);
    const agentId = tab.dataset.agentId;
    // Opening the prepared view mustn't focus a terminal and raise the keyboard.
    this.playPaneMotion(toWork ? 1 : -1, () => agentId ? presentation.selectAgentById(agentId) : presentation.selectMobileWork());
  };

  private playPaneMotion(direction: MobileSwipeDirection, navigate: () => void): void {
    const start = this.beginPaneMotion(direction);
    // Apply the starting position before moving, so the transition has somewhere to start from.
    void this.presentationElement!.offsetWidth;
    this.settlePane(1 - start, navigate);
  }

  /** Swipes in this document follow the finger; frames still navigate in one step. */
  private readonly dragFor = (direction: MobileSwipeDirection): MobileSwipeDrag | undefined => {
    this.settlePaneMotion();
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    return resolved.drawer ? this.drawerDrag(resolved) : this.paneDrag(direction, resolved);
  };

  private drawerDrag(resolved: SwipeNavigation): MobileSwipeDrag {
    const opening = !this.sidebarOpen;
    const pane = this.element.querySelector<HTMLElement>(":scope > .fixed-shell-workspace-pane")!;
    // Include the card's gap from the screen edge so it leaves fully at progress 0.
    const travel = pane.offsetWidth + pane.offsetLeft * 2;
    let progress = opening ? 0 : 1;
    const release = (): void => {
      this.element.removeAttribute("data-nox-drawer-drag");
      this.element.style.removeProperty("--nox-drawer-progress");
    };
    return {
      move: (distance) => {
        progress = Math.min(1, Math.max(0, (opening ? 0 : 1) + distance / travel));
        this.element.style.setProperty("--nox-drawer-progress", String(progress));
        this.element.setAttribute("data-nox-drawer-drag", "");
      },
      end: (_distance, velocity) => {
        const flick = Math.abs(velocity) >= flickVelocity;
        const commit = opening ? (flick ? velocity > 0 : progress > 0.5) : (flick ? velocity < 0 : progress < 0.5);
        release();
        if (commit) resolved.navigate();
      },
      cancel: release,
    };
  }

  /** Agent is progress 0 and Work is 1; both panes stay visible while the depth swap moves. */
  private paneDrag(direction: MobileSwipeDirection, resolved: SwipeNavigation): MobileSwipeDrag {
    const start = this.beginPaneMotion(direction);
    const presentation = this.presentationElement!;
    presentation.setAttribute("data-nox-pane-drag", "");
    const travel = presentation.querySelector<HTMLElement>(".fixed-shell-main")!.clientWidth;
    let progress = start;
    return {
      move: (distance) => {
        progress = Math.min(1, Math.max(0, start - distance / travel));
        presentation.style.setProperty("--nox-pane-progress", String(progress));
      },
      end: (_distance, velocity) => {
        const flick = Math.abs(velocity) >= flickVelocity;
        const towardWork = flick ? velocity < 0 : progress > 0.5;
        const commit = towardWork === (start === 0);
        this.settlePane(commit ? 1 - start : start, commit ? resolved.navigate : undefined);
      },
      cancel: () => this.settlePane(start, undefined),
    };
  }

  /** Shows the incoming pane live and returns the starting progress. */
  private beginPaneMotion(direction: MobileSwipeDirection): number {
    const presentation = this.presentationElement!;
    const start = direction === 1 ? 0 : 1;
    this.presentation!.previewMobileSwipe();
    presentation.setAttribute("data-nox-pane-motion", "");
    presentation.style.setProperty("--nox-pane-progress", String(start));
    return start;
  }

  /** Animates to the target; navigation commits once the outgoing pane has left the screen. */
  private settlePane(target: number, navigate: (() => void) | undefined): void {
    const element = this.presentationElement!;
    const presentation = this.presentation!;
    element.removeAttribute("data-nox-pane-drag");
    element.style.setProperty("--nox-pane-progress", String(target));
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : Number.parseFloat(getComputedStyle(element).getPropertyValue("--motion-enter"));
    const finish = (): void => {
      clearTimeout(timer);
      this.paneMotion = undefined;
      if (navigate) navigate();
      else presentation.endMobileSwipePreview();
      // The destination now holds the same progress, so dropping the inline value doesn't move anything.
      element.removeAttribute("data-nox-pane-motion");
      element.style.removeProperty("--nox-pane-progress");
    };
    const timer = setTimeout(finish, duration);
    this.paneMotion = { finish };
  }

  private settlePaneMotion(): void {
    this.paneMotion?.finish();
  }

  private visibleFrame(frame: HTMLIFrameElement): boolean {
    return !this.sidebarOpen && frame.closest(".workspace-detail-resident.visible") !== null
      && frame.closest("[data-workspace-logically-visible='true']") !== null
      && !frame.closest("[inert]") && frame.getClientRects().length > 0;
  }

  private readonly receive = (event: MessageEvent): void => {
    if (!isMobileSwipeMessage(event.data) || event.origin === "null") return;
    const frame = [...this.element.querySelectorAll("iframe")].find(candidate => candidate.contentWindow === event.source);
    if (!frame || !this.visibleFrame(frame)) return;
    if (event.data.action === "ready") {
      this.frameOrigins.set(frame.contentWindow!, event.origin);
      frame.contentWindow!.postMessage({
        type: mobileSwipeMessage, action: "configure",
        previous: this.navigationFor(-1) !== undefined, next: this.navigationFor(1) !== undefined,
      }, event.origin);
    } else if (event.data.action === "navigate" && this.frameOrigins.get(frame.contentWindow!) === event.origin) {
      this.navigationFor(event.data.direction)?.();
    }
  };

  private readonly frameLoaded = (event: Event): void => {
    if (event.target instanceof HTMLIFrameElement) this.probe(event.target);
  };

  private probe(frame: HTMLIFrameElement): void {
    // No sensitive data: discover the actual origin after ingress redirects.
    frame.contentWindow?.postMessage({ type: mobileSwipeMessage, action: "probe" }, "*");
  }

  private readonly syncFrames = (): void => {
    this.element.querySelectorAll("iframe").forEach(frame => this.probe(frame));
  };
}
