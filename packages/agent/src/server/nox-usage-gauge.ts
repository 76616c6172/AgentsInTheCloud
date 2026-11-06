import { comparisonRingHtml, type Comparison } from "@agents-in-the-cloud/design-system/comparison-ring";
import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { turboStream } from "@agents-in-the-cloud/shared";

/* Nox: on phones the workspace list's header hides the Usage button, so its bottom bar shows the
 * same limit as a gauge on Models (apps/web nox-workspace-list.ts). Each Usage button refresh
 * updates the gauge too; until the first one, and without an active limit, it is the Usage icon. */

const noxUsageGaugeDomId = "nox_usage_gauge";

export function renderNoxUsageGauge(): string {
  return `<span id="${noxUsageGaugeDomId}" class="nox-usage-gauge">${Icons.Usage}</span>`;
}

export function noxUsageGaugeStream(comparison: Comparison | undefined, label: string, caption: string | undefined): string {
  const gauge = comparison && caption !== undefined ? comparisonRingHtml({ ...comparison, caption, label }) : Icons.Usage;
  return turboStream("update", noxUsageGaugeDomId, gauge);
}
