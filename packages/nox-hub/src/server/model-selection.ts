import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { enabledModelOptionViews, type AgentModelOptionView } from "@agents-in-the-cloud/agent/server/model-state";
import { createPiModelRuntime, modelThinkingLevels, parseModelRef, type ModelRef } from "@agents-in-the-cloud/llm/server";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const preferredHubModels: readonly ModelRef[] = [
  { provider: "google", id: "gemini-4-neon" },
];
const preferredHubThinkingLevel: ModelThinkingLevel = "high";

const preferencesSchema = Type.Object({
  model: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(Type.String()),
});
type HubPreferences = Static<typeof preferencesSchema>;

function preferencesPath(dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "hub", "preferences.json");
}

export async function readHubPreferences(dataDir?: string): Promise<HubPreferences> {
  try {
    const raw = await readFile(preferencesPath(dataDir), "utf8");
    return Value.Parse(preferencesSchema, JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function saveHubPreferences(patch: HubPreferences, dataDir?: string): Promise<HubPreferences> {
  const existing = await readHubPreferences(dataDir);
  const next: HubPreferences = { ...existing, ...patch };
  const path = preferencesPath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function isNeonCandidate(option: AgentModelOptionView): boolean {
  if (!option.available) return false;
  if (preferredHubModels.some((ref) => ref.provider === option.provider && ref.id === option.id)) return true;
  return option.id.toLowerCase().includes("gemini-4-neon") || option.id.toLowerCase().includes("neon");
}

export function selectHubDefaultModel(
  options: readonly AgentModelOptionView[],
  savedModel?: ModelRef,
): ModelRef | undefined {
  if (savedModel) {
    const remembered = options.find((option) => option.available && option.provider === savedModel.provider && option.id === savedModel.id);
    if (remembered) return { provider: remembered.provider, id: remembered.id };
  }
  const neon = options.find(isNeonCandidate);
  if (neon) return { provider: neon.provider, id: neon.id };
  const active = options.find((option) => option.available && option.selected);
  if (active) return { provider: active.provider, id: active.id };
  const first = options.find((option) => option.available);
  return first ? { provider: first.provider, id: first.id } : undefined;
}

export function selectHubThinkingLevel(
  levels: readonly ModelThinkingLevel[],
  saved?: string,
): ModelThinkingLevel | undefined {
  if (!levels.length) return undefined;
  const matched = saved ? levels.find((level) => level === saved) : undefined;
  if (matched) return matched;
  if (levels.includes(preferredHubThinkingLevel)) return preferredHubThinkingLevel;
  if (levels.includes("medium")) return "medium";
  return levels[0];
}

export async function resolveHubDefaults(dataDir?: string): Promise<{
  model?: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  models: AgentModelOptionView[];
  thinkingLevels: ModelThinkingLevel[];
}> {
  const runtime = await createPiModelRuntime();
  const prefs = await readHubPreferences(dataDir);
  const savedRef = prefs.model ? parseModelRef(prefs.model) : undefined;
  const rawOptions = await enabledModelOptionViews(savedRef ?? null, runtime);

  // Also check directly in the provider catalog for google/gemini-4-neon in case it's connected
  // even when not toggled on in the enabled-models list.
  let options = rawOptions;
  if (!options.some(isNeonCandidate)) {
    const catalogNeon = runtime.getModel("google", "gemini-4-neon");
    if (catalogNeon && await runtime.getAuth(catalogNeon)) {
      options = [
        { provider: "google", id: "gemini-4-neon", name: catalogNeon.name || "Gemini 4 Neon", selected: false, available: true },
        ...options,
      ];
    }
  }

  const model = selectHubDefaultModel(options, savedRef);
  const thinkingLevels = model ? await modelThinkingLevels(model) : [];
  const thinkingLevel = selectHubThinkingLevel(thinkingLevels, prefs.thinkingLevel);
  const marked = options.map((option) => ({
    ...option,
    selected: model !== undefined && option.provider === model.provider && option.id === model.id,
  }));
  return { model, thinkingLevel, models: marked, thinkingLevels };
}

export async function hubModelOptionsFor(current?: ModelRef | null): Promise<{
  models: AgentModelOptionView[];
  thinkingLevels: ModelThinkingLevel[];
}> {
  const runtime = await createPiModelRuntime();
  let options = await enabledModelOptionViews(current ?? null, runtime);
  if (current && !options.some((option) => option.provider === current.provider && option.id === current.id)) {
    const direct = runtime.getModel(current.provider, current.id);
    if (direct) {
      const available = Boolean(await runtime.getAuth(direct));
      options = [
        { provider: current.provider, id: current.id, name: direct.name || current.id, selected: true, available },
        ...options,
      ];
    }
  } else if (!options.some(isNeonCandidate)) {
    const catalogNeon = runtime.getModel("google", "gemini-4-neon");
    if (catalogNeon && await runtime.getAuth(catalogNeon)) {
      options = [
        { provider: "google", id: "gemini-4-neon", name: catalogNeon.name || "Gemini 4 Neon", selected: false, available: true },
        ...options,
      ];
    }
  }
  const thinkingLevels = current ? await modelThinkingLevels(current) : [];
  return { models: options, thinkingLevels };
}
