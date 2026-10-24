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
  /** The workspace list reveal, the Agent↔Work depth swap, or Work round the ring to the list. */
  motion: "drawer" | "pane" | "loop";
}

// A flick commits regardless of distance; a slow drag commits past halfway.
const flickVelocity = 0.3;
// Agents preview settles this far while Work's card lifts off it.
const loopNudge = 24;
const loopCardProperties = ["--nox-loop-left", "--nox-loop-top", "--nox-loop-width", "--nox-loop-height"];
const loopAppProperties = ["--nox-drawer-progress", "--nox-list-progress", "--nox-loop-nudge", "--nox-loop-progress"];

/** Where an element sits before any transform, in viewport coordinates. */
function layoutBox(element: HTMLElement) {
  let left = 0;
  let top = 0;
  // SAFETY: Offset parents of HTML elements are HTML elements.
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

export class MobileSwipeController extends Controller<HTMLElement> {
  private stopObserving?: () => void;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private readonly frameOrigins = new WeakMap<Window, string>();
  /** A pane or loop move still settling; it commits its navigation when the motion ends. */
  private motion?: { finish: () => void };
  /** Work's card while it travels round the ring, in the top layer. */
  private loop?: { presentation: HTMLElement; work: HTMLElement };

  connect(): void {
    this.stopObserving = observeMobileSwipe(this.element, this.navigationFor, this.dragFor);
    window.addEventListener("message", this.receive);
    this.element.addEventListener("click", this.tabTapped, true);
    this.element.addEventListener("load", this.frameLoaded, true);
    this.element.addEventListener("agents-in-the-cloud:presentation-changed", this.syncFrames, true);
    this.element.addEventListener("turbo:before-morph-attribute", this.keepLoopCard);
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
    this.element.removeEventListener("turbo:before-morph-attribute", this.keepLoopCard);
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
    if (!this.media.matches || !this.workspaceElement
      || document.querySelector("dialog[open], :popover-open, .workspace-ssh-trust-overlay")) return;
    const presentation = this.presentation;
    // The list, Agents and Work form a ring: Work → list → Agents → Work.
    if (this.sidebarOpen) {
      if (direction === 1) return { navigate: () => workspaceNavigationController()!.closeWorkspacePane(), motion: "drawer" };
      return presentation ? { navigate: () => presentation.selectMobileWork(), motion: "loop" } : undefined;
    }
    const navigate = presentation?.mobileSwipeNavigation(direction);
    if (navigate) return { navigate, motion: "pane" };
    if (direction === -1) return { navigate: () => workspaceNavigationController()!.showWorkspacePane(), motion: "drawer" };
    // Past Work, the list opens exactly as it does from Agents, with Agents beside it.
    const toAgents = presentation?.mobileSwipeNavigation(-1);
    return toAgents ? { navigate: () => { toAgents(); workspaceNavigationController()!.showWorkspacePane(); }, motion: "loop" } : undefined;
  }

  private readonly navigationFor = (direction: MobileSwipeDirection): (() => void) | undefined => {
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    if (resolved.motion === "drawer") return resolved.navigate;
    // Frames navigate in one step: play the same motion a drag would.
    return () => {
      this.settleMotion();
      const current = this.resolveNavigation(direction);
      if (!current || current.motion === "drawer") return current?.navigate();
      if (current.motion === "pane") this.playPaneMotion(direction, current.navigate);
      else this.playLoop(direction, current.navigate);
    };
  };

  /** The Workspaces tab after Work goes the same way round as the swipe. */
  loopToWorkspaces(): void {
    this.navigationFor(1)?.();
  }

  /** Tabs across the Agent/Work boundary play the depth swap; tabs within a side switch in place.
   * From the list, Agents is beside it and Work is round the loop, as their swipes go. */
  private readonly tabTapped = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest<HTMLElement>("[data-nox-phone-tab]");
    const presentation = this.presentation;
    // The Workspaces tabs open the list with their own actions.
    if (!tab || !presentation || !this.media.matches || tab.dataset.noxPhoneTab === "list") return;
    this.settleMotion();
    if (this.sidebarOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const agentId = tab.dataset.agentId;
      if (agentId) {
        presentation.selectAgentById(agentId);
        workspaceNavigationController()!.closeWorkspacePane();
      } else {
        presentation.prepareMobileTab(tab);
        this.playLoop(-1, () => presentation.selectMobileWork());
      }
      return;
    }
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
    this.settleMotion();
    const resolved = this.resolveNavigation(direction);
    if (!resolved) return;
    if (resolved.motion === "drawer") return this.drawerDrag(resolved);
    return resolved.motion === "pane" ? this.paneDrag(direction, resolved) : this.loopDrag(direction, resolved);
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
    const finish = (): void => {
      clearTimeout(timer);
      this.motion = undefined;
      if (navigate) navigate();
      else presentation.endMobileSwipePreview();
      // The destination now holds the same progress, so dropping the inline value doesn't move anything.
      element.removeAttribute("data-nox-pane-motion");
      element.style.removeProperty("--nox-pane-progress");
    };
    const timer = setTimeout(finish, this.motionDuration);
    this.motion = { finish };
  }

  private settleMotion(): void {
    this.motion?.finish();
  }

  private get motionDuration(): number {
    return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : Number.parseFloat(getComputedStyle(this.element).getPropertyValue("--motion-enter"));
  }

  /* The loop runs between Work (progress 0) and the list (1). Work's card lifts off to the left,
   * uncovering the list and the Agents preview already in place beneath it, so the list looks
   * exactly as it does after a reveal from Agents. Backwards, Work lays back down over them.
   * The bar stays put and turns its rail with --nox-loop-progress. */

  private loopDrag(direction: MobileSwipeDirection, resolved: SwipeNavigation): MobileSwipeDrag {
    const start = this.beginLoop(direction);
    const travel = this.element.clientWidth;
    let progress = start;
    return {
      move: (distance) => {
        progress = Math.min(1, Math.max(0, start - distance / travel));
        this.setLoopProgress(progress);
      },
      end: (_distance, velocity) => {
        const flick = Math.abs(velocity) >= flickVelocity;
        const towardList = flick ? velocity < 0 : progress > 0.5;
        const commit = towardList === (start === 0);
        this.settleLoop(commit ? 1 - start : start, commit ? resolved.navigate : undefined);
      },
      cancel: () => this.settleLoop(start, undefined),
    };
  }

  private playLoop(direction: MobileSwipeDirection, navigate: () => void): void {
    const start = this.beginLoop(direction);
    // Apply the starting position before moving, so the transition has somewhere to start from.
    void this.element.offsetWidth;
    this.settleLoop(1 - start, navigate);
  }

  /** Lifts Work's card into the top layer, out of the workspace's transform, and returns the starting progress. */
  private beginLoop(direction: MobileSwipeDirection): number {
    const app = this.element;
    const presentation = this.presentationElement!;
    const start = direction === 1 ? 0 : 1;
    const work = presentation.querySelector<HTMLElement>(".fixed-shell-work-pane")!;
    // The card moves about the centre of its right edge.
    const box = layoutBox(work);
    work.style.setProperty("--nox-loop-left", `${box.left}px`);
    work.style.setProperty("--nox-loop-top", `${box.top}px`);
    work.style.setProperty("--nox-loop-width", `${box.width}px`);
    work.style.setProperty("--nox-loop-height", `${box.height}px`);
    work.setAttribute("data-nox-loop-card", "");
    // Beneath the card the workspace shows Agents, already stepped aside beside the list.
    this.presentation!.previewMobileSwipe();
    presentation.setAttribute("data-nox-pane-motion", "");
    presentation.style.setProperty("--nox-pane-progress", "0");
    app.setAttribute("data-nox-drawer-drag", "");
    app.setAttribute("data-nox-drawer-loop", "");
    app.style.setProperty("--nox-drawer-progress", "1");
    this.setLoopProgress(start);
    work.setAttribute("popover", "manual");
    work.showPopover();
    this.loop = { presentation, work };
    return start;
  }

  private setLoopProgress(progress: number): void {
    const style = this.element.style;
    style.setProperty("--nox-loop-progress", String(progress));
    // The list fades up and Agents settles its last few pixels as Work uncovers them.
    style.setProperty("--nox-list-progress", String(progress));
    style.setProperty("--nox-loop-nudge", `${(1 - progress) * loopNudge}px`);
  }

  private settleLoop(target: number, navigate: (() => void) | undefined): void {
    this.element.removeAttribute("data-nox-drawer-drag");
    this.setLoopProgress(target);
    const finish = (): void => {
      clearTimeout(timer);
      this.motion = undefined;
      this.endLoop(navigate);
    };
    const timer = setTimeout(finish, this.motionDuration);
    this.motion = { finish };
  }

  /** Lands without transitions: where the card settles, the workspace now looks the same. */
  private endLoop(navigate: (() => void) | undefined): void {
    const app = this.element;
    const { presentation, work } = this.loop!;
    this.loop = undefined;
    app.setAttribute("data-nox-drawer-drag", "");
    work.hidePopover();
    work.removeAttribute("popover");
    work.removeAttribute("data-nox-loop-card");
    for (const name of loopCardProperties) work.style.removeProperty(name);
    presentation.removeAttribute("data-nox-pane-motion");
    presentation.style.removeProperty("--nox-pane-progress");
    if (navigate) navigate();
    else this.presentation!.endMobileSwipePreview();
    for (const name of loopAppProperties) app.style.removeProperty(name);
    app.removeAttribute("data-nox-drawer-loop");
    void app.offsetWidth;
    app.removeAttribute("data-nox-drawer-drag");
  }

  /** Server morphs leave Work's card in the top layer until the loop lands. */
  private readonly keepLoopCard = (event: Event): void => {
    // SAFETY: Turbo emits this event with its attribute mutation descriptor.
    const detail = (event as CustomEvent<{ attributeName: string }>).detail;
    if (event.target === this.loop?.work && ["popover", "data-nox-loop-card", "style"].includes(detail.attributeName)) event.preventDefault();
  };

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
