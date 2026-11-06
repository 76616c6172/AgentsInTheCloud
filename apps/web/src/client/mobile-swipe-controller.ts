import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { isMobileSwipeMessage, mobileSwipeMessage, observeMobileSwipe, type MobileSwipeDirection, type MobileSwipeDrag } from "@agents-in-the-cloud/shared/mobile-swipe";
import { controllerForElement, workspaceNavigationController } from "./workspace-controller-registry.ts";
import { noxSpreadMediaQuery } from "./nox-spread.ts";

interface SwipePresentation {
  mobileSwipeNavigation(direction: MobileSwipeDirection): (() => void) | undefined;
  previewMobileSwipe(): void;
  endMobileSwipePreview(): void;
}

interface SwipeNavigation {
  navigate: () => void;
  /** The workspace list drawer, the Agent↔Work slide, or a step between the spread's stops. */
  motion: "drawer" | "pane" | "spread";
  /** Past the spread's end, a swipe only gives a little; claiming it keeps the browser from going back. */
  stay?: true;
}

// A flick commits regardless of distance; a slow drag commits past halfway.
const flickVelocity = 0.3;
// Past the spread's end the pages give at most this far.
const spreadGive = 40;
// A release carries the finger's speed: an ease-out cubic starts at three times its average speed,
// so the settle lasts three times what the remaining distance takes at the finger's speed.
const carriedEase = "cubic-bezier(0.33, 1, 0.68, 1)";
const carriedDuration = { min: 110, max: 280 };
// Slower than this, a release has nothing to carry and settles at the usual pace.
const carriedSpeed = 0.15;

/**
 * Nox phone navigation (Amp-like). The workspace list is a drawer: the list and the whole
 * workspace, header included, slide together at full size (nox-layout.css). Agent and Work sit
 * side by side and slide like pages. In the spread (nox-spread.ts) Agent | Work are both on
 * screen and a swipe on shows Work alone. Drags follow the finger; letting go carries the
 * finger's speed into the settle. Tabs switch instantly, without motion.
 */
