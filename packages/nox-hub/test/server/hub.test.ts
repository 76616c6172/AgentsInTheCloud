import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  clearAgentTypeControls,
  listWorkspaceControlledAgents,
  readWorkspaceAgentTranscript,
  registerAgentTypeControl,
  sendWorkspaceAgentMessage,
} from "@agents-in-the-cloud/agent/server";
import type { TranscriptItem } from "@agents-in-the-cloud/agent/server/transcript";
import {
  createHubTools,
  formatTranscriptForHub,
  HubContainerPool,
  HubRuntime,
  latestAssistantSnippet,
  selectHubDefaultModel,
  selectHubThinkingLevel,
  type HubContainerBackend,
  type HubHostBridge,
  type HubWorkspaceSummary,
} from "../../src/server/index.ts";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  clearAgentTypeControls();
  for (const close of cleanup.splice(0).reverse()) await close();
});

// SAFETY: Hub tool unit tests do not access ToolExecutionApi members.
const dummyToolApi = {} as ToolExecutionApi;

function fakeHostBridge() {
  const created: Array<Parameters<HubHostBridge["createWorkspace"]>[0]> = [];
  const sent: Array<{ workspaceId: string; text: string; whenBusy?: string; unpark?: boolean }> = [];
  const workspaces: HubWorkspaceSummary[] = [
    {
      id: "ws-1",
      title: "Fix flaky tests",
      url: "/workspaces/ws-1",
      state: "idle",
      parked: false,
      busy: false,
      requestingAttention: false,
      template: { id: "tpl-app", title: "app" },
      projectId: "proj-alpha",
    },
    {
      id: "ws-other",
      title: "Other project work",
      url: "/workspaces/ws-other",
      state: "idle",
      parked: false,
      busy: false,
      requestingAttention: false,
      template: { id: "tpl-other", title: "other" },
      projectId: "proj-beta",
    },
  ];
  const sampleItems: TranscriptItem[] = [
    { type: "user", key: "u1", text: "Fix the flaky auth test", images: [] },
    {
      type: "working",
      key: "w1",
      startedAt: 1000,
      completedAt: 2000,
      hasFinalAnswer: true,
      items: [
        { type: "tool", key: "t1", tool: { callId: "c1", name: "bash", args: { command: "bun test" }, status: "ok", resultText: "12 pass, 0 fail" } },
      ],
    },
    { type: "text", key: "a1", text: "Fixed the race condition in auth.test.ts and all 12 tests pass.", final: true },
  ];

  const host: HubHostBridge = {
    async listProjects() {
      return [
        { id: "proj-alpha", name: "Alpha", templateIds: ["tpl-app"], workspaceIds: [] },
        { id: "proj-beta", name: "Beta", templateIds: ["tpl-other"], workspaceIds: [] },
      ];
    },
    async listTemplates(options) {
      const all = [
        { id: "tpl-app", title: "app", url: "https://github.com/example/app.git", branch: "main", projectId: "proj-alpha" },
        { id: "tpl-other", title: "other", url: "https://github.com/example/other.git", branch: "main", projectId: "proj-beta" },
      ];
      return options?.projectId ? all.filter((item) => item.projectId === options.projectId) : all;
    },
    async listWorkspaces(options) {
      return options?.projectId ? workspaces.filter((ws) => ws.projectId === options.projectId) : workspaces;
    },
    async getWorkspace(id) {
      const ws = workspaces.find((item) => item.id === id);
      if (!ws) throw new Error(`Unknown workspace: ${id}`);
      return { ...ws };
    },
    async createWorkspace(options) {
      created.push(options);
      const id = `ws-new-${created.length}`;
      const summary: HubWorkspaceSummary = {
        id,
        title: options.title ?? "Workspace",
        url: `/workspaces/${id}`,
        state: "provisioning",
        parked: false,
        busy: true,
        requestingAttention: false,
      };
      workspaces.push(summary);
      return { id, title: summary.title, url: summary.url, agentTypeId: options.agentTypeId ?? "pi", state: "provisioning" };
    },
    async parkWorkspace(id, parked) {
      const ws = workspaces.find((item) => item.id === id)!;
      ws.parked = parked;
      ws.state = parked ? "parked" : "idle";
      return { ...ws };
    },
    async listAgents() {
      return [{ id: "agent-1", agentTypeId: "pi", title: "Pi CLI" }];
    },
    async readTranscript() {
      return { agent: { id: "agent-1", agentTypeId: "pi", title: "Pi CLI" }, items: sampleItems };
    },
    async sendMessage(workspaceId, options) {
      sent.push({ workspaceId, text: options.text, whenBusy: options.whenBusy, unpark: options.unpark });
      return { agentId: options.agentId ?? "agent-1", agentTypeId: "pi", delivered: "queued" };
    },
    async stopAgent() {
      return { id: "agent-1", agentTypeId: "pi", title: "Pi CLI" };
    },
    async waitForWorkspaces(options) {
      return { timedOut: false, settledIds: [...options.workspaceIds], workspaces: workspaces.filter((ws) => options.workspaceIds.includes(ws.id)) };
    },
    async renderHubPage(html) { return new Response(html); },
  };
  return { host, created, sent };
}

