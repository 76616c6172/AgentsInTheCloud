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

interface EditingRenameState {
  workspaceId: string;
  row: HTMLElement;
  primary: HTMLElement;
  label: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  originalTitle: string;
  closing: boolean;
}

export class NoxWorkspaceListController extends Controller<HTMLElement> {
  private filter?: ListFilter;
  private projectFilter = "";
  private timer?: ReturnType<typeof setInterval>;
  private editing?: EditingRenameState;

  connect(): void {
    this.projectFilter = readStoredProjectFilter();
    document.addEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    this.element.addEventListener("click", this.handleLabelClick, true);
    this.element.addEventListener("turbo:before-morph-element", this.preserveRenaming);
    this.timer = setInterval(this.refreshRelativeTimes, relativeTimeTickMs);
    this.sync();
  }

  disconnect(): void {
    this.cancelRename(false);
    document.removeEventListener("agents-in-the-cloud:workspace-pane-changed", this.sync);
    this.element.removeEventListener("click", this.handleLabelClick, true);
    this.element.removeEventListener("turbo:before-morph-element", this.preserveRenaming);
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
    if (this.editing && !this.editing.row.isConnected) this.editing = undefined;
    this.syncFilter();
    this.refreshRelativeTimes();
  };

  private readonly preserveRenaming = (event: Event): void => {
    const editing = this.editing;
    if (!editing) return;
    // SAFETY: Turbo emits this event with its morph descriptor; removals carry no new element.
    const { currentElement, newElement } = (event as CustomEvent<{ currentElement: Element; newElement?: Node }>).detail;
    if (currentElement === editing.row && newElement instanceof Element) event.preventDefault();
  };

  private readonly handleLabelClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (document.getElementById("nox_hub_surface")) return;
    const label = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-nox-rename-trigger]") : null;
    if (!label || !this.element.contains(label)) return;
    const primary = label.closest<HTMLElement>("[data-workspace-entry-id]");
    if (!primary || primary.hasAttribute("data-workspace-parked") || primary.getAttribute("aria-current") !== "page") return;
    const row = primary.closest<HTMLElement>(".content-row");
    const workspaceId = primary.dataset.workspaceEntryId;
    if (!row || !workspaceId || row.hasAttribute("data-nox-renaming")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.startRename(workspaceId, row, primary, label);
  };

  private startRename(workspaceId: string, row: HTMLElement, primary: HTMLElement, label: HTMLElement): void {
    if (this.editing) this.commitRename();
    const originalTitle = label.textContent?.trim() ?? "";

    const form = document.createElement("form");
    form.className = "nox-workspace-rename-form";
    form.dataset.noxRenameForm = "true";
    form.method = "post";
    form.action = `/workspaces/${encodeURIComponent(workspaceId)}/sidebar-title`;

    const input = document.createElement("input");
    input.className = "nox-workspace-rename-input";
    input.type = "text";
    input.name = "title";
    input.value = originalTitle;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Rename thread");
    input.dataset.noxRenameInput = "true";

    form.append(input);
    row.dataset.noxRenaming = "true";
    row.append(form);

    const state: EditingRenameState = {
      workspaceId,
      row,
      primary,
      label,
      form,
      input,
      originalTitle,
      closing: false,
    };
    this.editing = state;

    form.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      submitEvent.stopPropagation();
      this.commitRename();
    });
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        this.cancelRename(true);
      } else if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        this.commitRename();
      }
    });
    input.addEventListener("blur", () => {
      if (this.editing === state && !state.closing) this.commitRename();
    });

    input.focus({ preventScroll: true });
    input.select();
  }

  private teardownRename(state: EditingRenameState, restoreFocus: boolean): void {
    state.closing = true;
    if (this.editing === state) this.editing = undefined;
    state.form.remove();
    delete state.row.dataset.noxRenaming;
    if (restoreFocus && state.primary.isConnected) state.primary.focus({ preventScroll: true });
  }

  private cancelRename(restoreFocus: boolean): void {
    const state = this.editing;
    if (!state || state.closing) return;
    this.teardownRename(state, restoreFocus);
  }

  private commitRename(): void {
    const state = this.editing;
    if (!state || state.closing) return;
    const nextTitle = state.input.value.trim();
    const { workspaceId, label, originalTitle } = state;
    this.teardownRename(state, false);
    if (!nextTitle || nextTitle === originalTitle) return;

    label.textContent = nextTitle;
    const body = new FormData();
    body.set("title", nextTitle);
    void fetch(`/workspaces/${encodeURIComponent(workspaceId)}/sidebar-title`, {
      method: "POST",
      headers: { Accept: "text/vnd.turbo-stream.html" },
      body,
    }).then((response) => {
      if (!response.ok) throw new Error(`Could not rename thread: HTTP ${response.status}`);
    }).catch((error) => {
      console.error("Could not rename thread", error);
      if (label.isConnected && label.textContent === nextTitle) label.textContent = originalTitle;
    });
  }

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
