import { buttonHtml } from "@agents-in-the-cloud/design-system/button";
import { warningBannerHtml } from "@agents-in-the-cloud/design-system/warning-banner";

export const dictationComposerController = "dictation-composer";

export function renderDictationComposerControl(mobile = false): string {
  // The voice ribbon is the control's only content, at rest and while listening.
  const button = buttonHtml({
    type: "button",
    variant: mobile ? "primary" : "secondary",
    content: { kind: "icon-only", iconHtml: '<canvas class="voice-ribbon" data-dictation-composer-target="ribbon"></canvas>', label: "Speak" },
    attributesHtml: 'data-popular-button aria-pressed="false" data-state="idle" data-dictation-composer-target="button" data-action="dictation-composer#toggle"',
  });
  const error = warningBannerHtml({
    message: "Dictation failed",
    role: "alert",
    dismiss: { label: "Dismiss dictation error", buttonAttributesHtml: 'data-action="dictation-composer#cancel"' },
  });
  return `${button}<span class="dictation-status" data-dictation-composer-target="status" aria-live="polite">Dictate</span><div class="dictation-error" data-dictation-composer-target="error" hidden>${error}</div>`;
}

/** Always available on phones, independently of whether the Agent composer is open. */
export function renderMobileDictationControl(): string {
  return `<div class="dictation-dock" data-agent-composer-target="bottomControls"><div class="dictation-mobile-control">${renderDictationComposerControl(true)}</div></div>`;
}
