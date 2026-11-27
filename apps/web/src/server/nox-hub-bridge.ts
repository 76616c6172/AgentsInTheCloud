import {
  listWorkspaceControlledAgents,
  readWorkspaceAgentTranscript,
  sendWorkspaceAgentMessage,
  stopWorkspaceControlledAgent,
} from "@agents-in-the-cloud/agent/server";
import { AgentsInTheCloudCoreError, type AgentsInTheCloudEventBus, type JsonObject } from "@agents-in-the-cloud/core";
import type {
  HubCreatedWorkspace,
  HubCreateWorkspaceOptions,
  HubHostBridge,
  HubProjectSummary,
  HubTemplateSummary,
  HubWaitOptions,
  HubWaitResult,
  HubWorkspaceState,
  HubWorkspaceSummary,
} from "@agents-in-the-cloud/nox-hub/server";
import {
  assignWorkspaceToProject,
  listProjects,
  resolveTemplateProjectId,
  resolveWorkspaceProjectId,
  type NoxProjectRecord,
} from "@agents-in-the-cloud/nox-projects/server";
import type { WorkspaceInitInstruction } from "@agents-in-the-cloud/workspace";
import { isGitWorkspaceTemplateInit, listWorkspaceTemplates, workspaceInitFromTemplate, workspaceTemplateIdFromInit, type WorkspaceTemplateSummary } from "@agents-in-the-cloud/workspace-templates";
import type { WorkspaceEntry, WorkspaceRegistry } from "./workspace-registry.ts";

export interface NoxHubBridgeDependencies {
  readonly events?: AgentsInTheCloudEventBus;
  readonly registry: WorkspaceRegistry;
  createWorkspace(command: { init?: WorkspaceInitInstruction; agent?: JsonObject; title?: string }): Promise<{ id: string }>;
  parkWorkspace(workspaceId: string, parked: boolean): Promise<void>;
  resolveTemplate(reference: string): Promise<WorkspaceTemplateSummary>;
  renderHubPage(html: string): Promise<Response>;
}

export function deriveHubWorkspaceState(entry: WorkspaceEntry): HubWorkspaceState {
  if (entry.phase.kind === "deletingPhase") return "deleting";
  if (entry.phase.kind === "provisioningPhase") {
    if (entry.phase.status === "failed") return "setup_failed";
    if (entry.phase.status === "waiting") return "waiting_confirmation";
    return "provisioning";
  }
  if (entry.parked) return "parked";
  if (entry.phase.busy) return "running";
  if (entry.requestingAttention) return "attention";
  return "idle";
}

function isSettledState(state: HubWorkspaceState): boolean {
  return state !== "provisioning" && state !== "running";
}

function workspaceTitle(entry: WorkspaceEntry): string {
  return entry.title?.trim() || (isGitWorkspaceTemplateInit(entry.init) ? entry.init.name : "Workspace");
}

