import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  configure,
  createRegistry,
  defineDoc,
  defineExtension,
  Harness,
  InboxDoc,
  LiveDoc,
  type Conversation,
  type ConversationId,
  type ConversationView,
  type WatchHandle,
} from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { AgentsInTheCloudCoreError, getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { suggestAgentSlug } from "@agents-in-the-cloud/agent/server/slug-suggestion";
import type { AgentRenderContext } from "@agents-in-the-cloud/agent/server/render-context";
import { renderModelContextDetailFrame, renderTranscriptItemDetailFrame, type AgentModelContextView } from "@agents-in-the-cloud/agent/server/render-transcript";
import { findTranscriptItem, type TranscriptItem } from "@agents-in-the-cloud/agent/server/transcript";
import { durableViewState, projectDurableTranscript } from "@agents-in-the-cloud/builtin-agent";
import { LiveTranscriptRenderer, StreamingTexts } from "@agents-in-the-cloud/builtin-agent/server/render-live-transcript";
import { createPiModelRuntime, modelRefValue, parseModelRef, type ModelRef } from "@agents-in-the-cloud/llm/server";
import { createLivePresentation, type LiveRegion, type LiveRegionDigests, type LiveSubscription } from "@agents-in-the-cloud/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { resolveHubDefaults, saveHubPreferences } from "./model-selection.ts";
import { createHubTools, hubInstructionsForProject } from "./tools.ts";
import { createDockerHubContainerBackend, HubContainerPool } from "./container-pool.ts";
import { createHubContainerTools } from "./workspace-tools.ts";
import { hubHost, type HubHostBridge } from "./bridge.ts";

const thinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

export interface HubSidebarStatus {
  busy: boolean;
  requestingAttention: boolean;
  runningCount: number;
  attentionCount: number;
}

export const hubWorkspaceSyntheticId = "__nox_hub__";
export const hubUntitledTitle = "New thread";
const wholeWindow = Number.MAX_SAFE_INTEGER - 1;

export type HubThreadRecord = {
  threadId: string;
  durableId: ConversationId;
  title: string;
  untitled: boolean;
  createdAt: number;
  updatedAt: number;
  launchedWorkspaceIds: string[];
  projectId?: string;
};

type HubThreadCatalog = {
  threads: HubThreadRecord[];
};

const HubThreads = defineDoc<HubThreadCatalog>({
  kind: "nox.hub.threads",
  version: 1,
  scope: "session",
  initial: () => ({ threads: [] }),
  checkpointWhen: () => false,
});

export interface HubThreadSummary {
  threadId: string;
  title: string;
  untitled: boolean;
  createdAt: number;
  updatedAt: number;
  busy: boolean;
  requestingAttention: boolean;
  launchedWorkspaceIds: readonly string[];
  projectId?: string;
  containerId?: string;
  model?: ModelRef;
  thinkingLevel?: string;
}

export interface HubThreadSnapshot {
  summary: HubThreadSummary;
  items: TranscriptItem[];
  modelContext: AgentModelContextView;
  ctx: AgentRenderContext;
}

export function hubRenderContext(threadId: string, model?: ModelRef): AgentRenderContext {
  return {
    workspaceId: hubWorkspaceSyntheticId,
    agentId: threadId,
    model,
    compactTools: true,
    inlineWorkingItems: true,
    transcriptBasePath: `/hub/threads/${encodeURIComponent(threadId)}`,
  };
}

function modelContextFromView(view: ConversationView): AgentModelContextView {
  const edits = new Map(view.entries.flatMap((entry) => entry.edits ?? []).map((edit) => [edit.target, edit]));
  const messages = view.entries.flatMap((entry) => {
    const edit = edits.get(entry.id);
    return edit?.action === "omit" ? [] : edit?.action === "replace" ? edit.messages : entry.model ?? [];
  });
  return {
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages),
  };
}