describe("Hub model selection", () => {
  test("prefers google/gemini-4-neon on high thinking mode by default", () => {
    const options = [
      { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus", selected: true, available: true },
      { provider: "google", id: "gemini-4-neon", name: "Gemini 4 Neon", selected: false, available: true },
    ];
    expect(selectHubDefaultModel(options)).toEqual({ provider: "google", id: "gemini-4-neon" });
    expect(selectHubThinkingLevel(["off", "low", "medium", "high"])).toBe("high");
  });

  test("honors saved user model and thinking preference when available", () => {
    const options = [
      { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus", selected: false, available: true },
      { provider: "google", id: "gemini-4-neon", name: "Gemini 4 Neon", selected: false, available: true },
    ];
    expect(selectHubDefaultModel(options, { provider: "anthropic", id: "claude-opus-5-5" })).toEqual({
      provider: "anthropic",
      id: "claude-opus-5-5",
    });
    expect(selectHubThinkingLevel(["off", "low", "medium", "high"], "medium")).toBe("medium");
  });
});

describe("Cross-agent control registry", () => {
  test("lists, reads, and messages agents uniformly across Pi, Claude, and Builtin", async () => {
    const received: string[] = [];
    registerAgentTypeControl({
      agentTypeId: "pi",
      async list() { return [{ id: "pi-1", agentTypeId: "pi", title: "Pi CLI" }]; },
      async readTranscript() { return [{ type: "text", key: "t1", text: "Pi answer", final: true }]; },
      async sendMessage(_ws, agentId, opts) { received.push(`pi:${agentId}:${opts.text}`); return { agentId, agentTypeId: "pi", delivered: "queued" }; },
    });
    registerAgentTypeControl({
      agentTypeId: "claude",
      async list() { return [{ id: "claude-1", agentTypeId: "claude", title: "Claude Code" }]; },
      async readTranscript() { return [{ type: "text", key: "t2", text: "Claude answer", final: true }]; },
      async sendMessage(_ws, agentId, opts) { received.push(`claude:${agentId}:${opts.text}`); return { agentId, agentTypeId: "claude", delivered: "started" }; },
    });

    const agents = await listWorkspaceControlledAgents("ws-1");
    expect(agents.map((agent) => agent.id)).toEqual(["pi-1", "claude-1"]);

    const claudeTranscript = await readWorkspaceAgentTranscript("ws-1", "claude-1");
    expect(claudeTranscript.agent.agentTypeId).toBe("claude");
    expect(latestAssistantSnippet(claudeTranscript.items)).toBe("Claude answer");

    const res = await sendWorkspaceAgentMessage("ws-1", { agentId: "pi-1", text: "Run tests" });
    expect(res).toEqual({ agentId: "pi-1", agentTypeId: "pi", delivered: "queued" });
    expect(received).toEqual(["pi:pi-1:Run tests"]);
  });
});

describe("Transcript summary and Hub tools", () => {
  test("summary mode strips tool noise while full mode keeps tool calls", () => {
    const items: TranscriptItem[] = [
      { type: "user", key: "u1", text: "Check build", images: [] },
      {
        type: "working",
        key: "w1",
        startedAt: 1,
        completedAt: 2,
        hasFinalAnswer: true,
        items: [
          { type: "tool", key: "t1", tool: { callId: "c1", name: "bash", args: { command: "bun run build" }, status: "ok", resultText: "Built cleanly" } },
        ],
      },
      { type: "text", key: "a1", text: "Build succeeded.", final: true },
    ];
    const summary = formatTranscriptForHub(items, { mode: "summary" });
    expect(summary.text).toContain("Check build");
    expect(summary.text).toContain("Build succeeded.");
    expect(summary.text).not.toContain("bun run build");

    const full = formatTranscriptForHub(items, { mode: "full" });
    expect(full.text).toContain("bun run build");
    expect(full.text).toContain("Built cleanly");
  });

  test("create_workspace defaults to pi and other Hub tools round-trip through the bridge", async () => {
    const { host, created, sent } = fakeHostBridge();
    const launched: string[] = [];
    const tools = new Map(createHubTools({
      getHost: () => host,
      onWorkspaceCreated: (id) => { launched.push(id); },
    }).map((tool) => [tool.name, tool]));

    const createResult = await tools.get("create_workspace")!.execute(
      { prompt: "Investigate test flake", title: "Flake hunt", template: "app" },
      dummyToolApi,
      BACKGROUND_CONTEXT,
    );
    expect(created).toEqual([{
      prompt: "Investigate test flake",
      title: "Flake hunt",
      template: "app",
      projectId: undefined,
      agentTypeId: "pi",
      model: undefined,
      thinkingLevel: undefined,
    }]);
    expect(launched).toEqual(["ws-new-1"]);
    const firstCreatePart = createResult.output?.[0];
    const createPayload = JSON.parse(firstCreatePart?.type === "text" ? firstCreatePart.text : "{}");
    expect(createPayload.agentTypeId).toBe("pi");

    await tools.get("send_workspace_message")!.execute(
      { workspace_id: "ws-1", message: "Also check Linux", when_busy: "steer" },
      dummyToolApi,
      BACKGROUND_CONTEXT,
    );
    expect(sent).toEqual([{ workspaceId: "ws-1", text: "Also check Linux", whenBusy: "steer", unpark: false }]);

    const readResult = await tools.get("read_workspace")!.execute(
      { workspace_id: "ws-1" },
      dummyToolApi,
      BACKGROUND_CONTEXT,
    );
    const firstReadPart = readResult.output?.[0];
    const readPayload = JSON.parse(firstReadPart?.type === "text" ? firstReadPart.text : "{}");
    expect(readPayload.transcript).toContain("Fixed the race condition");
  });

  test("project-scoped Hub tools filter queries, assign created workspaces, and block out-of-scope access", async () => {
    const { host, created } = fakeHostBridge();
    const tools = new Map(createHubTools({
      getHost: () => host,
      getThreadProjectId: () => "proj-alpha",
    }).map((tool) => [tool.name, tool]));

    const listed = await tools.get("list_workspaces")!.execute({}, dummyToolApi, BACKGROUND_CONTEXT);
    const listPart = listed.output?.[0];
    const listPayload = JSON.parse(listPart?.type === "text" ? listPart.text : "{}");
    expect(listPayload.workspaces.map((ws: { id: string }) => ws.id)).toEqual(["ws-1"]);

    await tools.get("create_workspace")!.execute(
      { title: "Scoped task", template: "app" },
      dummyToolApi,
      BACKGROUND_CONTEXT,
    );
    expect(created[0]?.projectId).toBe("proj-alpha");

    await expect(
      tools.get("read_workspace")!.execute({ workspace_id: "ws-other" }, dummyToolApi, BACKGROUND_CONTEXT),
    ).rejects.toThrow("outside this Hub thread's scoped project");
    await expect(
      tools.get("send_workspace_message")!.execute({ workspace_id: "ws-other", message: "hi" }, dummyToolApi, BACKGROUND_CONTEXT),
    ).rejects.toThrow("outside this Hub thread's scoped project");
  });
});

describe("HubContainerPool warm-spare lifecycle", () => {
  test("claims pre-warmed spare instantly, replenishes in background, deduplicates parallel claims, and cleans up on delete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nox-hub-pool-test-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const created: string[] = [];
    const deleted: string[] = [];
    const running = new Set<string>();
    const backend: HubContainerBackend = {
      async createContainer(id) { created.push(id); running.add(id); },
      async ensureRunning(id) { running.add(id); },
      async isRunning(id) { return running.has(id); },
      async deleteContainer(id) { deleted.push(id); running.delete(id); },
    };

    const pool = new HubContainerPool(dir, backend, 1);
    cleanup.push(() => pool.dispose());

    const spare = await pool.ensureWarmSpare();
    expect(spare).toBeDefined();
    expect(created).toHaveLength(1);

    const [firstClaim, secondClaim] = await Promise.all([
      pool.ensureThreadContainer("thread-a"),
      pool.ensureThreadContainer("thread-a"),
    ]);
    expect(firstClaim).toBe(spare!);
    expect(secondClaim).toBe(spare!);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(created.length).toBeGreaterThanOrEqual(2);

    const threadBContainer = await pool.ensureThreadContainer("thread-b");
    expect(threadBContainer).not.toBe(firstClaim);

    await pool.releaseThreadContainer("thread-a");
    expect(deleted).toEqual([firstClaim]);
    expect(await pool.getThreadContainerId("thread-a")).toBeUndefined();
  });
});

describe("HubRuntime durable thread persistence", () => {
  test("creates, renames, scopes to project, persists across restart, and deletes threads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nox-hub-test-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const { host } = fakeHostBridge();
    const fakePool = new HubContainerPool(dir, {
      async createContainer() {},
      async ensureRunning() {},
      async isRunning() { return true; },
      async deleteContainer() {},
    }, 0);

    const runtime1 = await HubRuntime.open({ dataDir: dir, getHost: () => host, containerPool: fakePool, warmSpare: false });
    const t1 = await runtime1.createThread({ title: "Orbital plan", projectId: "proj-alpha" });
    expect(t1.projectId).toBe("proj-alpha");
    const t2 = await runtime1.createThread();
    await runtime1.renameThread(t2.threadId, "Parallel CI triage");
    await runtime1.setThreadProject(t2.threadId, "proj-beta");
    expect((await runtime1.listThreads()).map((t) => t.title).sort()).toEqual(["Orbital plan", "Parallel CI triage"]);
    await runtime1.dispose();

    const runtime2 = await HubRuntime.open({ dataDir: dir, getHost: () => host, containerPool: fakePool, warmSpare: false });
    cleanup.push(() => runtime2.dispose());
    const restored = await runtime2.listThreads();
    expect(restored.map((t) => t.title).sort()).toEqual(["Orbital plan", "Parallel CI triage"]);
    expect(restored.find((t) => t.threadId === t1.threadId)?.projectId).toBe("proj-alpha");
    expect(restored.find((t) => t.threadId === t2.threadId)?.projectId).toBe("proj-beta");

    await runtime2.deleteThread(t1.threadId);
    expect((await runtime2.listThreads()).map((t) => t.threadId)).toEqual([t2.threadId]);
  });
});
