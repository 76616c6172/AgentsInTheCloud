import { Application, Controller, defaultSchema } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection } from "@agents-in-the-cloud/shared/mobile-swipe";

/** Isolated Stimulus application: never register with or modify a preview's own app. */
class FrameSwipeController extends Controller<HTMLElement> {
  private parentOrigin?: string;
  private previous = false;
  private next = false;
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.navigationFor);
    window.addEventListener("message", this.receive);
    this.ready();
  }

  disconnect(): void {
    this.stopObserving!();
    window.removeEventListener("message", this.receive);
  }

  private readonly navigationFor = (direction: MobileSwipeDirection): (() => void) | undefined => {
    const parentOrigin = this.parentOrigin;
    if (!this.media.matches || parentOrigin === undefined
      || document.querySelector("dialog[open], :popover-open")
      || !(direction === -1 ? this.previous : this.next)) return;
    return () => window.parent.postMessage({ type: mobileSwipeMessage, action: "navigate", direction }, parentOrigin);
  };

  private ready(): void {
    window.parent.postMessage({ type: mobileSwipeMessage, action: "ready" }, this.parentOrigin ?? "*");
  }

  private readonly receive = (event: MessageEvent): void => {
    if (event.source !== window.parent || event.origin === "null" || !isMobileSwipeMessage(event.data)) return;
    if (event.data.action === "probe") {
      this.ready();
    } else if (event.data.action === "configure") {
      this.parentOrigin = event.origin;
      this.previous = event.data.previous;
      this.next = event.data.next;
    }
  };
}

if (window.parent !== window && !document.documentElement.hasAttribute("data-aic-swipe-controller")) {
  document.documentElement.setAttribute("data-aic-swipe-controller", "frame-swipe");
  const application = Application.start(document.documentElement, {
    ...defaultSchema,
    controllerAttribute: "data-aic-swipe-controller",
    actionAttribute: "data-aic-swipe-action",
    targetAttribute: "data-aic-swipe-target",
  });
  application.register("frame-swipe", FrameSwipeController);
}
