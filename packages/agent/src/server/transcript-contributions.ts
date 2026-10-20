import type { TranscriptItem } from "./transcript.ts";

export type AgentTranscriptAnchor = {
  anchor: string;
  target: { toolCallId: string } | { entryId: string };
};

/** Declarative data only. The adapter never receives or rewrites host transcript items.
 * Anchors are resolved by the host for snapshots, lazy details and reveal requests;
 * they do not replace live tool/text DOM while it is streaming. */
export interface AgentTranscriptSnapshot {
  /** Messages that reached the Agent, placed by when they arrived. */
  messages: Extract<TranscriptItem, { type: "message" }>[];
  anchors: AgentTranscriptAnchor[];
  /** Entries before this persisted marker are copied context; entries after it are local activity. */
  inheritedContext?: { boundaryEntryId: string; source: string };
}

export function applyTranscriptContributions(items: TranscriptItem[], snapshot: AgentTranscriptSnapshot): TranscriptItem[] {
  const annotate = (items: TranscriptItem[]): TranscriptItem[] => items.map((item) => {
    if (item.type === "working") return { ...item, items: annotate(item.items) };
    const anchor = snapshot.anchors.find(({ target }) => "toolCallId" in target
      ? item.type === "tool" && item.tool.callId === target.toolCallId
      : item.type === "text" && item.final && item.key.startsWith(`${target.entryId}:text:`))?.anchor;
    return anchor ? { ...item, anchor } : item;
  });
  const time = (item: TranscriptItem) => item.timestamp ?? (item.type === "working" ? item.startedAt : 0);
  const result = annotate(items);
  const insert = (items: TranscriptItem[], item: TranscriptItem) => {
    const next = items.findIndex(candidate => time(candidate) > time(item));
    items.splice(next < 0 ? items.length : next, 0, item);
  };
  for (const item of snapshot.messages) {
    // A message that arrives while a turn runs belongs to that turn; annotate already copied its items.
    const next = result.findIndex(candidate => time(candidate) > time(item));
    const previous = result[(next < 0 ? result.length : next) - 1];
    const end = previous?.type === "working" ? previous.completedAt ?? previous.stoppedAt : undefined;
    insert(previous?.type === "working" && (end === undefined || time(item) <= end) ? previous.items : result, item);
  }
  return result;
}
