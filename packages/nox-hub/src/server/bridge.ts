import type { AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import type { AgentSendMessageResult, ControlledAgentSummary } from "@agents-in-the-cloud/agent/server";
import type { TranscriptItem } from "@agents-in-the-cloud/agent/server/transcript";

export interface HubProjectSummary {
  id: string;
  name: string;
  templateIds: readonly string[];
  workspaceIds: readonly string[];
}

export interface HubTemplateSummary {
  id: string;
  title: string;
  url: string;
  branch?: string;
  swatchColor?: string;
  projectId?: string;
}

export type HubWorkspaceState =
  | "provisioning"
  | "setup_failed"
  | "waiting_confirmation"
  | "deleting"
  | "parked"
  | "attention"
  | "running"
  | "idle";

export interface HubWorkspaceSummary {
  id: string;
  title: string;
  url: string;
  state: HubWorkspaceState;
  parked: boolean;
  busy: boolean;
  requestingAttention: boolean;
  provisioningError?: string;
  template?: { id: string; title: string; swatchColor?: string };
  projectId?: string;
  lastActivityAt?: number;
  attentionAt?: number;
  agents?: readonly ControlledAgentSummary[];
}

export interface HubCreateWorkspaceOptions {
  prompt?: string;
  title?: string;
  template?: string;
  projectId?: string;
  agentTypeId?: string;
  model?: string;
  thinkingLevel?: string;
}

export interface HubCreatedWorkspace {
  id: string;
  title: string;
  url: string;
  agentTypeId: string;
  state: HubWorkspaceState;
}

export interface HubWaitOptions {
  workspaceIds: readonly string[];
  mode: "any" | "all";
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HubWaitResult {
  timedOut: boolean;
  settledIds: string[];
  workspaces: HubWorkspaceSummary[];
}

export interface HubHostBridge {
  readonly events?: AgentsInTheCloudEventBus;
  listProjects(): Promise<HubProjectSummary[]>;
  listTemplates(options?: { projectId?: string }): Promise<HubTemplateSummary[]>;
  listWorkspaces(options?: { includeParked?: boolean; template?: string; state?: HubWorkspaceState; projectId?: string }): Promise<HubWorkspaceSummary[]>;
  getWorkspace(workspaceId: string): Promise<HubWorkspaceSummary>;
  createWorkspace(options: HubCreateWorkspaceOptions): Promise<HubCreatedWorkspace>;
  parkWorkspace(workspaceId: string, parked: boolean): Promise<HubWorkspaceSummary>;
  listAgents(workspaceId: string): Promise<ControlledAgentSummary[]>;
  readTranscript(workspaceId: string, agentId?: string): Promise<{ agent: ControlledAgentSummary; items: readonly TranscriptItem[] }>;
  sendMessage(workspaceId: string, options: {
    text: string;
    agentId?: string;
    whenBusy?: "followUp" | "steer";
    unpark?: boolean;
  }): Promise<AgentSendMessageResult>;
  stopAgent(workspaceId: string, agentId?: string): Promise<ControlledAgentSummary>;
  waitForWorkspaces(options: HubWaitOptions): Promise<HubWaitResult>;
  renderHubPage(html: string): Promise<Response>;
}

let currentHost: HubHostBridge | undefined;

export function configureHubHost(host: HubHostBridge | undefined): void {
  currentHost = host;
}

export function hubHost(): HubHostBridge {
  if (!currentHost) throw new Error("Hub host bridge is not configured");
  return currentHost;
}
