import { CableTopics, type CableSubscription, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";

const hubWorkspaceId = "__nox_hub__";

function workspaceIdFromHref(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return undefined;
  }
  if (url.origin !== location.origin || url.search || url.hash) return undefined;
  const match = url.pathname.match(/^\/workspaces\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
}

function isPlainPrimaryClick(event: Event): boolean {
  if (!(event instanceof MouseEvent)) return true;
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function syncHubSidebarButton(): void {
  const button = document.querySelector<HTMLElement>("[data-nox-hub-sidebar-link]");
  if (!button) return;
  const active = Boolean(document.getElementById("nox_hub_surface"));
  if (active) button.setAttribute("aria-current", "page");
  else button.removeAttribute("aria-current");
  button.setAttribute("aria-expanded", String(active));
  button.title = active ? "Close Hub" : "Open Hub";
}

export function createHubController(Controller: WorkspaceClientControllerConstructor) {
  return class NoxHubController extends Controller {
    static targets = ["scroll", "transcript", "input", "rail"];
    static values = { threadId: String, location: String };
    declare readonly element: HTMLElement;
    declare readonly hasScrollTarget: boolean;
    declare readonly scrollTarget: HTMLElement;
    declare readonly hasTranscriptTarget: boolean;
    declare readonly transcriptTarget: HTMLElement;
    declare readonly hasInputTarget: boolean;
    declare readonly inputTarget: HTMLTextAreaElement;
    declare readonly hasRailTarget: boolean;
    declare readonly railTarget: HTMLElement;
    declare readonly threadIdValue: string;
    declare readonly locationValue: string;

    private subscription?: CableSubscription;
    private observer?: MutationObserver;
    private pinnedToBottom = true;
    private returnUrl = "/";

    connect(): void {
      this.returnUrl = location.pathname.startsWith("/hub") ? "/" : location.href;
      const workspace = document.getElementById("workspace_detail");
      if (workspace) {
        workspace.inert = true;
        workspace.setAttribute("aria-hidden", "true");
      }
      document.dispatchEvent(new Event("agents-in-the-cloud:workspace-pane-hidden"));
      this.element.closest(".fixed-shell-app")?.classList.remove("is-mobile-workspace-pane-open");
      syncHubSidebarButton();

      const url = new URL(this.locationValue || "/hub", location.href).href;
      if (location.href !== url) history.pushState({}, "", url);

      document.addEventListener("workspace-selection:before-select", this.beforeWorkspaceSelect);
      document.addEventListener("click", this.outsideClick, true);
      this.element.addEventListener("click", this.onClick);
      window.addEventListener("popstate", this.historyChanged);

      if (this.hasScrollTarget) {
        this.scrollTarget.addEventListener("scroll", this.onScroll, { passive: true });
        this.scrollToBottom();
      }
      if (this.hasTranscriptTarget) {
        this.observer = new MutationObserver(() => {
          if (this.pinnedToBottom) this.scrollToBottom();
        });
        this.observer.observe(this.transcriptTarget, { childList: true, subtree: true, characterData: true });
      }

      this.subscribeThread();
      if (this.hasInputTarget && !window.matchMedia("(pointer: coarse)").matches) {
        requestAnimationFrame(() => this.inputTarget.focus({ preventScroll: true }));
      }
    }

    disconnect(): void {
      this.subscription?.unsubscribe();
      this.subscription = undefined;
      this.observer?.disconnect();
      this.observer = undefined;
      if (this.hasScrollTarget) this.scrollTarget.removeEventListener("scroll", this.onScroll);
      document.removeEventListener("workspace-selection:before-select", this.beforeWorkspaceSelect);
      document.removeEventListener("click", this.outsideClick, true);
      this.element.removeEventListener("click", this.onClick);
      window.removeEventListener("popstate", this.historyChanged);
      syncHubSidebarButton();

      queueMicrotask(() => {
        if (document.getElementById("nox_hub_surface")) return;
        this.restoreWorkspaceDetail();
      });
    }

    private restoreWorkspaceDetail(): void {
      const workspace = document.getElementById("workspace_detail");
      if (workspace) {
        workspace.inert = false;
        workspace.removeAttribute("aria-hidden");
      }
      document.dispatchEvent(new Event("agents-in-the-cloud:workspace-pane-visible"));
    }

    private subscribeThread(): void {
      this.subscription?.unsubscribe();
      const cable = window.AgentsInTheCloudCable;
      if (!cable || !this.threadIdValue) return;
      const identifier = CableTopics.module("nox-hub", hubWorkspaceId, { threadId: this.threadIdValue });
      this.subscription = cable.subscribe(identifier, { shownIn: this.element });
    }

    private readonly onScroll = (): void => {
      if (!this.hasScrollTarget) return;
      const el = this.scrollTarget;
      this.pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    };

    private scrollToBottom(): void {
      if (!this.hasScrollTarget) return;
      this.scrollTarget.scrollTop = this.scrollTarget.scrollHeight;
    }

    close(event?: Event): void {
      event?.preventDefault();
      if (!this.element.isConnected) return;
      if (location.pathname.startsWith("/hub")) history.replaceState(history.state, "", this.returnUrl);
      this.element.remove();
    }

    toggleRail(): void {
      this.element.classList.toggle("is-rail-open");
    }

    openWorkspace(event: Event): void {
      const link = event.currentTarget instanceof HTMLAnchorElement ? event.currentTarget : null;
      const workspaceId = link?.dataset.noxHubWorkspaceIdParam ?? (link ? workspaceIdFromHref(link.href) : undefined);
      if (!workspaceId) return;
      this.openWorkspaceById(event, workspaceId);
    }

    private openWorkspaceById(event: Event, workspaceId: string): boolean {
      if (!isPlainPrimaryClick(event)) return false;
      const row = document.querySelector<HTMLElement>(`[data-workspace-entry-id="${CSS.escape(workspaceId)}"]`);
      if (!row) return false;
      event.preventDefault();
      if (row.hasAttribute("data-workspace-parked")) {
        this.element.remove();
        this.restoreWorkspaceDetail();
        row.closest("form")?.requestSubmit();
        return true;
      }
      row.click();
      if (this.element.isConnected) {
        this.element.remove();
        this.restoreWorkspaceDetail();
      }
      return true;
    }

    private readonly onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || !isPlainPrimaryClick(event)) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || !this.element.contains(link) || link.target === "_blank") return;
      const workspaceId = link.dataset.noxHubWorkspaceIdParam ?? workspaceIdFromHref(link.href);
      if (!workspaceId) return;
      this.openWorkspaceById(event, workspaceId);
    };

    keydown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || this.element.querySelector(":popover-open, dialog[open]")) return;
      if (this.element.classList.contains("is-rail-open")) {
        event.preventDefault();
        this.element.classList.remove("is-rail-open");
        return;
      }
      event.preventDefault();
      this.close();
    }

    inputKeydown(event: KeyboardEvent): void {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      const form = this.inputTarget.form;
      if (!form || !this.inputTarget.value.trim()) return;
      form.requestSubmit();
    }

    resizeInput(): void {
      if (!this.hasInputTarget) return;
      const el = this.inputTarget;
      el.style.height = "auto";
      el.style.height = `${Math.min(220, Math.max(44, el.scrollHeight))}px`;
    }

    afterSubmit(): void {
      if (!this.hasInputTarget) return;
      this.pinnedToBottom = true;
      requestAnimationFrame(() => {
        if (!this.hasInputTarget) return;
        this.inputTarget.value = "";
        this.resizeInput();
      });
    }

    private readonly beforeWorkspaceSelect = (): void => {
      this.element.remove();
      this.restoreWorkspaceDetail();
    };

    private readonly outsideClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target.closest("a, button, summary, [data-action]") : null;
      if (!target || this.element.contains(target)) return;
      if (target.closest("[data-nox-hub-sidebar-link]")) {
        this.close(event);
        return;
      }
      if (target.closest(".fixed-shell-workspace-pane")) {
        if (target.matches('[href^="/workspaces/"], [href="/settings"], [href="/models"], [data-action*="openPicker"]')) {
          this.element.remove();
        }
      }
    };

    private readonly historyChanged = (): void => {
      if (!location.pathname.startsWith("/hub")) this.element.remove();
    };
  };
}

export function createHubSidebarController(Controller: WorkspaceClientControllerConstructor) {
  return class NoxHubSidebarController extends Controller {
    declare readonly element: HTMLElement;
    private subscription?: CableSubscription;

    connect(): void {
      syncHubSidebarButton();
      const cable = window.AgentsInTheCloudCable;
      if (!cable) return;
      const identifier = CableTopics.module("nox-hub", hubWorkspaceId, {});
      this.subscription = cable.subscribe(identifier, { shownIn: this.element });
    }

    disconnect(): void {
      this.subscription?.unsubscribe();
      this.subscription = undefined;
    }
  };
}
