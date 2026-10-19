import { type AgentTranscriptAnchor, type AgentTranscriptSnapshot } from "@agents-in-the-cloud/agent/server/transcript-contributions";
import type { ConversationView } from "@earendil-works/pi-durable";
import { inheritedBoundaryEntry, communicationEntry, communicationStateEntry, type Receipt } from "./native-state.ts";

export function nativeDelegationTranscript(view: ConversationView): AgentTranscriptSnapshot {
  const incoming = new Map<string, Receipt>();
  const sent: Receipt[] = [];
  for (const entry of view.entries) {
    if (communicationEntry.is(entry)) {
      if (entry.data.direction === "incoming") incoming.set(entry.data.receipt.id, structuredClone(entry.data.receipt));
      else sent.push(entry.data.receipt);
    }
    if (communicationStateEntry.is(entry) && incoming.has(entry.data.id)) Object.assign(incoming.get(entry.data.id)!, entry.data.change);
  }
  const inherited = view.entries.find(inheritedBoundaryEntry.is);
  return { inheritedContext: inherited ? { boundaryEntryId: String(inherited.id), source: inherited.data.source } : undefined, anchors: sent.flatMap<AgentTranscriptAnchor>(receipt => receipt.callId ? [{ anchor: receipt.id, target: { toolCallId: receipt.callId } }]  : receipt.sourceEntry === undefined ? [] : [{ anchor: receipt.id, target: { entryId: String(receipt.sourceEntry) } }]), messages: [...incoming.values()].map(receipt => ({
    type: "message", key: receipt.id, anchor: receipt.id, timestamp: receipt.timestamp,
    sender: receipt.author, title: receipt.kind, bodyMarkdown: receipt.text,
    details: {
      Handling: receipt.handling === "idle-task" ? "Starts a turn" : receipt.handling === "idle-message" ? "Waits for the next turn" : receipt.handling === "waiting" ? "Wakes the agent’s wait" : "Queued for the next model boundary",
      Context: receipt.prepared ? `Prepared as ${receipt.prepared.format} · not a read receipt` : receipt.context === "failed" ? receipt.error! : "Pending model context",
    },
  })) };
}
