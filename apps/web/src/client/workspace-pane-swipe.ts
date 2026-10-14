import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";
import { Controller } from "@hotwired/stimulus";
import { registerWorkspaceControllers } from "./workspace-controller-registry.ts";

type Pane = "workspace" | "agent" | "work";

interface PointerGesture {
  pointerId: number;
  target: Element;
  pane: Pane;
  startX: number;
  startY: number;
  claimed: boolean;
}

interface WheelGesture {
  target: Element;
  pane: Pane;
  deltaX: number;
  deltaY: number;
  consumed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

class WorkspacePaneSwipeController extends Controller<HTMLElement> {
  private pointerGesture?: PointerGesture;
  private wheelGesture?: WheelGesture;
  private suppressClickTarget?: Element;
  private suppressClickTimer?: ReturnType<typeof setTimeout>;

  connect(): void {
    this.element.addEventListener("wheel", this.wheel, { capture: true, passive: false });
    this.element.addEventListener("pointerdown", this.pointerDown, true);
    this.element.addEventListener("pointermove", this.pointerMove, true);
    this.element.addEventListener("pointerup", this.pointerUp, true);
    this.element.addEventListener("pointercancel", this.pointerCancel, true);
    this.element.addEventListener("click", this.suppressSwipeClick, true);
  }

  disconnect(): void {
    this.element.removeEventListener("wheel", this.wheel, true);
    this.element.removeEventListener("pointerdown", this.pointerDown, true);
    this.element.removeEventListener("pointermove", this.pointerMove, true);
    this.element.removeEventListener("pointerup", this.pointerUp, true);
    this.element.removeEventListener("pointercancel", this.pointerCancel, true);
    this.element.removeEventListener("click", this.suppressSwipeClick, true);
    this.clearWheelGesture();
    if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
  }

