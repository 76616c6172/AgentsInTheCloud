import { Controller } from "@hotwired/stimulus";
import { slidePageChange } from "@agents-in-the-cloud/design-system/page-slide/client";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection } from "@agents-in-the-cloud/shared/mobile-swipe";
import { controllerForElement, workspaceNavigationController } from "./workspace-controller-registry.ts";

interface SwipePresentation {
  mobileSwipeNavigation(direction: MobileSwipeDirection): (() => void) | undefined;
}

export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  private lastNavigation = -Infinity;

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.navigationFor);
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

  private readonly navigationFor = (direction: MobileSwipeDirection): (() => void) | undefined => {
    const presentation = this.presentation;
    if (!this.media.matches || this.element.closest("[inert]") || !presentation
      || document.querySelector("dialog[open], :popover-open, .workspace-ssh-trust-overlay")) return;
    let navigate: (() => void) | undefined;
    if (this.sidebarOpen) {
      if (direction === 1) navigate = () => workspaceNavigationController()!.closeWorkspacePane();
    } else {
      navigate = presentation.mobileSwipeNavigation(direction);
      // The sidebar sits before the first content destination; never wrap at the end.
      if (!navigate && direction === -1) navigate = () => workspaceNavigationController()!.showWorkspacePane();
    }
    if (!navigate) return;
    const action = navigate;
    return () => {
      if (this.element.hasAttribute("data-mobile-swipe") || performance.now() - this.lastNavigation < 350) return;
      this.lastNavigation = performance.now();
      this.element.setAttribute("data-mobile-swipe", "");
      void slidePageChange(this.slideBody, () => {
        action();
        return this.slideBody();
      }, direction === 1 ? "forward" : "back")
        .finally(() => this.element.removeAttribute("data-mobile-swipe"));
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
