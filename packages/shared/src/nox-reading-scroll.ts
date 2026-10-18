import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/** Nox: which way a vertical drag moved the reader through scrollable content. */
export type ReadingScrollDirection = "down" | "up";

// A drag this far scrolls far enough to count as reading; pulling back down takes a little
// more, so reading upward doesn't immediately bring the chrome back.
const readingDistance = 32;
const returnDistance = 48;

/**
 * Reports one direction per vertical drag inside root: "down" once a drag through scrollable
 * content passes the reading distance, "up" once any drag pulls back past the return distance.
 * Horizontal drags and drags starting in form fields are left alone.
 */
export function observeReadingScroll(root: HTMLElement, report: (direction: ReadingScrollDirection) => void): () => void {
  let touch: { x: number; y: number; scrolls: boolean } | undefined;
  const start = (event: TouchEvent): void => {
    touch = undefined;
    const target = event.target;
    if (event.touches.length !== 1 || !(target instanceof Element) || !root.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    const { clientX: x, clientY: y } = event.touches[0]!;
    touch = { x, y, scrolls: scrollsVertically(target, root) };
  };
  const move = (event: TouchEvent): void => {
    if (!touch) return;
    const { clientX, clientY } = event.touches[0]!;
    const dx = clientX - touch.x;
    const dy = clientY - touch.y;
    // Horizontal drags belong to the pane and drawer swipes.
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > readingDistance) touch = undefined;
      return;
    }
    if (dy <= -readingDistance && touch.scrolls) {
      touch = undefined;
      report("down");
    } else if (dy >= returnDistance) {
      touch = undefined;
      report("up");
    }
  };
  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: true });
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
  };
}

/** Only content that can scroll counts as reading; short pages keep their chrome. */
function scrollsVertically(target: Element, root: Element): boolean {
  for (let element: Element | null = target; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    const scrollable = element === element.ownerDocument.scrollingElement ? overflow !== "hidden" : /auto|scroll/.test(overflow);
    if (scrollable && element.scrollHeight > element.clientHeight + 1) return true;
    if (element === root) return false;
  }
  return false;
}

/** Embedded pages report their reading scroll to the app, which owns the chrome. */
export const readingScrollMessage = "agents-in-the-cloud:nox-reading-scroll";

const readingScrollMessageSchema = Type.Object({
  type: Type.Literal(readingScrollMessage),
  direction: Type.Union([Type.Literal("down"), Type.Literal("up")]),
});

export function isReadingScrollMessage(value: unknown): value is Static<typeof readingScrollMessageSchema> {
  return Value.Check(readingScrollMessageSchema, value);
}