export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly spreadMedia = matchMedia(noxSpreadMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  /** A pane or spread move still settling; it commits its navigation when the motion ends. */
  private motion?: { finish: () => void };
  private settleTimer?: ReturnType<typeof setTimeout>;

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

  /** Sidebar navigation is available during preparation and deletion, not just in Agent/Work views. */
  private get workspaceElement(): HTMLElement | null {
    const element = this.element.querySelector<HTMLElement>(".workspace-detail-mount.visible > :is(.workspace-boot, .fixed-workspace-presentation)");
    return element && !element.closest("[inert]") ? element : null;
  }

  private get presentationElement(): HTMLElement | null {
    const element = this.element.querySelector<HTMLElement>(".workspace-detail-mount.visible [data-controller~=workspace-presentation]");
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
    // The overlay scrollbars are popovers too, shown while touch scrolling; they don't hold swipes.
    if (!this.media.matches || !this.workspaceElement
      || document.querySelector("dialog[open], :popover-open:not(.scrollbar), .workspace-ssh-trust-overlay")) return;
    const navigation = workspaceNavigationController()!;
    if (this.sidebarOpen) return direction === 1 ? { navigate: () => navigation.closeWorkspacePane(), motion: "drawer" } : undefined;
    if (this.spreadMedia.matches) return this.resolveSpreadNavigation(direction);
    const navigate = this.presentation?.mobileSwipeNavigation(direction);
    if (navigate) return { navigate, motion: "pane" };
    if (direction === -1) return { navigate: () => navigation.showWorkspacePane(), motion: "drawer" };
  }

  /* The spread's stops run Agent | Work → Work on its own (nox-spread.ts); the list opens over
   * Agent | Work as it does on a phone. */
  private resolveSpreadNavigation(direction: MobileSwipeDirection): SwipeNavigation | undefined {
    // A touch on the split handle is resizing the pages.
    if (this.element.hasAttribute("data-nox-spread-resize")) return;
    const navigate = this.presentation?.mobileSwipeNavigation(direction);
    if (navigate) return { navigate, motion: "spread" };
    if (direction === -1 && !this.presentationElement?.hasAttribute("data-nox-work-alone")) return { navigate: () => workspaceNavigationController()!.showWorkspacePane(), motion: "drawer" };
    return { navigate: () => {}, motion: "spread", stay: true };
  }

  private readonly navigationFor = (direction: MobileSwipeDirection): (() => void) | undefined => {
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    // The drawer and the spread's pages transition by themselves when their state changes.
    if (resolved.motion !== "pane") return resolved.navigate;
    // Frames navigate in one step: play the same motion a drag would.
    return () => {
      this.settleMotion();
      const current = this.resolveNavigation(direction);
      if (!current || current.motion !== "pane") return current?.navigate();
      const start = this.beginPaneMotion(direction);
      // Apply the starting position before moving, so the transition has somewhere to start from.
      void this.presentationElement!.offsetWidth;
      this.settlePane(1 - start, current.navigate, this.carry(0, 0));
    };
  };

  /** Swipes in this document follow the finger; frames still navigate in one step. */
  private readonly dragFor = (direction: MobileSwipeDirection): MobileSwipeDrag | undefined => {
    this.settleMotion();
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    // A claimed swipe consumes later move events; abandon any pending row hold first.
    document.dispatchEvent(new Event("agents-in-the-cloud:mobile-swipe-start"));
    if (resolved.motion === "drawer") return this.drawerDrag(resolved);
    if (resolved.motion === "spread") return this.spreadDrag(direction, resolved);
    return this.paneDrag(direction, resolved);
  };

  /**
   * Sets how the next settle moves: carrying the finger's speed (px/ms toward where it lands) over
   * the remaining distance, or at the usual pace when there's no speed to carry. Returns its length.
   */
  private carry(remaining: number, speed: number): number {
    clearTimeout(this.settleTimer);
    const style = this.element.style;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
    if (speed < carriedSpeed || remaining < 1) {
      style.removeProperty("--nox-settle");
      style.removeProperty("--nox-settle-ease");
      return Number.parseFloat(getComputedStyle(this.element).getPropertyValue("--motion-enter"));
    }
    const duration = Math.round(Math.min(carriedDuration.max, Math.max(carriedDuration.min, 3 * remaining / speed)));
    style.setProperty("--nox-settle", `${duration}ms`);
    style.setProperty("--nox-settle-ease", carriedEase);
    this.settleTimer = setTimeout(() => {
      style.removeProperty("--nox-settle");
      style.removeProperty("--nox-settle-ease");
    }, duration);
    return duration;
  }

  /* The finger moves --nox-spread from one stop towards the next, over the agent page's width.
   * While the pages settle, [data-nox-spread-motion] holds them; the stop changes on landing. */
  private spreadDrag(direction: MobileSwipeDirection, resolved: SwipeNavigation): MobileSwipeDrag {
    const app = this.element;
    app.setAttribute("data-nox-spread-motion", "");
    app.setAttribute("data-nox-spread-drag", "");
    if (resolved.stay) {
      const give = (distance: number) => app.style.setProperty("--nox-spread-give", `${Math.max(-spreadGive, Math.min(spreadGive, distance * 0.25))}px`);
      return { move: give, end: () => this.settleSpread(undefined, undefined, this.carry(0, 0)), cancel: () => this.settleSpread(undefined, undefined, this.carry(0, 0)) };
    }
    const presentation = this.presentationElement!;
    const start = presentation.hasAttribute("data-nox-work-alone") ? 2 : 1;
    const travel = presentation.querySelector<HTMLElement>(".fixed-shell-agent-pane")!.offsetWidth;
    this.presentation!.previewMobileSwipe();
    app.style.setProperty("--nox-spread", String(start));
    let progress = 0;
    return {
      move: (distance) => {
        progress = Math.min(1, Math.max(0, -direction * distance / travel));
        app.style.setProperty("--nox-spread", String(start + direction * progress));
      },
      end: (_distance, velocity) => {
        const flick = Math.abs(velocity) >= flickVelocity;
        const commit = flick ? Math.sign(velocity) === -direction : progress > 0.5;
        const speed = commit ? -direction * velocity : direction * velocity;
        const duration = this.carry((commit ? 1 - progress : progress) * travel, speed);
        this.settleSpread(commit ? start + direction : start, commit ? resolved.navigate : undefined, duration);
      },
      cancel: () => this.settleSpread(start, undefined, this.carry(0, 0)),
    };
  }

  /** Without a target the pages only spring back from the give past the end. */
  private settleSpread(target: number | undefined, navigate: (() => void) | undefined, duration: number): void {
    const app = this.element;
    app.removeAttribute("data-nox-spread-drag");
    app.style.removeProperty("--nox-spread-give");
    if (target !== undefined) app.style.setProperty("--nox-spread", String(target));
    const finish = (): void => {
      clearTimeout(timer);
      this.motion = undefined;
      if (navigate) navigate();
      else if (target !== undefined) this.presentation?.endMobileSwipePreview();
      // The new stop holds the same --nox-spread, so dropping the inline value doesn't move anything.
      app.style.removeProperty("--nox-spread");
      app.removeAttribute("data-nox-spread-motion");
    };
    const timer = setTimeout(finish, duration);
    this.motion = { finish };
  }

  /** The list's open state is its class; the finger sets --nox-drawer-progress until it lets go. */
  private drawerDrag(resolved: SwipeNavigation): MobileSwipeDrag {
    const opening = !this.sidebarOpen;
    const travel = this.element.querySelector<HTMLElement>(":scope > .fixed-shell-workspace-pane")!.offsetWidth;
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
        const open = flick ? velocity > 0 : progress > 0.5;
        this.carry(Math.abs((open ? 1 : 0) - progress) * travel, open ? velocity : -velocity);
        release();
        if (open === opening) resolved.navigate();
      },
      cancel: () => {
        this.carry(0, 0);
        release();
      },
    };
  }

  /** Agent is progress 0 and Work is 1; both panes stay visible while they slide. */
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
        const target = (flick ? velocity < 0 : progress > 0.5) ? 1 : 0;
        const duration = this.carry(Math.abs(target - progress) * travel, target === 1 ? -velocity : velocity);
        this.settlePane(target, target !== start ? resolved.navigate : undefined, duration);
      },
      cancel: () => this.settlePane(start, undefined, this.carry(0, 0)),
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
  private settlePane(target: number, navigate: (() => void) | undefined, duration: number): void {
    const element = this.presentationElement!;
    const presentation = this.presentation!;
    element.removeAttribute("data-nox-pane-drag");
    element.style.setProperty("--nox-pane-progress", String(target));
    const finish = (): void => {
      clearTimeout(timer);
      this.motion = undefined;
      if (navigate) navigate();
      else presentation.endMobileSwipePreview();
      // The destination now holds the same progress, so dropping the inline value doesn't move anything.
      element.removeAttribute("data-nox-pane-motion");
      element.style.removeProperty("--nox-pane-progress");
    };
    const timer = setTimeout(finish, duration);
    this.motion = { finish };
  }

  private settleMotion(): void {
    this.motion?.finish();
  }

  private visibleFrame(frame: HTMLIFrameElement): boolean {
    return !this.sidebarOpen && frame.closest(".workspace-detail-mount.visible") !== null
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
