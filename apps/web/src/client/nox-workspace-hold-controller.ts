import { Controller } from "@hotwired/stimulus";
import { phoneLayoutMediaQuery } from "@agents-in-the-cloud/shared";

const settleMs = 50;
const chargeMs = 250;
const movementSlop = 10;

export class NoxWorkspaceHoldController extends Controller<HTMLElement> {
  static targets = ["launch"];
  declare readonly launchTarget: HTMLAnchorElement;
  private readonly media = matchMedia(phoneLayoutMediaQuery);
  private gesture?: { id: number; x: number; y: number; started: number };
  private frame = 0;
  private suppressClick = false;

  connect(): void {
    this.element.addEventListener("click", this.clicked, true);
    this.media.addEventListener("change", this.cancel);
  }

  disconnect(): void {
    this.cancel();
    this.element.removeEventListener("click", this.clicked, true);
    this.media.removeEventListener("change", this.cancel);
  }

  start(event: PointerEvent): void {
    if (!this.media.matches || event.button !== 0 || !event.isPrimary) return;
    if (this.element.hasAttribute("data-nox-renaming") || (event.target instanceof Element && event.target.closest("[data-nox-rename-form]"))) return;
    this.cancel();
    this.suppressClick = false;
    this.element.classList.remove("nox-hold-released");
    this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
    this.element.style.setProperty("--nox-hold-color", getComputedStyle(this.element.querySelector<HTMLElement>(".nox-workspace-glyph")!).color);
    this.element.classList.add("nox-hold-charging");
    window.addEventListener("pointerdown", this.anotherPointer, true);
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerup", this.finish, true);
    window.addEventListener("pointercancel", this.cancel, true);
    document.addEventListener("scroll", this.cancel, true);
    this.frame = requestAnimationFrame(this.advance);
  }

  contextMenu(event: Event): void {
    if (!this.media.matches) return;
    event.preventDefault();
  }

  readonly cancel = (): void => {
    if (this.gesture) this.suppressClick = true;
    this.gesture = undefined;
    cancelAnimationFrame(this.frame);
    this.element.classList.remove("nox-hold-charging");
    this.element.style.removeProperty("--nox-hold");
    window.removeEventListener("pointerdown", this.anotherPointer, true);
    window.removeEventListener("pointermove", this.move, true);
    window.removeEventListener("pointerup", this.finish, true);
    window.removeEventListener("pointercancel", this.cancel, true);
    document.removeEventListener("scroll", this.cancel, true);
  };

  private readonly anotherPointer = (): void => { this.cancel(); };

  private readonly move = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture && event.pointerId === gesture.id && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > movementSlop) this.cancel();
  };

  private readonly finish = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.id) return;
    const tapped = performance.now() - gesture.started < 180;
    this.cancel();
    this.suppressClick = !tapped;
  };

  private readonly advance = (now: number): void => {
    const gesture = this.gesture;
    if (!gesture) return;
    const progress = Math.max(0, Math.min(1, (now - gesture.started - settleMs) / chargeMs));
    this.element.style.setProperty("--nox-hold", String(progress));
    if (progress < 1) {
      this.frame = requestAnimationFrame(this.advance);
      return;
    }
    this.cancel();
    this.element.classList.add("nox-hold-released");
    this.launchTarget.click();
  };

  private readonly clicked = (event: MouseEvent): void => {
    if (!this.suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