function activeView(view: ConversationView): ConversationView {
  const marker = view.entries.findLast((entry) => entry.head !== undefined);
  if (!marker || marker.head === undefined) return view;
  return { ...view, entries: [marker, ...view.entries.filter((entry) => entry.head === undefined && entry.id >= marker.head!)] };
}

class HubThreadPresentation {
  private readonly renderer = new LiveTranscriptRenderer();
  private readonly markdown = new StreamingTexts(hubWorkspaceSyntheticId);
  private readonly presentation: ReturnType<typeof createLivePresentation>;
  private readonly ctx: AgentRenderContext;
  private frame: ConversationView;
  private items: TranscriptItem[] = [];
  private modelContext: AgentModelContextView = { systemPrompt: "", tools: [] };
  private disposed = false;

  private constructor(
    private readonly watch: WatchHandle<ConversationView>,
    threadId: string,
    private readonly renderControls: (busy: boolean) => LiveRegion[],
    private readonly onStateChange: (busy: boolean, view: ConversationView) => void,
  ) {
    this.ctx = { ...hubRenderContext(threadId), streamingText: this.markdown.render };
    this.frame = activeView(watch.value);
    this.presentation = createLivePresentation(() => [
      this.renderer.renderTranscript(this.ctx, this.items, this.modelContext),
      ...this.renderControls(this.busy),
    ], 50);
    this.update(this.frame);
    watch.start(async (call) => {
      if (this.disposed || call.kind !== "value") return;
      this.update(activeView(call.value));
    });
    void watch.closed.then(() => { this.dispose(); });
  }

  static async attach(
    conversation: Conversation,
    threadId: string,
    renderControls: (busy: boolean) => LiveRegion[],
    onStateChange: (busy: boolean, view: ConversationView) => void,
  ): Promise<HubThreadPresentation> {
    const { head } = await conversation.context(BACKGROUND_CONTEXT);
    const watch = await conversation.watch(BACKGROUND_CONTEXT, { from: head?.head, min: wholeWindow, max: wholeWindow });
    try {
      return new HubThreadPresentation(watch, threadId, renderControls, onStateChange);
    } catch (error) {
      await watch.stop();
      throw error;
    }
  }

  get busy(): boolean {
    const state = durableViewState(this.frame);
    return Boolean(state.live.run || state.live.compactions?.length);
  }

  get currentItems(): TranscriptItem[] { return this.items; }
  get currentModelContext(): AgentModelContextView { return this.modelContext; }
  get currentCtx(): AgentRenderContext { return this.ctx; }

  private update(view: ConversationView): void {
    this.frame = view;
    const state = durableViewState(view);
    const model = state.agent.model;
    this.ctx.model = model ? { provider: model.provider, id: model.modelId } : undefined;
    this.items = projectDurableTranscript(view);
    this.modelContext = modelContextFromView(view);
    this.presentation.invalidate();
    this.markdown.retainLive(this.items);
    this.onStateChange(this.busy, view);
  }

  subscribe(listener: (html: string) => void, shown?: LiveRegionDigests): LiveSubscription {
    return this.presentation.subscribe(listener, shown);
  }

  detailFrame(key: string): string | undefined {
    if (key === "system-prompt" || key === "tool-definitions") {
      return renderModelContextDetailFrame(this.ctx, this.modelContext, key);
    }
    const item = findTranscriptItem(this.items, key);
    return item ? renderTranscriptItemDetailFrame(this.ctx, item) : undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.presentation.dispose();
    void this.watch.stop();
  }
}

export interface HubRuntimeOptions {
  dataDir?: string;
  getHost?: () => HubHostBridge;
  containerPool?: HubContainerPool;
  warmSpare?: boolean;
  renderThreadControls?: (threadId: string, busy: boolean) => LiveRegion[];
}

