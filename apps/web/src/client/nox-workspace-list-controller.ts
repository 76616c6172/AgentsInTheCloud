import { Controller } from "@hotwired/stimulus";

type ListFilter = "attention" | "running" | "idle";

const relativeTimeTickMs = 60_000;
const shortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return "Yesterday";
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return shortDateFormat.format(new Date(timestamp));
}

export class NoxWorkspaceListController extends Controller<HTMLElement> {
  private filter?: ListFilter;
  private timer?: ReturnType<typeof setInterval>;

  connect(): void {
    document.addEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    this.timer = setInterval(this.refreshRelativeTimes, relativeTimeTickMs);
    this.sync();
  }

  disconnect(): void {
    document.removeEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  toggleFilter({ params }: { params: { filter?: string } }): void {
    const requested = params.filter === "attention" || params.filter === "running" || params.filter === "idle" ? params.filter : undefined;
    this.filter = requested && this.filter !== requested ? requested : undefined;
    this.syncFilter();
  }

  clearFilter(): void {
    this.filter = undefined;
    this.syncFilter();
  }

  private readonly sync = (): void => {
    this.syncFilter();
    this.refreshRelativeTimes();
  };

  private syncFilter(): void {
    if (this.filter) this.element.dataset.noxListFilter = this.filter;
    else delete this.element.dataset.noxListFilter;
    this.element.querySelectorAll<HTMLButtonElement>("[data-nox-filter-chip]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.noxFilterChip === this.filter));
    });
  }

  private readonly refreshRelativeTimes = (): void => {
    const now = Date.now();
    this.element.querySelectorAll<HTMLElement>("[data-nox-activity-at][data-nox-subtitle-base]").forEach((row) => {
      const timestamp = Number(row.dataset.noxActivityAt);
      const base = row.dataset.noxSubtitleBase;
      if (!Number.isFinite(timestamp) || timestamp <= 0 || !base) return;
      const description = row.querySelector<HTMLElement>(".content-row__description");
      if (!description) return;
      const next = `${base} · ${formatRelativeTime(timestamp, now)}`;
      if (description.textContent !== next) description.textContent = next;
    });
  };
}
