import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export type MobileSwipeDirection = -1 | 1;

const swipeIntentDistance = 8;
const swipeNavigationDistance = 16;
const swipeAxisBias = 1.25;
// Flick speed is measured over the latest movement only; lifting after a longer pause is a release.
const flickWindow = 100;

/** A claimed swipe that follows the finger instead of navigating at a threshold. */
export interface MobileSwipeDrag {
  /** Signed horizontal distance from where the touch started, in CSS pixels. */
  move(distance: number): void;
  /** Velocity is the latest horizontal speed in CSS pixels per millisecond. */
  end(distance: number, velocity: number): void;
  cancel(): void;
}

/** Shared recognizer; its owning Stimulus controller supplies visibility and navigation. */
export function observeMobileSwipe(
  root: HTMLElement,
  navigationFor: (direction: MobileSwipeDirection) => (() => void) | undefined,
  dragFor?: (direction: MobileSwipeDirection) => MobileSwipeDrag | undefined,
): () => void {
  const view = root.ownerDocument.defaultView!;
  let gesture: { id: number; x: number; y: number; claimed: boolean; navigated: boolean; drag?: MobileSwipeDrag; samples: { x: number; t: number }[] } | undefined;
  let suppressClickUntil = 0;
  const cancel = (): void => {
    gesture?.drag?.cancel();
    gesture = undefined;
  };
  const start = (event: TouchEvent): void => {
    cancel();
    if (event.touches.length !== 1 || !(event.target instanceof Node) || !root.contains(event.target)) return;
    // A fresh tap is not the compatibility click from the previous swipe.
    suppressClickUntil = 0;
    if (!navigationFor(-1) && !navigationFor(1)) return;
    const touch = event.touches[0]!;
    gesture = { id: touch.identifier, x: touch.screenX, y: touch.screenY, claimed: false, navigated: false, samples: [{ x: touch.screenX, t: event.timeStamp }] };
  };
  const advance = (event: TouchEvent, touch: Touch | undefined): void => {
    const current = gesture;
    if (!current || touch?.identifier !== current.id) { cancel(); return; }
    const dx = touch.screenX - current.x;
    const horizontal = Math.abs(dx);
    const vertical = Math.abs(touch.screenY - current.y);
    if (!current.claimed) {
      if (Math.max(horizontal, vertical) < swipeIntentDistance) return;
      // Yield definite vertical intent; let an ambiguous diagonal settle.
      if (vertical > horizontal * swipeAxisBias) { cancel(); return; }
      if (horizontal <= vertical * swipeAxisBias) return;
      if (!navigationFor(dx < 0 ? 1 : -1) || !event.cancelable) { cancel(); return; }
      current.claimed = true;
      current.drag = dragFor?.(dx < 0 ? 1 : -1);
    }
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = Date.now() + 400;
    // Only movement counts: touchend usually repeats the last position.
    const last = current.samples.at(-1)!;
    if (touch.screenX !== last.x && event.timeStamp > last.t) {
      current.samples.push({ x: touch.screenX, t: event.timeStamp });
      while (current.samples.length > 2 && event.timeStamp - current.samples[0]!.t > flickWindow) current.samples.shift();
    }
    if (current.drag) {
      current.drag.move(dx);
      return;
    }
    if (!current.navigated && horizontal >= swipeNavigationDistance && horizontal > vertical * swipeAxisBias) {
      const navigate = navigationFor(dx < 0 ? 1 : -1);
      if (navigate) {
        // One touch sequence moves one pane, even if the finger keeps moving.
        current.navigated = true;
        navigate();
      }
    }
  };
  const move = (event: TouchEvent): void => {
    if (event.touches.length !== 1) { cancel(); return; }
    advance(event, event.touches[0]);
  };
  const finish = (event: TouchEvent): void => {
    // A quick flick's last movement can arrive with touchend instead of touchmove.
    if (event.touches.length === 0) advance(event, event.changedTouches[0]);
    const drag = event.touches.length === 0 ? gesture?.drag : undefined;
    if (drag) {
      const current = gesture!;
      gesture = undefined;
      const [first, last] = [current.samples[0]!, current.samples.at(-1)!];
      const velocity = event.timeStamp - last.t > flickWindow || last.t === first.t ? 0 : (last.x - first.x) / (last.t - first.t);
      drag.end(event.changedTouches[0]!.screenX - current.x, velocity);
      return;
    }
    cancel();
  };
  const click = (event: MouseEvent): void => {
    if (Date.now() >= suppressClickUntil || !(event.target instanceof Node) || !root.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && gesture?.claimed) event.stopImmediatePropagation();
  };
  view.addEventListener("touchstart", start, { capture: true, passive: true });
  view.addEventListener("touchmove", move, { capture: true, passive: false });
  view.addEventListener("touchend", finish, { capture: true, passive: false });
  view.addEventListener("touchcancel", cancel, true);
  view.addEventListener("contextmenu", cancel, true);
  view.addEventListener("selectstart", cancel, true);
  view.addEventListener("pointermove", pointerMove, true);
  view.addEventListener("click", click, true);
  return () => {
    view.removeEventListener("touchstart", start, true);
    view.removeEventListener("touchmove", move, true);
    view.removeEventListener("touchend", finish, true);
    view.removeEventListener("touchcancel", cancel, true);
    view.removeEventListener("contextmenu", cancel, true);
    view.removeEventListener("selectstart", cancel, true);
    view.removeEventListener("pointermove", pointerMove, true);
    view.removeEventListener("click", click, true);
  };
}

export const mobileSwipeMessage = "agents-in-the-cloud:mobile-swipe";

const mobileSwipeMessageSchema = Type.Union([
  Type.Object({ type: Type.Literal(mobileSwipeMessage), action: Type.Union([Type.Literal("ready"), Type.Literal("probe")]) }),
  Type.Object({ type: Type.Literal(mobileSwipeMessage), action: Type.Literal("configure"), previous: Type.Boolean(), next: Type.Boolean() }),
  Type.Object({ type: Type.Literal(mobileSwipeMessage), action: Type.Literal("navigate"), direction: Type.Union([Type.Literal(-1), Type.Literal(1)]) }),
]);

export function isMobileSwipeMessage(value: unknown): value is Static<typeof mobileSwipeMessageSchema> {
  return Value.Check(mobileSwipeMessageSchema, value);
}