export class HubRuntime {
  private readonly busyThreads = new Set<string>();
  private readonly attentionThreads = new Set<string>();
  private readonly presentations = new Map<string, Promise<HubThreadPresentation>>();
  private readonly statusListeners = new Set<() => void>();
  private readonly naming = new Set<string>();
  private activeConversationThreadMap = new Map<ConversationId, string>();
  private threadProjectMap = new Map<ConversationId, string | undefined>();
  private disposed = false;

  private constructor(
    private readonly harness: Harness,
    private readonly releaseLock: () => Promise<void>,
    private readonly dataDir: string,
    private readonly containerPool: HubContainerPool,
    private readonly getHost: () => HubHostBridge,
    private readonly renderThreadControls: (threadId: string, busy: boolean) => LiveRegion[],
  ) {}

  static async open(options: HubRuntimeOptions = {}): Promise<HubRuntime> {
    const dataDir = options.dataDir ?? getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir;
    const directory = join(dataDir, "hub", "journal");
    await mkdir(directory, { recursive: true });
    const release = await lock(directory, {
      stale: 10_000,
      update: 5_000,
      retries: { retries: 24, factor: 1, minTimeout: 500, maxTimeout: 500, randomize: false },
    });
    try {
      const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
      const models = await createPiModelRuntime();
      const getHost = options.getHost ?? hubHost;
      const containerPool = options.containerPool ?? new HubContainerPool(
        dataDir,
        createDockerHubContainerBackend(() => {
          try { return getHost().events; } catch { return undefined; }
        }),
      );
      let runtimeRef: HubRuntime | undefined;
      const registry = createRegistry();
      registry.install(defineExtension({
        name: "nox.hub.tools",
        tools: createHubTools({
          getHost,
          onWorkspaceCreated: (workspaceId, conversationId) => runtimeRef?.recordLaunchedWorkspace(workspaceId, conversationId),
          getThreadProjectId: (conversationId) => runtimeRef?.projectIdForConversation(conversationId),
          getPreferredReaderModel: () => runtimeRef?.lastUsedModel,
        }),
      }));
      registry.install(defineExtension({
        name: "nox.hub.container-tools",
        tools: createHubContainerTools(async (conversationId, onProgress) => {
          const threadId = runtimeRef?.threadIdForConversation(conversationId);
          if (!threadId) throw new Error("Hub thread not found for container tool execution");
          const containerId = await containerPool.ensureThreadContainer(threadId, onProgress);
          runtimeRef?.emitStatus();
          return containerId;
        }),
      }));
      let harness: Harness;
      try {
        harness = await Harness.open(storage, {
          models,
          registry,
          settings: { compaction: { enabled: true, keepRecentTokens: 6000 } },
          onReport: ({ error, ...info }) => console.error(`Hub work report (${info.kind})`, error, info),
        }, BACKGROUND_CONTEXT);
      } catch (error) {
        await storage.close(BACKGROUND_CONTEXT);
        throw error;
      }
      const runtime = new HubRuntime(harness, release, dataDir, containerPool, getHost, options.renderThreadControls ?? (() => []));
      runtimeRef = runtime;
      await runtime.hydrateThreadMap();
      if (options.warmSpare !== false) containerPool.warmSpareInBackground();
      return runtime;
    } catch (error) {
      await release();
      throw error;
    }
  }

  private lastUsedModel?: ModelRef;

  private threadIdForConversation(conversationId: ConversationId): string | undefined {
    return this.activeConversationThreadMap.get(conversationId);
  }

  private projectIdForConversation(conversationId: ConversationId): string | undefined {
    return this.threadProjectMap.get(conversationId);
  }

  private async hydrateThreadMap(): Promise<void> {
    const catalog = await this.harness.snapshot(HubThreads, BACKGROUND_CONTEXT);
    this.activeConversationThreadMap.clear();
    this.threadProjectMap.clear();
    for (const thread of catalog?.threads ?? []) {
      this.activeConversationThreadMap.set(thread.durableId, thread.threadId);
      this.threadProjectMap.set(thread.durableId, thread.projectId);
    }
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) listener();
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  sidebarStatus(): HubSidebarStatus {
    return {
      busy: this.busyThreads.size > 0,
      requestingAttention: this.attentionThreads.size > 0,
      runningCount: this.busyThreads.size,
      attentionCount: this.attentionThreads.size,
    };
  }

