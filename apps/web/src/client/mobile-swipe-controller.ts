import { Controller } from "@hotwired/stimulus";
import { slidePageChange } from "@agents-in-the-cloud/design-system/page-slide/client";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection, type MobileSwipeDrag } from "@agents-in-the-cloud/shared/mobile-swipe";
import { controllerForElement, workspaceNavigationController } from "./workspace-controller-registry.ts";

interface SwipePresentation {
  mobileSwipeNavigation(direction: MobileSwipeDirection): (() => void) | undefined;
}

interface SwipeNavigation {
  navigate: () => void;
  /** The workspace drawer moves itself; content panes slide with Page slide. */
  drawer: boolean;
}

// A flick commits regardless of distance; a slow drag commits past halfway.
const drawerFlickVelocity = 0.3;

export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  private navigationVersion = 0;

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.navigationFor, this.dragFor);
    window.addEventListener("message", this.receive);
    this.element.addEventListener("load", this.frameLoaded, true);
    this.element.addEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames, true);
    document.addEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncFrames);
    this.media.addEventListener("change", this.syncFrames);
    this.syncFrames();
  }

  disconnect(): void {
    this.stopObserving!();
    window.removeEventListener("message", this.receive);
    this.element.removeEventListener("load", this.frameLoaded, true);
    this.element.removeEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames, true);
    document.removeEventListener("agents-in-the-cloud:mobile-workspace-pane-changed", this.syncFrames);
    this.media.removeEventListener("change", this.syncFrames);
  }

  private get presentation(): SwipePresentation | null {
    const element = this.element.querySelector(".workspace-detail-resident.visible [data-controller~=workspace-presentation]");
    return element && !element.closest("[inert]") ? controllerForElement<SwipePresentation>(element, "workspace-presentation") : null;
  }

  private get sidebarOpen(): boolean {
    return this.element.classList.contains("is-mobile-workspace-pane-open");
  }

  // Snapshot only the content region; each destination keeps its bottom bar live.
  private readonly slideBody = (): HTMLElement => this.element.querySelector<HTMLElement>(this.sidebarOpen
    ? ":scope > .fixed-shell-workspace-pane"
    : ".workspace-detail-resident.visible .fixed-shell-main")!;

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
    return () => {
      const version = ++this.navigationVersion;
      this.element.setAttribute("data-mobile-swipe", "");
      void slidePageChange(this.slideBody, () => {
        // An interrupted slide commits first; resolve against that current pane.
        this.resolveNavigation(direction)?.navigate();
        return this.slideBody();
      }, direction === 1 ? "forward" : "back").finally(() => {
        // Only the latest slide owns the temporary styling.
        if (this.navigationVersion === version) this.element.removeAttribute("data-mobile-swipe");
      });
    };
  };

  /** Swipes in this document move the drawer with the finger; frames still navigate in one step. */
  private readonly dragFor = (direction: MobileSwipeDirection): MobileSwipeDrag | undefined => {
    const resolved = this.resolveNavigation(direction);
    if (!resolved?.drawer) return;
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
        const flick = Math.abs(velocity) >= drawerFlickVelocity;
        const commit = opening ? (flick ? velocity > 0 : progress > 0.5) : (flick ? velocity < 0 : progress < 0.5);
        release();
        if (commit) resolved.navigate();
      },
      cancel: release,
    };
  };

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
