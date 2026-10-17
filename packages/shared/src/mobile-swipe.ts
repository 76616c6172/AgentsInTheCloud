import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export type MobileSwipeDirection = -1 | 1;

/** Shared recognizer; its owning Stimulus controller supplies visibility and navigation. */
export function observeMobileSwipe(
  root: HTMLElement,
  navigationFor: (direction: MobileSwipeDirection) => (() => void) | undefined,
): () => void {
  const view = root.ownerDocument.defaultView!;
  let gesture: { id: number; x: number; y: number; time: number; direction?: MobileSwipeDirection } | undefined;
  let suppressClickUntil = 0;
  const cancel = (): void => { gesture = undefined; };
  const start = (event: TouchEvent): void => {
    cancel();
    if (event.touches.length !== 1 || !(event.target instanceof Node) || !root.contains(event.target)) return;
    if (!navigationFor(-1) && !navigationFor(1)) return;
    const touch = event.touches[0]!;
    gesture = { id: touch.identifier, x: touch.screenX, y: touch.screenY, time: event.timeStamp };
  };
  const move = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (!gesture || event.touches.length !== 1 || touch?.identifier !== gesture.id) { cancel(); return; }
    const dx = touch.screenX - gesture.x;
    const dy = touch.screenY - gesture.y;
    if (!gesture.direction) {
      if (Math.hypot(dx, dy) < 12) return;
      const direction = dx < 0 ? 1 : -1;
      // Decide once: a vertical scroll or long press never turns into navigation.
      if (Math.abs(dx) < Math.abs(dy) * 1.5 || event.timeStamp - gesture.time > 350 || !navigationFor(direction) || !event.cancelable) { cancel(); return; }
      gesture.direction = direction;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = Date.now() + 400;
  };
  const finish = (event: TouchEvent): void => {
    const current = gesture;
    cancel();
    const touch = event.changedTouches[0];
    if (!current?.direction || !touch || touch.identifier !== current.id) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = Date.now() + 400;
    const dx = touch.screenX - current.x;
    const dy = touch.screenY - current.y;
    if (event.touches.length === 0 && event.timeStamp - current.time < 1000
      && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5
      && (dx < 0 ? 1 : -1) === current.direction) navigationFor(current.direction)?.();
  };
  const click = (event: MouseEvent): void => {
    if (Date.now() >= suppressClickUntil || !(event.target instanceof Node) || !root.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const pointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && gesture?.direction) event.stopImmediatePropagation();
  };
  view.addEventListener("touchstart", start, { capture: true, passive: true });
  view.addEventListener("touchmove", move, { capture: true, passive: false });
  view.addEventListener("touchend", finish, { capture: true, passive: false });
  view.addEventListener("touchcancel", cancel, true);
  view.addEventListener("pointermove", pointerMove, true);
  view.addEventListener("click", click, true);
  return () => {
    view.removeEventListener("touchstart", start, true);
    view.removeEventListener("touchmove", move, true);
    view.removeEventListener("touchend", finish, true);
    view.removeEventListener("touchcancel", cancel, true);
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
