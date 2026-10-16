import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection } from "@agents-in-the-cloud/shared/mobile-swipe";
import { controllerForElement } from "./workspace-controller-registry.ts";

interface SwipePresentation {
  mobileSwipeDestination(direction: MobileSwipeDirection): string | undefined;
  navigateMobileSwipe(direction: MobileSwipeDirection): void;
}

export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  private lastNavigation = -Infinity;

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.canSwipe, this.navigate);
    window.addEventListener("message", this.receive);
    this.element.addEventListener("load", this.frameLoaded, true);
    this.element.addEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames);
    this.media.addEventListener("change", this.syncFrames);
    this.syncFrames();
  }

  disconnect(): void {
    this.stopObserving!();
    window.removeEventListener("message", this.receive);
    this.element.removeEventListener("load", this.frameLoaded, true);
    this.element.removeEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames);
    this.media.removeEventListener("change", this.syncFrames);
  }

  private get presentation(): SwipePresentation {
    return controllerForElement<SwipePresentation>(this.element, "workspace-presentation")!;
  }

  private readonly canSwipe = (direction: MobileSwipeDirection): boolean => {
    return this.media.matches && !this.element.closest("[inert]")
      && this.element.closest(".workspace-detail-resident.visible") !== null
      && !this.element.closest(".is-mobile-workspace-pane-open")
      && !document.querySelector("dialog[open], :popover-open, .workspace-ssh-trust-overlay")
      && this.presentation.mobileSwipeDestination(direction) !== undefined;
  };

  private readonly navigate = (direction: MobileSwipeDirection): void => {
    if (!this.canSwipe(direction) || performance.now() - this.lastNavigation < 350) return;
    this.lastNavigation = performance.now();
    this.presentation.navigateMobileSwipe(direction);
  };

  private visibleFrame(frame: HTMLIFrameElement): boolean {
    return frame.closest("[data-workspace-logically-visible='true']") !== null
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
        previous: this.canSwipe(-1), next: this.canSwipe(1),
      }, event.origin);
    } else if (event.data.action === "navigate" && this.frameOrigins.get(frame.contentWindow!) === event.origin) {
      this.navigate(event.data.direction);
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