  clearThreadAttention(threadId: string): void {
    if (this.attentionThreads.delete(threadId)) this.emitStatus();
  }

  private async recordLaunchedWorkspace(workspaceId: string, conversationId: ConversationId): Promise<void> {
    const activeThreadId = this.activeConversationThreadMap.get(conversationId) ?? [...this.busyThreads][0];
    if (!activeThreadId) return;
    await this.harness.commit(async (tx) => {
      const catalog = await tx.doc(HubThreads);
      const record = catalog.threads.find((thread) => thread.threadId === activeThreadId);
      if (!record) return;
      if (!record.launchedWorkspaceIds.includes(workspaceId)) {
        record.launchedWorkspaceIds = [...record.launchedWorkspaceIds, workspaceId];
        record.updatedAt = Date.now();
      }
    }, BACKGROUND_CONTEXT);
    this.emitStatus();
  }

  async listThreads(): Promise<HubThreadSummary[]> {
    const catalog = await this.harness.snapshot(HubThreads, BACKGROUND_CONTEXT);
    const records = [...(catalog?.threads ?? [])].sort((left, right) => right.updatedAt - left.updatedAt);
    return await Promise.all(records.map((record) => this.summarizeRecord(record)));
  }

  private async summarizeRecord(record: HubThreadRecord): Promise<HubThreadSummary> {
    const conversation = await this.harness.conversation(record.durableId, BACKGROUND_CONTEXT);
    const agent = conversation ? await conversation.agent(BACKGROUND_CONTEXT) : undefined;
    const live = await this.harness.snapshot(LiveDoc, record.durableId, BACKGROUND_CONTEXT);
    const busy = Boolean(live?.run || live?.compactions?.length || this.busyThreads.has(record.threadId));
    const containerId = await this.containerPool.getThreadContainerId(record.threadId);
    return {
      threadId: record.threadId,
      title: record.title,
      untitled: record.untitled,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      busy,
      requestingAttention: this.attentionThreads.has(record.threadId),
      launchedWorkspaceIds: record.launchedWorkspaceIds,
      projectId: record.projectId,
      containerId,
      model: agent?.model ? { provider: agent.model.provider, id: agent.model.modelId } : undefined,
      thinkingLevel: agent?.thinkingLevel,
    };
  }

  private async requireRecord(threadId: string): Promise<HubThreadRecord> {
    const catalog = await this.harness.snapshot(HubThreads, BACKGROUND_CONTEXT);
    const record = catalog?.threads.find((thread) => thread.threadId === threadId);
    if (!record) throw new AgentsInTheCloudCoreError("agent_not_found", `Hub thread not found: ${threadId}`);
    return record;
  }

  private async resolveProjectForInstructions(projectId?: string): Promise<{ id: string; name: string } | undefined> {
    if (!projectId) return undefined;
    const projects = await this.getHost().listProjects();
    const matched = projects.find((item) => item.id === projectId);
    return matched ? { id: matched.id, name: matched.name } : undefined;
  }

  async ensureDefaultThread(preferredProjectId?: string): Promise<HubThreadSummary> {
    const threads = await this.listThreads();
    if (preferredProjectId) {
      const matching = threads.find((thread) => thread.projectId === preferredProjectId);
      if (matching) return matching;
      return await this.createThread({ projectId: preferredProjectId });
    }
    if (threads[0]) return threads[0];
    return await this.createThread();
  }

