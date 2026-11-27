import { awaitWithContext } from "@earendil-works/chord/context";
import { copyJson, type JsonValue } from "@earendil-works/chord";
import { defineTool, type ConversationId, type ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { hubHost, type HubHostBridge, type HubWorkspaceSummary } from "./bridge.ts";
import { answerTranscriptQuestion, formatTranscriptForHub, latestAssistantSnippet, type TranscriptReadMode } from "./transcript-summary.ts";

export const hubSystemPrompt = `You are Hub — the orbital orchestrator for AgentsInTheCloud.

You coordinate parallel work across isolated container workspaces (threads), and you also have your own isolated container with \`read\`, \`write\`, \`edit\`, and \`bash\` tools when you need to clone or inspect a repository yourself before deciding how to delegate.

Core principles:
- Use \`list_templates\`, \`list_workspaces\`, and \`list_projects\` when you need to discover configured repositories, projects, or existing workspaces before creating new ones.
- When launching parallel tasks, call \`create_workspace\` in parallel — each returns immediately with the workspace's \`id\` and \`url\` while the container boots and starts its agent.
- New workspaces default to \`agent_type: "pi"\`, and you can also target \`"builtin"\`, \`"claude"\`, \`"codex"\`, or other available agent types when requested or appropriate.
- Write clear, self-contained prompts for spawned workspaces: state the goal, relevant context, constraints, and what verification or summary you expect back.
- Use \`wait_for_workspaces\` when the user wants you to monitor dispatched work and report back once tasks settle.
- Use \`read_workspace\` with a focused \`question\` (or default \`mode: "summary"\`) rather than pulling full raw logs unless exact output is needed.
- Always include clickable Markdown links to workspaces using their URL path (for example \`[Fix flaky tests](/workspaces/ws-id)\`) so the user can jump straight in.
- Be concise, direct, and helpful.`;

export function hubInstructionsForProject(project?: { id: string; name: string }): string {
  if (!project) return hubSystemPrompt;
  return `${hubSystemPrompt}\n\n<project_scope>\nThis Hub thread is scoped to project "${project.name}" (id: ${project.id}). All workspace queries, template lookups, workspace creation, messages, and status operations automatically operate only within this project.\n</project_scope>`;
}

function jsonOutput(text: string, details?: JsonValue) {
  const output = [{ type: "text" as const, text }];
  if (details !== undefined) {
    return { output, details: copyJson(details, { omitUndefinedProperties: true }) };
  }
  return { output };
}

export interface HubToolCallbacks {
  getHost?: () => HubHostBridge;
  onWorkspaceCreated?: (workspaceId: string, conversationId: ConversationId) => void | Promise<void>;
  getThreadProjectId?: (conversationId: ConversationId) => string | undefined;
  getPreferredReaderModel?: () => { provider: string; id: string } | undefined;
}

export function createHubTools(callbacks: HubToolCallbacks = {}): ToolRegistration[] {
  const host = () => (callbacks.getHost ?? hubHost)();
  const scopeOf = (conversationId: ConversationId) => callbacks.getThreadProjectId?.(conversationId);

  async function requireWorkspaceInScope(workspaceId: string, conversationId: ConversationId): Promise<HubWorkspaceSummary> {
    const workspace = await host().getWorkspace(workspaceId);
    const projectId = scopeOf(conversationId);
    if (projectId && workspace.projectId !== projectId) {
      throw new Error(`Workspace ${workspaceId} is outside this Hub thread's scoped project.`);
    }
    return workspace;
  }

  const listProjectsTool = defineTool({
    name: "list_projects",
    description: "List configured projects that group templates and workspaces.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute(_args, api) {
      const projectId = scopeOf(api.conversationId);
      const all = await host().listProjects();
      const projects = projectId ? all.filter((item) => item.id === projectId) : all;
      return jsonOutput(JSON.stringify({ projects, scoped_project_id: projectId ?? null }, null, 2));
    },
  });

  const listTemplates = defineTool({
    name: "list_templates",
    description: "List configured repository templates that can be passed to create_workspace.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute(_args, api) {
      const projectId = scopeOf(api.conversationId);
      const templates = await host().listTemplates({ projectId });
      return jsonOutput(JSON.stringify({ templates, scoped_project_id: projectId ?? null }, null, 2));
    },
  });

  const listWorkspaces = defineTool({
    name: "list_workspaces",
    description: "List existing workspaces with their current state (provisioning, running, attention, idle, parked, setup_failed), template, URL, and agents.",
    parameters: Type.Object({
      include_parked: Type.Optional(Type.Boolean({ description: "Include parked workspaces (default: false)." })),
      template: Type.Optional(Type.String({ description: "Filter by template ID or title substring." })),
      project: Type.Optional(Type.String({ description: "Optional project ID filter when this thread is not already scoped to a project." })),
      state: Type.Optional(Type.Union([
        Type.Literal("provisioning"),
        Type.Literal("setup_failed"),
        Type.Literal("waiting_confirmation"),
        Type.Literal("running"),
        Type.Literal("attention"),
        Type.Literal("idle"),
        Type.Literal("parked"),
      ], { description: "Filter by workspace state." })),
    }),
    replay: "safe",
    async execute(args, api) {
      const scopedProjectId = scopeOf(api.conversationId);
      const workspaces = await host().listWorkspaces({
        includeParked: args.include_parked ?? false,
        template: args.template,
        projectId: scopedProjectId ?? args.project,
        state: args.state,
      });
      return jsonOutput(JSON.stringify({ workspaces, scoped_project_id: scopedProjectId ?? null }, null, 2));
    },
  });

  const createWorkspace = defineTool({
    name: "create_workspace",
    description: "Create and boot a new isolated workspace container with an agent and optional initial prompt. Returns immediately with the workspace ID and URL while provisioning runs in the background.",
    parameters: Type.Object({
      prompt: Type.Optional(Type.String({ description: "Initial prompt to send to the workspace's agent once booted." })),
      title: Type.Optional(Type.String({ description: "Short descriptive title for the workspace." })),
      template: Type.Optional(Type.String({ description: "Workspace template ID, title, or Git URL (omit for an empty workspace)." })),
      agent_type: Type.Optional(Type.String({ description: "Agent type to launch in the workspace (default: \"pi\"; also supports \"builtin\", \"claude\", \"codex\", etc.)." })),
      model: Type.Optional(Type.String({ description: "Optional model reference (provider/modelId or provider::modelId)." })),
      thinking_level: Type.Optional(Type.String({ description: "Optional thinking/reasoning level (e.g. low, medium, high)." })),
    }),
    replay: "unsafe",
    async execute(args, api) {
      const scopedProjectId = scopeOf(api.conversationId);
      if (scopedProjectId && args.template?.trim()) {
        const allowed = await host().listTemplates({ projectId: scopedProjectId });
        const needle = args.template.trim().toLowerCase();
        const inProject = allowed.some((item) => item.id === args.template!.trim() || item.title.toLowerCase() === needle || item.url.toLowerCase() === needle);
        if (!inProject) {
          throw new Error(`Template "${args.template}" is not assigned to this Hub thread's scoped project.`);
        }
      }
      const created = await host().createWorkspace({
        prompt: args.prompt,
        title: args.title,
        template: args.template,
        projectId: scopedProjectId,
        agentTypeId: args.agent_type ?? "pi",
        model: args.model,
        thinkingLevel: args.thinking_level,
      });
      await callbacks.onWorkspaceCreated?.(created.id, api.conversationId);
      return jsonOutput(JSON.stringify(created, null, 2), {
        hubCard: {
          kind: "workspace",
          workspaceId: created.id,
          title: created.title,
          url: created.url,
          agentTypeId: created.agentTypeId,
          state: created.state,
        },
      });
    },
  });

  const getWorkspaceStatus = defineTool({
    name: "get_workspace_status",
    description: "Inspect a workspace's live phase, agents, busy/attention state, provisioning errors, and latest assistant message snippet.",
    parameters: Type.Object({
      workspace_id: Type.String({ minLength: 1, description: "Target workspace ID." }),
    }),
    replay: "safe",
    async execute(args, api) {
      const workspace = await requireWorkspaceInScope(args.workspace_id, api.conversationId);
      let latestSnippet: string | undefined;
      if (!workspace.parked && workspace.state !== "provisioning" && workspace.state !== "setup_failed") {
        const agents = await host().listAgents(args.workspace_id);
        workspace.agents = agents;
        if (agents[0]) {
          const { items } = await host().readTranscript(args.workspace_id, agents[0].id);
          latestSnippet = latestAssistantSnippet(items);
        }
      }
      return jsonOutput(JSON.stringify({ workspace, latest_message: latestSnippet ?? null }, null, 2), {
        hubCard: {
          kind: "workspace",
          workspaceId: workspace.id,
          title: workspace.title,
          url: workspace.url,
          state: workspace.state,
        },
      });
    },
  });

  const readWorkspace = defineTool({
    name: "read_workspace",
    description: "Read a workspace agent's transcript. Defaults to a compact summary (user prompts + final answers). Pass `question` to run a focused extraction over the full transcript including tool outputs without bloating context.",
    parameters: Type.Object({
      workspace_id: Type.String({ minLength: 1, description: "Target workspace ID." }),
      agent_id: Type.Optional(Type.String({ description: "Specific agent ID inside the workspace (defaults to the first agent)." })),
      question: Type.Optional(Type.String({ description: "Specific question to answer from the full transcript (runs targeted extraction)." })),
      mode: Type.Optional(Type.Union([
        Type.Literal("summary"),
        Type.Literal("recent"),
        Type.Literal("full"),
      ], { description: "Transcript detail level when `question` is omitted (default: \"summary\")." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Maximum number of recent entries to return." })),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const workspace = await requireWorkspaceInScope(args.workspace_id, api.conversationId);
      const { agent, items } = await host().readTranscript(args.workspace_id, args.agent_id);
      if (args.question?.trim()) {
        const answer = await awaitWithContext(
          answerTranscriptQuestion(items, args.question.trim(), {
            workspaceTitle: workspace.title,
            preferredModel: callbacks.getPreferredReaderModel?.(),
            signal: context.abortSignal,
          }),
          context,
        );
        return jsonOutput(JSON.stringify({
          workspace_id: workspace.id,
          workspace_title: workspace.title,
          url: workspace.url,
          agent,
          question: args.question.trim(),
          answer,
        }, null, 2), {
          hubCard: {
            kind: "workspace",
            workspaceId: workspace.id,
            title: workspace.title,
            url: workspace.url,
            state: workspace.state,
          },
        });
      }
      const mode: TranscriptReadMode = args.mode ?? "summary";
      const formatted = formatTranscriptForHub(items, { mode, limit: args.limit });
      return jsonOutput(JSON.stringify({
        workspace_id: workspace.id,
        workspace_title: workspace.title,
        url: workspace.url,
        state: workspace.state,
        agent,
        mode,
        total_entries: formatted.totalEntries,
        truncated: formatted.truncated,
        transcript: formatted.text,
      }, null, 2), {
        hubCard: {
          kind: "workspace",
          workspaceId: workspace.id,
          title: workspace.title,
          url: workspace.url,
          state: workspace.state,
        },
      });
    },
  });

  const sendWorkspaceMessage = defineTool({
    name: "send_workspace_message",
    description: "Send a follow-up instruction or steering message to an existing workspace's agent (works across Pi, Built-in, Claude, Codex, and other agent types).",
    parameters: Type.Object({
      workspace_id: Type.String({ minLength: 1, description: "Target workspace ID." }),
      message: Type.String({ minLength: 1, description: "Message text to send to the agent." }),
      agent_id: Type.Optional(Type.String({ description: "Specific agent ID inside the workspace (defaults to the first agent)." })),
      when_busy: Type.Optional(Type.Union([
        Type.Literal("followUp"),
        Type.Literal("steer"),
      ], { description: "How to deliver if the agent is currently busy (default: \"followUp\")." })),
      unpark: Type.Optional(Type.Boolean({ description: "Unpark the workspace first if it is currently parked (default: false)." })),
    }),
    replay: "unsafe",
    async execute(args, api) {
      const workspace = await requireWorkspaceInScope(args.workspace_id, api.conversationId);
      const result = await host().sendMessage(args.workspace_id, {
        text: args.message,
        agentId: args.agent_id,
        whenBusy: args.when_busy ?? "followUp",
        unpark: args.unpark ?? false,
      });
      return jsonOutput(JSON.stringify({
        workspace_id: workspace.id,
        workspace_title: workspace.title,
        url: workspace.url,
        ...result,
      }, null, 2), {
        hubCard: {
          kind: "workspace",
          workspaceId: workspace.id,
          title: workspace.title,
          url: workspace.url,
          agentTypeId: result.agentTypeId,
          state: "running",
        },
      });
    },
  });

  const waitForWorkspaces = defineTool({
    name: "wait_for_workspaces",
    description: "Wait until any or all specified workspaces finish their current turn, request attention, or encounter a provisioning failure. Returns status snapshots and latest assistant snippets.",
    parameters: Type.Object({
      workspace_ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Workspace IDs to wait for." }),
      mode: Type.Optional(Type.Union([
        Type.Literal("any"),
        Type.Literal("all"),
      ], { description: "Wait until \"any\" workspace settles or \"all\" settle (default: \"all\")." })),
      timeout_seconds: Type.Optional(Type.Number({ minimum: 5, maximum: 3600, description: "Maximum seconds to wait before returning current states (default: 120)." })),
    }),
    replay: "safe",
    async execute(args, api, context) {
      for (const id of args.workspace_ids) {
        await requireWorkspaceInScope(id, api.conversationId);
      }
      const timeoutMs = Math.min(3_600_000, Math.max(5_000, Math.round((args.timeout_seconds ?? 120) * 1000)));
      const result = await awaitWithContext(
        host().waitForWorkspaces({
          workspaceIds: args.workspace_ids,
          mode: args.mode ?? "all",
          timeoutMs,
          signal: context.abortSignal,
        }),
        context,
      );
      const enriched = await Promise.all(result.workspaces.map(async (workspace) => {
        let latestMessage: string | null = null;
        if (!workspace.parked && workspace.state !== "provisioning" && workspace.state !== "setup_failed") {
          const agents = await host().listAgents(workspace.id);
          if (agents[0]) {
            const { items } = await host().readTranscript(workspace.id, agents[0].id);
            latestMessage = latestAssistantSnippet(items) ?? null;
          }
        }
        return { ...workspace, latest_message: latestMessage };
      }));
      return jsonOutput(JSON.stringify({
        timed_out: result.timedOut,
        settled_ids: result.settledIds,
        workspaces: enriched,
      }, null, 2));
    },
  });

  const parkWorkspace = defineTool({
    name: "park_workspace",
    description: "Park or unpark a workspace.",
    parameters: Type.Object({
      workspace_id: Type.String({ minLength: 1, description: "Target workspace ID." }),
      parked: Type.Boolean({ description: "True to park, false to unpark." }),
    }),
    replay: "unsafe",
    async execute(args, api) {
      await requireWorkspaceInScope(args.workspace_id, api.conversationId);
      const workspace = await host().parkWorkspace(args.workspace_id, args.parked);
      return jsonOutput(JSON.stringify({ workspace }, null, 2));
    },
  });

  return [
    listProjectsTool,
    listTemplates,
    listWorkspaces,
    createWorkspace,
    getWorkspaceStatus,
    readWorkspace,
    sendWorkspaceMessage,
    waitForWorkspaces,
    parkWorkspace,
  ];
}