export function createNoxHubBridge(deps: NoxHubBridgeDependencies): HubHostBridge {
  async function templateMap(projects: readonly NoxProjectRecord[]): Promise<Map<string, HubTemplateSummary>> {
    const { workspaceTemplates } = await listWorkspaceTemplates();
    const map = new Map<string, HubTemplateSummary>();
    for (const item of workspaceTemplates) {
      map.set(item.id, {
        id: item.id,
        title: item.name,
        url: item.gitUrl,
        branch: item.branch ?? undefined,
        swatchColor: item.swatchColor,
        projectId: resolveTemplateProjectId(projects, item.id),
      });
    }
    return map;
  }

  function toSummary(
    entry: WorkspaceEntry,
    templates: Map<string, HubTemplateSummary>,
    projects: readonly NoxProjectRecord[],
  ): HubWorkspaceSummary {
    const state = deriveHubWorkspaceState(entry);
    let template: HubWorkspaceSummary["template"];
    let templateId: string | undefined;
    if (isGitWorkspaceTemplateInit(entry.init)) {
      templateId = workspaceTemplateIdFromInit(entry.init);
      const saved = templates.get(templateId);
      template = saved
        ? { id: saved.id, title: saved.title, swatchColor: saved.swatchColor }
        : { id: templateId, title: entry.init.name };
    }
    const projectId = resolveWorkspaceProjectId(projects, { workspaceId: entry.id, templateId });
    return {
      id: entry.id,
      title: workspaceTitle(entry),
      url: `/workspaces/${encodeURIComponent(entry.id)}`,
      state,
      parked: entry.parked,
      busy: entry.phase.busy,
      requestingAttention: entry.requestingAttention,
      provisioningError: entry.phase.kind === "provisioningPhase" ? entry.phase.error : undefined,
      template,
      projectId,
      lastActivityAt: entry.lastActivityAt,
      attentionAt: entry.attentionAt,
    };
  }

  async function resolveInit(templateRef?: string): Promise<{ init?: WorkspaceInitInstruction; templateId?: string }> {
    const trimmed = templateRef?.trim();
    if (!trimmed) return {};
    const { workspaceTemplates } = await listWorkspaceTemplates();
    const lower = trimmed.toLowerCase();
    const matched = workspaceTemplates.find((item) => item.id === trimmed)
      ?? workspaceTemplates.find((item) => item.name.toLowerCase() === lower)
      ?? workspaceTemplates.find((item) => item.gitUrl.toLowerCase() === lower);
    if (matched) return { init: workspaceInitFromTemplate(matched), templateId: matched.id };
    const resolved = await deps.resolveTemplate(trimmed);
    return { init: workspaceInitFromTemplate(resolved), templateId: resolved.id };
  }

  return {
    events: deps.events,

    async listProjects(): Promise<HubProjectSummary[]> {
      return (await listProjects()).map(({ id, name, templateIds, workspaceIds }) => ({ id, name, templateIds, workspaceIds }));
    },

    async listTemplates(options = {}): Promise<HubTemplateSummary[]> {
      const projects = await listProjects();
      const templates = [...(await templateMap(projects)).values()];
      if (!options.projectId) return templates;
      return templates.filter((item) => item.projectId === options.projectId);
    },

    async listWorkspaces(options = {}): Promise<HubWorkspaceSummary[]> {
      const projects = await listProjects();
      const templates = await templateMap(projects);
      const filterTemplate = options.template?.trim().toLowerCase();
      return deps.registry.list()
        .map((entry) => toSummary(entry, templates, projects))
        .filter((ws) => {
          if (!options.includeParked && ws.parked) return false;
          if (options.projectId && ws.projectId !== options.projectId) return false;
          if (options.state && ws.state !== options.state) return false;
          if (filterTemplate) {
            const matchesId = ws.template?.id.toLowerCase() === filterTemplate;
            const matchesTitle = ws.template?.title.toLowerCase().includes(filterTemplate) ?? false;
            if (!matchesId && !matchesTitle) return false;
          }
          return true;
        });
    },

    async getWorkspace(workspaceId: string): Promise<HubWorkspaceSummary> {
      const entry = deps.registry.get(workspaceId);
      if (!entry) throw new AgentsInTheCloudCoreError("workspace_not_found", `Workspace not found: ${workspaceId}`);
      const projects = await listProjects();
      const templates = await templateMap(projects);
      return toSummary(entry, templates, projects);
    },

    async createWorkspace(options: HubCreateWorkspaceOptions): Promise<HubCreatedWorkspace> {
      const { init, templateId } = await resolveInit(options.template);
      const agentTypeId = options.agentTypeId?.trim() || "pi";
      const agent: JsonObject = { agentTypeId };
      if (options.prompt !== undefined) agent.initialPrompt = options.prompt;
      if (options.model) agent.model = options.model;
      if (options.thinkingLevel) agent.thinkingLevel = options.thinkingLevel;
      const { id } = await deps.createWorkspace({ init, agent, title: options.title });
      if (options.projectId) {
        await assignWorkspaceToProject(id, options.projectId, templateId);
      }
      const entry = deps.registry.get(id);
      return {
        id,
        title: entry ? workspaceTitle(entry) : (options.title?.trim() || "Workspace"),
        url: `/workspaces/${encodeURIComponent(id)}`,
        agentTypeId,
        state: entry ? deriveHubWorkspaceState(entry) : "provisioning",
      };
    },

    async parkWorkspace(workspaceId: string, parked: boolean): Promise<HubWorkspaceSummary> {
      await deps.parkWorkspace(workspaceId, parked);
      return await this.getWorkspace(workspaceId);
    },

    async listAgents(workspaceId: string) {
      return await listWorkspaceControlledAgents(workspaceId);
    },

    async readTranscript(workspaceId: string, agentId?: string) {
      return await readWorkspaceAgentTranscript(workspaceId, agentId);
    },

    async sendMessage(workspaceId: string, options) {
      const entry = deps.registry.get(workspaceId);
      if (!entry) throw new AgentsInTheCloudCoreError("workspace_not_found", `Workspace not found: ${workspaceId}`);
      if (entry.parked) {
        if (!options.unpark) {
          throw new AgentsInTheCloudCoreError("invalid_arguments", `Workspace ${workspaceId} is parked. Pass unpark: true to wake it first.`);
        }
        await deps.parkWorkspace(workspaceId, false);
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const current = deps.registry.get(workspaceId);
          if (current && !current.parked && current.phase.kind === "runningPhase") break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      return await sendWorkspaceAgentMessage(workspaceId, {
        agentId: options.agentId,
        text: options.text,
        whenBusy: options.whenBusy,
      });
    },

    async stopAgent(workspaceId: string, agentId?: string) {
      return await stopWorkspaceControlledAgent(workspaceId, agentId);
    },

    async waitForWorkspaces(options: HubWaitOptions): Promise<HubWaitResult> {
      const uniqueIds = [...new Set(options.workspaceIds)];
      const snapshot = async (): Promise<{ settledIds: string[]; workspaces: HubWorkspaceSummary[] }> => {
        const projects = await listProjects();
        const templates = await templateMap(projects);
        const workspaces: HubWorkspaceSummary[] = [];
        const settledIds: string[] = [];
        for (const id of uniqueIds) {
          const entry = deps.registry.get(id);
          if (!entry) {
            settledIds.push(id);
            continue;
          }
          const summary = toSummary(entry, templates, projects);
          workspaces.push(summary);
          if (isSettledState(summary.state)) settledIds.push(id);
        }
        return { settledIds, workspaces };
      };

      const done = (settledIds: string[]) => options.mode === "any"
        ? settledIds.length > 0
        : settledIds.length >= uniqueIds.length;

      const initial = await snapshot();
      if (done(initial.settledIds)) {
        return { timedOut: false, ...initial };
      }

      return await new Promise<HubWaitResult>((resolve, reject) => {
        let finished = false;
        const cleanups: Array<() => void> = [];
        const cleanup = () => {
          for (const fn of cleanups) fn();
          cleanups.length = 0;
        };

        const check = async () => {
          if (finished) return;
          const current = await snapshot();
          if (done(current.settledIds)) {
            finished = true;
            cleanup();
            resolve({ timedOut: false, ...current });
          }
        };

        const timer = setTimeout(async () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve({ timedOut: true, ...(await snapshot()) });
        }, options.timeoutMs);
        timer.unref?.();
        cleanups.push(() => clearTimeout(timer));

        const poll = setInterval(() => { void check(); }, 400);
        poll.unref?.();
        cleanups.push(() => clearInterval(poll));

        const onEvent = () => { void check(); };
        if (deps.events) {
          cleanups.push(deps.events.on("workspace_agent_turn_finished", onEvent));
          cleanups.push(deps.events.on("workspace_runtime_ready", onEvent));
          cleanups.push(deps.events.on("workspace_deleting", onEvent));
        }

        if (options.signal) {
          const onAbort = () => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(new Error("Wait aborted"));
          };
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener("abort", onAbort, { once: true });
          cleanups.push(() => options.signal?.removeEventListener("abort", onAbort));
        }
      });
    },

    renderHubPage: deps.renderHubPage,
  };
}
