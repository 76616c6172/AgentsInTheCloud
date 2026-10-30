import { activityButtonHtml } from "@agents-in-the-cloud/design-system/activity-button";
import { warningBannerHtml } from "@agents-in-the-cloud/design-system/warning-banner";
import { progressButtonHtml } from "@agents-in-the-cloud/design-system/progress-button";

export const dictationComposerController = "dictation-composer";

const microphoneIcon = `<svg class="dictation-microphone" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5a3 3 0 0 0 3-3v-4a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Zm-5-3a5 5 0 0 0 10 0M10 14.5V18m-3 0h6"/></svg>`;

export function renderDictationComposerControl(mobile = false): string {
  const button = mobile ? activityButtonHtml({
    type: "button",
    variant: "primary",
    state: "initial",
    initialContent: { kind: "html", html: `${microphoneIcon}<span>Dictate</span>` },
    activeContent: { kind: "html", html: '<i class="activity-spinner dictation-working" aria-hidden="true"></i><canvas data-dictation-composer-target="waveform" aria-hidden="true"></canvas><span data-dictation-composer-target="caption">Stop dictation</span>' },
    attributesHtml: 'data-popular-button aria-pressed="false" data-state="idle" data-dictation-composer-target="button"',
    actions: "dictation-composer#toggle",
  }) : progressButtonHtml({
    type: "button",
    variant: "secondary",
    iconOnly: true,
    initialLabel: "Dictate with microphone",
    progressLabel: "Preparing microphone",
    state: "initial",
    initialContent: { kind: "html", html: `${microphoneIcon}<canvas data-dictation-composer-target="waveform" aria-hidden="true"></canvas>` },
    progressContent: { kind: "html", html: '<i class="activity-spinner" aria-hidden="true"></i>' },
    attributesHtml: 'data-popular-button aria-pressed="false" data-state="idle" data-dictation-composer-target="button"',
    actions: "dictation-composer#toggle",
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
