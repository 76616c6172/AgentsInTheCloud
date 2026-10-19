import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

const PATCH = Symbol.for("pi-tool-display.collapsedImages.updateDisplay");

type ImageView = { expanded?: boolean; showImages?: boolean };
type UpdateDisplay = (this: ImageView) => void;
type ImagePrototype = {
  updateDisplay?: UpdateDisplay;
  [PATCH]?: UpdateDisplay;
};

/** Pi appends images outside renderCall/renderResult, even with renderShell:self.
 * Until it exposes an image-rendering policy, gate its view construction only.
 * These internal members are guarded and tested against the installed binary.
 * No tool result, attachment, or persisted image preference is modified. */
export function patchCollapsedToolImages(): void {
  const prototype = ToolExecutionComponent.prototype as unknown as ImagePrototype;
  if (typeof prototype.updateDisplay !== "function") return;
  if (prototype.updateDisplay === prototype[PATCH]) return;
  const original = prototype.updateDisplay;
  const patched: UpdateDisplay = function () {
    if (this.expanded !== false || this.showImages !== true) return original.call(this);
    // Suppress both image components and their spacers. Restore the preference
    // even if a renderer throws; expansion, image settings and async conversion
    // all rebuild through this same path.
    this.showImages = false;
    try { original.call(this); }
    finally { this.showImages = true; }
  };
  prototype[PATCH] = patched;
  prototype.updateDisplay = patched;
}
