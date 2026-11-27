import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import type { TranscriptItem } from "./transcript.ts";

export interface ControlledAgentSummary {
  id: string;
  agentTypeId: string;
  title: string;
}

export interface AgentSendMessageOptions {
  text: string;
  whenBusy?: "followUp" | "steer";
  requestId?: string;
}

export interface AgentSendMessageResult {
  agentId: string;
  agentTypeId: string;
  delivered: "started" | "queued" | "steered" | "sent";
}

export interface AgentTypeControl {
  agentTypeId: string;
  list(workspaceId: string): Promise<readonly ControlledAgentSummary[]>;
  readTranscript(workspaceId: string, agentId: string): Promise<readonly TranscriptItem[]>;
  sendMessage(workspaceId: string, agentId: string, options: AgentSendMessageOptions): Promise<AgentSendMessageResult>;
  stop?(workspaceId: string, agentId: string): Promise<void>;
}

const controls = new Map<string, AgentTypeControl>();

export function registerAgentTypeControl(control: AgentTypeControl): void {
  controls.set(control.agentTypeId, control);
}

export function clearAgentTypeControls(): void {
  controls.clear();
}

export async function listWorkspaceControlledAgents(workspaceId: string): Promise<ControlledAgentSummary[]> {
  const results = await Promise.all([...controls.values()].map((control) => control.list(workspaceId)));
  return results.flat();
}

async function resolveControlledAgent(workspaceId: string, agentId?: string): Promise<{ agent: ControlledAgentSummary; control: AgentTypeControl }> {
  const agents = await listWorkspaceControlledAgents(workspaceId);
  const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : agents[0];
  if (!agent) {
    throw new AgentsInTheCloudCoreError(
      "agent_not_found",
      agentId ? `Agent not found in workspace ${workspaceId}: ${agentId}` : `No agents found in workspace ${workspaceId}`,
    );
  }
  const control = controls.get(agent.agentTypeId);
  if (!control) throw new AgentsInTheCloudCoreError("invalid_arguments", `No control adapter registered for agent type: ${agent.agentTypeId}`);
  return { agent, control };
}

export async function readWorkspaceAgentTranscript(
  workspaceId: string,
  agentId?: string,
): Promise<{ agent: ControlledAgentSummary; items: readonly TranscriptItem[] }> {
  const { agent, control } = await resolveControlledAgent(workspaceId, agentId);
  const items = await control.readTranscript(workspaceId, agent.id);
  return { agent, items };
}

export async function sendWorkspaceAgentMessage(
  workspaceId: string,
  options: AgentSendMessageOptions & { agentId?: string },
): Promise<AgentSendMessageResult> {
  const { agent, control } = await resolveControlledAgent(workspaceId, options.agentId);
  return await control.sendMessage(workspaceId, agent.id, options);
}

export async function stopWorkspaceControlledAgent(workspaceId: string, agentId?: string): Promise<ControlledAgentSummary> {
  const { agent, control } = await resolveControlledAgent(workspaceId, agentId);
  if (!control.stop) throw new AgentsInTheCloudCoreError("invalid_arguments", `Stopping ${agent.agentTypeId} agents is not supported`);
  await control.stop(workspaceId, agent.id);
  return agent;
}