  async createThread(options: { title?: string; projectId?: string; model?: ModelRef; thinkingLevel?: ModelThinkingLevel } = {}): Promise<HubThreadSummary> {
    const defaults = await resolveHubDefaults(this.dataDir);
    const model = options.model ?? defaults.model;
    const thinkingLevel = options.thinkingLevel ?? defaults.thinkingLevel;
    if (model) this.lastUsedModel = model;

    const project = await this.resolveProjectForInstructions(options.projectId);
    const threadId = crypto.randomUUID();
    const now = Date.now();
    const title = options.title?.trim() || hubUntitledTitle;
    const untitled = !options.title?.trim();

    const record = await this.harness.commit(async (tx) => {
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, conversation.id, {
        cwd: "/work",
        instructions: hubInstructionsForProject(project),
        model: model ? { provider: model.provider, modelId: model.id } : undefined,
        thinkingLevel,
      });
      const created: HubThreadRecord = {
        threadId,
        durableId: conversation.id,
        title,
        untitled,
        createdAt: now,
        updatedAt: now,
        launchedWorkspaceIds: [],
      };
      if (project) created.projectId = project.id;
      const catalog = await tx.doc(HubThreads);
      catalog.threads.push(created);
      const copy: HubThreadRecord = { ...created, launchedWorkspaceIds: [...created.launchedWorkspaceIds] };
      return copy;
    }, BACKGROUND_CONTEXT);

