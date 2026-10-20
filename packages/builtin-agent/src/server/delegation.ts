import type { Message, Models } from "@earendil-works/pi-ai";
import type { Extension, Harness, ConversationId, ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { AgentTranscriptSnapshot } from "@agents-in-the-cloud/agent/server/transcript-contributions";
import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { listWorkspaceAgents, type WorkspaceAgentInfo } from "./agent-store.ts";

import { configureAgentToolPresentations, type AgentToolPresentation } from "@agents-in-the-cloud/agent/server";
export type { AgentToolPresentation } from "@agents-in-the-cloud/agent/server";

export interface AgentDelegation {
  renderControl(workspaceId: string, agentId: string): Promise<string>;
  create(models: Models, harness: () => Harness): { extension: Extension; models: Models };
  /** The messages a generation request sends, as the extension's request hook prepares them. */
  requestMessages(messages: readonly Message[], conversationId: ConversationId): Message[];
  transcript(view: ConversationView): AgentTranscriptSnapshot;
  attributed(entry: EntryRecord): "task" | "message" | undefined;
  resolveAgent(workspaceId: string, agentId: string): Promise<WorkspaceAgentInfo | undefined>;
  toolPresentations?: ReadonlyMap<string, AgentToolPresentation>;
}

/** One optional native integration, installed before workspace owners open.
 * Execution belongs to the workspace Harness; presentation is passive. */
export let agentDelegation: AgentDelegation | undefined;
export function configureAgentDelegation(delegation: AgentDelegation | undefined): void {
  agentDelegation = delegation;
  configureAgentToolPresentations(delegation?.toolPresentations);
}

export async function resolveAgent(workspaceId: string, agentId: string): Promise<WorkspaceAgentInfo> {
  const root = (await listWorkspaceAgents(workspaceId)).find((agent) => agent.agentId === agentId);
  if (root) return root;
  const child = await agentDelegation?.resolveAgent(workspaceId, agentId);
  if (child) return child;
  throw new AgentsInTheCloudCoreError("agent_not_found", `Agent not found: ${agentId}`);
}