  private readonly wheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.clientX < 24 || window.innerWidth - event.clientX < 24) return;
    const target = this.eventElement(event.target);
    if (!target || this.blockedTarget(target) || this.hasHorizontalScroller(target)) return;
    const pane = this.paneAt(target);
    if (!pane) return;

    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.element.clientWidth
        : 1;
    const deltaX = event.deltaX * scale;
    const deltaY = event.deltaY * scale;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.25 || deltaX === 0) {
      this.clearWheelGesture();
      return;
    }

    if (!this.wheelGesture || this.wheelGesture.target !== target || this.wheelGesture.pane !== pane) {
      this.clearWheelGesture();
      this.wheelGesture = {
        target,
        pane,
        deltaX: 0,
        deltaY: 0,
        consumed: false,
        timer: setTimeout(() => this.clearWheelGesture(), 240),
      };
    } else {
      clearTimeout(this.wheelGesture.timer);
      this.wheelGesture.timer = setTimeout(() => this.clearWheelGesture(), 240);
    }

    const gesture = this.wheelGesture;
    if (gesture.consumed) return;
    gesture.deltaX += deltaX;
    gesture.deltaY += deltaY;
    if (Math.abs(gesture.deltaX) < 64 || Math.abs(gesture.deltaX) < Math.abs(gesture.deltaY) * 1.4) return;
    // Wheel deltaX is the content's scroll direction: positive means a leftward
    // pane-navigation gesture, matching a finger swipe to the left.
    const moved = this.navigateFrom(pane, gesture.deltaX > 0 ? 1 : -1);
    if (!moved) return;
    event.preventDefault();
    gesture.consumed = true;
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    if (!event.isPrimary) {
      this.pointerGesture = undefined;
      return;
    }
    if (this.pointerGesture) return;
    const target = this.eventElement(event.target);
    if (!target || this.blockedTarget(target) || this.hasHorizontalScroller(target)) return;
    if (event.clientX < 24 || window.innerWidth - event.clientX < 24) return;
    const pane = this.paneAt(target);
    if (!pane) return;
    this.pointerGesture = { pointerId: event.pointerId, target, pane, startX: event.clientX, startY: event.clientY, claimed: false };
    this.element.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.claimed && Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      gesture.claimed = true;
      event.preventDefault();
    } else if (gesture.claimed) {
      event.preventDefault();
    }
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.pointerGesture = undefined;
    if (!gesture.claimed) return;
    event.preventDefault();
    this.suppressClickTarget = gesture.target;
    if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = setTimeout(() => { this.suppressClickTarget = undefined; }, 500);
    this.navigateFrom(gesture.pane, event.clientX < gesture.startX ? 1 : -1);
  };

  private readonly pointerCancel = (event: PointerEvent): void => {
    if (this.pointerGesture?.pointerId === event.pointerId) this.pointerGesture = undefined;
  };

  private readonly suppressSwipeClick = (event: MouseEvent): void => {
    const target = this.suppressClickTarget;
    if (!target || !(event.target instanceof Node) || event.target !== this.element && !target.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressClickTarget = undefined;
    if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = undefined;
  };

  private navigateFrom(source: Pane, direction: -1 | 1): boolean {
    const panes: Pane[] = ["workspace", "agent", "work"];
    const target = panes[panes.indexOf(source) + direction];
    if (!target) return false;
    if (window.matchMedia(phoneLayoutMediaQuery).matches) return this.navigatePhone(target);
    return this.navigateDesktop(target);
  }

  private navigatePhone(target: Pane): boolean {
    const app = this.element;
    if (target === "workspace") {
      if (app.classList.contains("is-mobile-workspace-pane-open")) return false;
      const button = app.querySelector<HTMLButtonElement>(".fixed-shell-workspace-bar [data-show-workspace-list]");
      if (!button) return false;
      button.click();
      requestAnimationFrame(() => this.focusWorkspaceList());
      return true;
    }

    const presentation = app.querySelector<HTMLElement>(".workspace-detail-resident.visible .fixed-workspace-presentation");
    if (!presentation) return false;
    if (target === "agent") {
      const button = presentation.querySelector<HTMLButtonElement>('[data-mobile-destination="agents"]');
      if (!button || presentation.dataset.phoneDestination === "agents" && !app.classList.contains("is-mobile-workspace-pane-open")) return false;
      button.click();
      return true;
    }

    const buttons = [...presentation.querySelectorAll<HTMLButtonElement>('[data-mobile-destination^="work:"]')];
    const button = buttons.find((candidate) => candidate.getAttribute("aria-current") === "page") ?? buttons[0];
    if (!button || button.getAttribute("aria-current") === "page" && !app.classList.contains("is-mobile-workspace-pane-open")) return false;
    button.click();
    return true;
  }

  private navigateDesktop(target: Pane): boolean {
    const app = this.element;
    const presentation = app.querySelector<HTMLElement>(".workspace-detail-resident.visible .fixed-workspace-presentation");
    if (!presentation) return false;

    if (target === "workspace") {
      if (app.classList.contains("is-workspace-pane-collapsed")) {
        const button = presentation.querySelector<HTMLButtonElement>("[data-show-workspace-pane]");
        if (!button) return false;
        button.click();
      }
      requestAnimationFrame(() => this.focusWorkspaceList());
      return true;
    }

    if (target === "work" && !presentation.classList.contains("is-work-pane-open")) {
      const button = presentation.querySelector<HTMLButtonElement>("[data-show-work-pane]");
      if (!button) return false;
      button.click();
    }

    requestAnimationFrame(() => {
      const selector = target === "agent"
        ? ".fixed-shell-agent-pane [data-workspace-pane-role='agent'].is-active"
        : ".fixed-shell-work-pane [data-workspace-pane-role='work'].is-active";
      presentation.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
    return true;
  }

  private focusWorkspaceList(): void {
    const activeWorkspace = this.element.querySelector<HTMLElement>(".fixed-shell-workspace-scroll [aria-current='page']")
      ?? this.element.querySelector<HTMLElement>(".fixed-shell-workspace-scroll [data-workspace-entry-id]")
      ?? this.element.querySelector<HTMLElement>("#fixed_shell_new_workspace button");
    activeWorkspace?.focus({ preventScroll: true });
  }

  private paneAt(target: Element): Pane | undefined {
    if (window.matchMedia(phoneLayoutMediaQuery).matches) {
      if (this.element.classList.contains("is-mobile-workspace-pane-open")) return "workspace";
      if (target.closest(".fixed-shell-mobile-nav")) {
        const destination = this.element.querySelector<HTMLElement>(".workspace-detail-resident.visible .fixed-workspace-presentation")?.dataset.phoneDestination;
        return destination?.startsWith("work:") ? "work" : destination === "agents" ? "agent" : undefined;
      }
    }
    if (target.closest(".fixed-shell-workspace-pane")) return "workspace";
    if (target.closest(".fixed-shell-agent-pane")) return "agent";
    if (target.closest(".fixed-shell-work-pane")) return "work";
    return undefined;
  }

  private blockedTarget(target: Element): boolean {
    return Boolean(target.closest("iframe, input, textarea, select, [contenteditable]:not([contenteditable='false']), .observable-terminal-host, [data-terminal-key], dialog[open], [popover]"));
  }

  private hasHorizontalScroller(target: Element): boolean {
    let current: Element | null = target;
    while (current && current !== this.element) {
      const overflowX = getComputedStyle(current).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && current.scrollWidth > current.clientWidth + 1) return true;
      current = current.parentElement;
    }
    return false;
  }

  private eventElement(target: EventTarget | null): Element | undefined {
    if (target instanceof Element) return target;
    return target instanceof Node ? target.parentElement ?? undefined : undefined;
  }

  private clearWheelGesture(): void {
    if (!this.wheelGesture) return;
    clearTimeout(this.wheelGesture.timer);
    this.wheelGesture = undefined;
  }
}

export function registerWorkspacePaneSwipeController(): void {
  registerWorkspaceControllers({ "workspace-pane-swipe": WorkspacePaneSwipeController });
}
