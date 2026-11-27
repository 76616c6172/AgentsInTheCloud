import { contentText, type Api, type Model } from "@earendil-works/pi-ai";
import { createPiModelRuntime } from "@agents-in-the-cloud/llm/server";
import type { TranscriptItem, ToolView } from "@agents-in-the-cloud/agent/server/transcript";

export type TranscriptReadMode = "summary" | "recent" | "full";

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function flattenItems(items: readonly TranscriptItem[]): TranscriptItem[] {
  const result: TranscriptItem[] = [];
  for (const item of items) {
    if (item.type === "working") {
      result.push(...flattenItems(item.items));
    } else if (item.type === "inherited-context") {
      continue;
    } else {
      result.push(item);
    }
  }
  return result;
}

function formatToolCall(tool: ToolView, includeResult: boolean): string {
  const argsJson = JSON.stringify(tool.args ?? {});
  const header = `[tool ${tool.name} (${tool.status})] ${clip(argsJson, 300)}`;
  if (!includeResult || !tool.resultText?.trim()) return header;
  return `${header}\nResult:\n${clip(tool.resultText, 1200)}`;
}

export function latestAssistantSnippet(items: readonly TranscriptItem[], maxChars = 420): string | undefined {
  const flat = flattenItems(items);
  for (let index = flat.length - 1; index >= 0; index--) {
    const item = flat[index]!;
    if (item.type === "text" && item.text.trim()) return clip(item.text, maxChars);
    if (item.type === "error" && item.text.trim()) return `Error: ${clip(item.text, maxChars)}`;
  }
  return undefined;
}

export interface FormattedHubTranscript {
  text: string;
  totalEntries: number;
  truncated: boolean;
}

export function formatTranscriptForHub(
  items: readonly TranscriptItem[],
  options: { mode?: TranscriptReadMode; limit?: number; maxChars?: number } = {},
): FormattedHubTranscript {
  const mode = options.mode ?? "summary";
  const maxChars = options.maxChars ?? (mode === "full" ? 32_000 : 12_000);
  const flat = flattenItems(items);
  const entries: string[] = [];

  for (const item of flat) {
    if (item.type === "user") {
      if (item.text.trim()) entries.push(`USER:\n${clip(item.text, mode === "full" ? 4000 : 1500)}`);
    } else if (item.type === "text") {
      if (!item.text.trim()) continue;
      if (mode === "summary" && !item.final) continue;
      entries.push(`ASSISTANT${item.final ? "" : " (intermediate)"}:\n${clip(item.text, mode === "full" ? 8000 : 3000)}`);
    } else if (item.type === "error") {
      entries.push(`ERROR:\n${clip(item.text, 1000)}`);
    } else if (item.type === "tool" && mode !== "summary") {
      entries.push(formatToolCall(item.tool, mode === "full"));
    } else if (item.type === "message" && mode !== "summary") {
      entries.push(`MESSAGE (${item.sender} · ${item.title}):\n${clip(item.bodyMarkdown ?? "", 1000)}`);
    }
  }

  if (mode === "summary" && !entries.some((entry) => entry.startsWith("ASSISTANT"))) {
    const lastText = flat.findLast((item) => item.type === "text" && item.text.trim());
    if (lastText?.type === "text") {
      entries.push(`ASSISTANT (in progress):\n${clip(lastText.text, 3000)}`);
    }
  }

  const limit = options.limit ?? (mode === "recent" ? 20 : entries.length);
  const sliced = limit < entries.length ? entries.slice(-limit) : entries;
  let truncated = sliced.length < entries.length;

  let text = sliced.join("\n\n---\n\n");
  if (text.length > maxChars) {
    text = `…[earlier transcript omitted]\n\n${text.slice(text.length - maxChars)}`;
    truncated = true;
  }

  return { text: text || "(Transcript is currently empty.)", totalEntries: entries.length, truncated };
}

async function pickReaderModel(
  runtime: Awaited<ReturnType<typeof createPiModelRuntime>>,
  preferred?: { provider: string; id: string },
): Promise<Model<Api> | undefined> {
  if (preferred) {
    const direct = runtime.getModel(preferred.provider, preferred.id);
    if (direct && await runtime.getAuth(direct)) return direct;
  }
  const available = await runtime.getAvailable();
  return available.toSorted((left, right) => left.cost.input - right.cost.input)[0];
}

export async function answerTranscriptQuestion(
  items: readonly TranscriptItem[],
  question: string,
  options: { workspaceTitle: string; preferredModel?: { provider: string; id: string }; signal?: AbortSignal },
): Promise<string> {
  const { text } = formatTranscriptForHub(items, { mode: "full", maxChars: 60_000 });
  const runtime = await createPiModelRuntime();
  const model = await pickReaderModel(runtime, options.preferredModel);
  if (!model) return `Could not run question extraction (no model available). Raw summary:\n\n${formatTranscriptForHub(items, { mode: "summary" }).text}`;

  const response = await runtime.completeSimple(
    model,
    {
      systemPrompt: "You extract accurate, concise answers from a coding agent workspace transcript. Cite concrete file paths, commands, test results, and errors directly from the transcript. Never invent details that are not present.",
      messages: [{
        role: "user",
        content: `Workspace: ${options.workspaceTitle}\n\nQuestion: ${question}\n\nTranscript:\n${text}`,
        timestamp: Date.now(),
      }],
    },
    { signal: options.signal },
  );
  return contentText(response.content).trim() || "(No answer extracted from transcript.)";
}
