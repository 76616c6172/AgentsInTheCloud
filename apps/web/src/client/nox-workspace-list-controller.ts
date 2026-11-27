import { Controller } from "@hotwired/stimulus";

type ListFilter = "attention" | "running" | "idle";

const relativeTimeTickMs = 60_000;
const projectFilterStorageKey = "nox.sidebarProjectFilter";
const shortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const statusChipLabels = {
  attention: "Done",
  running: "Running",
  idle: "Idle",
} satisfies Record<ListFilter, string>;

function parseListFilter(value: string | undefined): ListFilter | undefined {
  return value === "attention" || value === "running" || value === "idle" ? value : undefined;
}

function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 172_800_000) return "Yesterday";
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return shortDateFormat.format(new Date(timestamp));
}

function readStoredProjectFilter(): string {
  try {
    return localStorage.getItem(projectFilterStorageKey) ?? "";
  } catch {
    return "";
  }
}

function writeStoredProjectFilter(value: string): void {
  try {
    if (value) localStorage.setItem(projectFilterStorageKey, value);
    else localStorage.removeItem(projectFilterStorageKey);
  } catch {
    return;
  }
}

export class NoxWorkspaceListController extends Controller<HTMLElement> {
  private filter?: ListFilter;
  private projectFilter = "";
  private timer?: ReturnType<typeof setInterval>;

  connect(): void {
    this.projectFilter = readStoredProjectFilter();
    document.addEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    this.timer = setInterval(this.refreshRelativeTimes, relativeTimeTickMs);
    this.sync();
  }

  disconnect(): void {
    document.removeEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  toggleFilter({ params }: { params: { filter?: string } }): void {
    const requested = parseListFilter(params.filter);
    this.filter = requested && this.filter !== requested ? requested : undefined;
    this.syncFilter();
  }

  selectProject({ params }: { params: { project?: string } }): void {
    const requested = params.project ?? "";
    this.projectFilter = requested;
    writeStoredProjectFilter(this.projectFilter);
    this.syncFilter();
    const popover = this.element.querySelector<HTMLElement>("#nox_project_filter_popup[popover]");
    popover?.hidePopover?.();
  }

  private readonly sync = (): void => {
    this.syncFilter();
    this.refreshRelativeTimes();
  };

  private syncFilter(): void {
    const options = [...this.element.querySelectorAll<HTMLButtonElement>("[data-nox-project-option]")];
    if (this.projectFilter && options.length && !options.some((button) => (button.dataset.noxProjectOption ?? "") === this.projectFilter)) {
      this.projectFilter = "";
      writeStoredProjectFilter("");
    }
    if (this.filter) this.element.dataset.noxListFilter = this.filter;
    else delete this.element.dataset.noxListFilter;
    if (this.projectFilter) this.element.dataset.noxProjectFilter = this.projectFilter;
    else delete this.element.dataset.noxProjectFilter;

    const trigger = this.element.querySelector<HTMLButtonElement>("[data-nox-project-filter-trigger]");
    if (trigger) trigger.setAttribute("aria-pressed", String(this.projectFilter !== ""));
    options.forEach((button) => {
      button.setAttribute("aria-checked", String((button.dataset.noxProjectOption ?? "") === this.projectFilter));
    });

    const counts = { attention: 0, running: 0, idle: 0 };
    let visibleCount = 0;
    this.element.querySelectorAll<HTMLElement>(".nox-template-group").forEach((group) => {
      let groupVisible = 0;
      group.querySelectorAll<HTMLElement>("[data-nox-project-id]").forEach((row) => {
        const matchesProject = !this.projectFilter || row.dataset.noxProjectId === this.projectFilter;
        const isAttention = row.dataset.noxWsAttention === "true";
        const isRunning = row.dataset.noxWsBusy === "true";
        const isIdle = row.dataset.noxWsState === "idle";
        if (matchesProject) {
          if (isAttention) counts.attention++;
          if (isRunning) counts.running++;
          if (isIdle) counts.idle++;
        }
        const matchesStatus = !this.filter
          || (this.filter === "attention" && isAttention)
          || (this.filter === "running" && isRunning)
          || (this.filter === "idle" && isIdle);
        row.toggleAttribute("data-nox-project-hidden", !matchesProject);
        if (matchesProject && matchesStatus) groupVisible++;
      });
      group.toggleAttribute("data-nox-group-empty", groupVisible === 0);
      visibleCount += groupVisible;
    });

    this.element.querySelectorAll<HTMLButtonElement>("[data-nox-filter-chip]").forEach((chip) => {
      const kind = parseListFilter(chip.dataset.noxFilterChip);
      chip.setAttribute("aria-pressed", String(kind !== undefined && kind === this.filter));
      if (!kind) return;
      const count = counts[kind];
      chip.classList.toggle("is-zero", count === 0);
      const label = chip.querySelector<HTMLElement>("[data-nox-filter-chip-label]");
      const nextText = `${count} ${statusChipLabels[kind]}`;
      if (label && label.textContent !== nextText) label.textContent = nextText;
    });

    const emptyMessage = this.element.querySelector<HTMLElement>(".nox-list-empty-filter");
    if (emptyMessage) emptyMessage.hidden = !(this.filter || this.projectFilter) || visibleCount > 0;
    const hubLink = this.element.querySelector<HTMLAnchorElement>("[data-nox-hub-sidebar-link]");
    if (hubLink) {
      hubLink.href = this.projectFilter && this.projectFilter !== "none"
        ? `/hub?project=${encodeURIComponent(this.projectFilter)}`
        : "/hub";
    }
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