    this.activeConversationThreadMap.set(record.durableId, record.threadId);
    this.threadProjectMap.set(record.durableId, record.projectId);
    this.emitStatus();
    return await this.summarizeRecord(record);
  }

  async setThreadProject(threadId: string, projectId: string | null): Promise<HubThreadSummary> {
    const project = projectId ? await this.resolveProjectForInstructions(projectId) : undefined;
    if (projectId && !project) {
      throw new AgentsInTheCloudCoreError("invalid_arguments", `Project not found: ${projectId}`);
    }
    const updated = await this.harness.commit(async (tx) => {
      const catalog = await tx.doc(HubThreads);
      const record = catalog.threads.find((item) => item.threadId === threadId);
      if (!record) throw new AgentsInTheCloudCoreError("agent_not_found", `Hub thread not found: ${threadId}`);
      if (project) record.projectId = project.id;
      else delete record.projectId;
      record.updatedAt = Date.now();
      await configure(tx, record.durableId, {
        instructions: hubInstructionsForProject(project),
      });
      return { ...record, launchedWorkspaceIds: [...record.launchedWorkspaceIds] };
    }, BACKGROUND_CONTEXT);
    this.threadProjectMap.set(updated.durableId, updated.projectId);
    this.emitStatus();
    return await this.summarizeRecord(updated);
  }

  async getThread(threadId: string): Promise<HubThreadSnapshot> {
    const record = await this.requireRecord(threadId);
    const presentation = await this.presentationFor(record);
    const summary = await this.summarizeRecord(record);
    return {
      summary,
      items: presentation.currentItems,
      modelContext: presentation.currentModelContext,
      ctx: presentation.currentCtx,
    };
  }

  private presentationFor(record: HubThreadRecord): Promise<HubThreadPresentation> {
    let pending = this.presentations.get(record.threadId);
    if (!pending) {
      pending = (async () => {
        const conversation = await this.harness.conversation(record.durableId, BACKGROUND_CONTEXT);
        if (!conversation) throw new AgentsInTheCloudCoreError("agent_not_found", `Hub conversation missing for thread: ${record.threadId}`);
        return await HubThreadPresentation.attach(
          conversation,
          record.threadId,
          (busy) => this.renderThreadControls(record.threadId, busy),
          (busy) => {
            const wasBusy = this.busyThreads.has(record.threadId);
            if (busy) {
              this.busyThreads.add(record.threadId);
              this.attentionThreads.delete(record.threadId);
            } else {
              this.busyThreads.delete(record.threadId);
              if (wasBusy) this.attentionThreads.add(record.threadId);
            }
            if (wasBusy !== busy) this.emitStatus();
          },
        );
      })().catch((error) => {
        this.presentations.delete(record.threadId);
        throw error;
      });
      this.presentations.set(record.threadId, pending);
    }
    return pending;
  }

  async subscribeThread(threadId: string, listener: (html: string) => void, shown?: LiveRegionDigests): Promise<LiveSubscription> {
    const record = await this.requireRecord(threadId);
    const presentation = await this.presentationFor(record);
    return presentation.subscribe(listener, shown);
  }

  async detailFrame(threadId: string, key: string): Promise<string | undefined> {
    const record = await this.requireRecord(threadId);
    const presentation = await this.presentationFor(record);
    return presentation.detailFrame(key);
  }

  async sendMessage(threadId: string, text: string, whenBusy: "followUp" | "steer" = "followUp"): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new AgentsInTheCloudCoreError("invalid_arguments", "Enter a prompt");
    const record = await this.requireRecord(threadId);
    await this.presentationFor(record);
    const conversation = await this.harness.conversation(record.durableId, BACKGROUND_CONTEXT);
    if (!conversation) throw new AgentsInTheCloudCoreError("agent_not_found", `Hub conversation missing: ${threadId}`);

    const agent = await conversation.agent(BACKGROUND_CONTEXT);
    if (!agent.model) {
      const defaults = await resolveHubDefaults(this.dataDir);
      if (!defaults.model) throw new AgentsInTheCloudCoreError("invalid_arguments", "Connect a model in Models before messaging Hub");
      await this.configureThread(threadId, { model: defaults.model, thinkingLevel: defaults.thinkingLevel });
    } else {
      this.lastUsedModel = { provider: agent.model.provider, id: agent.model.modelId };
    }

    this.attentionThreads.delete(threadId);
    await this.harness.commit(async (tx) => {
      const catalog = await tx.doc(HubThreads);
      const target = catalog.threads.find((item) => item.threadId === threadId);
      if (target) target.updatedAt = Date.now();
    }, BACKGROUND_CONTEXT);

    await conversation.submit({
      type: "input",
      requestId: crypto.randomUUID(),
      content: [{ type: "text", text: trimmed }],
      whenBusy,
    }, BACKGROUND_CONTEXT);

    if (record.untitled && !this.naming.has(threadId)) {
      this.naming.add(threadId);
      void this.autoNameThread(threadId, trimmed, this.lastUsedModel).finally(() => { this.naming.delete(threadId); });
    }
    this.emitStatus();
  }

  private async autoNameThread(threadId: string, prompt: string, model?: ModelRef): Promise<void> {
    try {
      const slug = await suggestAgentSlug(prompt, model);
      if (!slug) return;
      await this.harness.commit(async (tx) => {
        const catalog = await tx.doc(HubThreads);
        const record = catalog.threads.find((item) => item.threadId === threadId);
        if (record && record.untitled) {
          record.title = slug;
          record.untitled = false;
        }
      }, BACKGROUND_CONTEXT);
      this.emitStatus();
    } catch (error) {
      console.error(`Could not name Hub thread ${threadId}`, error);
    }
  }

  async stopThread(threadId: string): Promise<void> {
    const record = await this.requireRecord(threadId);
    await this.harness.commit(async (tx) => {
      const inbox = await tx.doc(InboxDoc, record.durableId);
      for (const item of inbox.items) tx.settleSubmission(item.id, { status: "unanswered", reason: "aborted" });
      inbox.items = [];
    }, BACKGROUND_CONTEXT);
    const { tasks } = await this.harness.inspect(BACKGROUND_CONTEXT);
    const liveTaskIds = tasks
      .filter((task) => task.record.conversationId === record.durableId && task.record.state.status !== "terminal")
      .map((task) => task.record.id);
    await Promise.all(liveTaskIds.map((id) => this.harness.abortTask(id, BACKGROUND_CONTEXT)));
    this.busyThreads.delete(threadId);
    this.emitStatus();
  }

  async configureThread(threadId: string, options: { model?: ModelRef; modelRef?: string; thinkingLevel?: string }): Promise<HubThreadSummary> {
    const record = await this.requireRecord(threadId);
    const parsedModel = options.model ?? (options.modelRef !== undefined ? parseModelRef(options.modelRef) : undefined);
    if (options.modelRef !== undefined && !parsedModel) {
      throw new AgentsInTheCloudCoreError("invalid_arguments", `Invalid model reference: ${options.modelRef}`);
    }
    let parsedThinking: ModelThinkingLevel | undefined;
    if (options.thinkingLevel !== undefined) {
      if (!Value.Check(thinkingLevelSchema, options.thinkingLevel)) {
        throw new AgentsInTheCloudCoreError("invalid_arguments", `Invalid thinking level: ${options.thinkingLevel}`);
      }
      parsedThinking = options.thinkingLevel;
    }
    await this.harness.commit(async (tx) => {
      if (parsedModel && parsedThinking) {
        await configure(tx, record.durableId, { model: { provider: parsedModel.provider, modelId: parsedModel.id }, thinkingLevel: parsedThinking });
      } else if (parsedModel) {
        await configure(tx, record.durableId, { model: { provider: parsedModel.provider, modelId: parsedModel.id } });
      } else if (parsedThinking) {
        await configure(tx, record.durableId, { thinkingLevel: parsedThinking });
      }
    }, BACKGROUND_CONTEXT);
    if (parsedModel) {
      this.lastUsedModel = parsedModel;
      await saveHubPreferences({ model: modelRefValue(parsedModel) }, this.dataDir);
    }
    if (parsedThinking) {
      await saveHubPreferences({ thinkingLevel: parsedThinking }, this.dataDir);
    }
    this.emitStatus();
    return await this.summarizeRecord(record);
  }

  async renameThread(threadId: string, title: string): Promise<HubThreadSummary> {
    const trimmed = title.trim();
    if (!trimmed) throw new AgentsInTheCloudCoreError("invalid_arguments", "Thread title cannot be empty");
    const updated = await this.harness.commit(async (tx) => {
      const catalog = await tx.doc(HubThreads);
      const record = catalog.threads.find((item) => item.threadId === threadId);
      if (!record) throw new AgentsInTheCloudCoreError("agent_not_found", `Hub thread not found: ${threadId}`);
      record.title = trimmed;
      record.untitled = false;
      record.updatedAt = Date.now();
      return { ...record, launchedWorkspaceIds: [...record.launchedWorkspaceIds] };
    }, BACKGROUND_CONTEXT);
    this.emitStatus();
    return await this.summarizeRecord(updated);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.stopThread(threadId);
    const presentation = this.presentations.get(threadId);
    this.presentations.delete(threadId);
    if (presentation) (await presentation).dispose();
    const removed = await this.harness.commit(async (tx) => {
      const catalog = await tx.doc(HubThreads);
      const found = catalog.threads.find((item) => item.threadId === threadId);
      catalog.threads = catalog.threads.filter((item) => item.threadId !== threadId);
      return found ? { durableId: found.durableId } : undefined;
    }, BACKGROUND_CONTEXT);
    if (removed) {
      this.activeConversationThreadMap.delete(removed.durableId);
      this.threadProjectMap.delete(removed.durableId);
    }
    this.busyThreads.delete(threadId);
    this.attentionThreads.delete(threadId);
    await this.containerPool.releaseThreadContainer(threadId).catch((error) => {
      console.error(`Could not release container for Hub thread ${threadId}`, error);
    });
    this.emitStatus();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.containerPool.dispose();
    const pending = [...this.presentations.values()];
    this.presentations.clear();
    for (const item of await Promise.allSettled(pending)) {
      if (item.status === "fulfilled") item.value.dispose();
    }
    await this.harness.close(BACKGROUND_CONTEXT);
    await this.releaseLock();
  }
}
