import { invalidArguments, type JsonObject } from "@agents-in-the-cloud/core";
import { getAgentModelPreference, getAgentModelThinkingLevel, modelRefValue, parseModelRef, renderLaunchModelSettings, renderSharedComposerSelections, setAgentModelPreference, type ComposerModelOption } from "@agents-in-the-cloud/llm/server";
import type { AgentLaunchFooterContext, AgentWorkspaceParameters } from "@agents-in-the-cloud/shared";
import { antigravity, antigravityProvider, antigravitySetupRequired } from "./connection.ts";
import { selectAntigravityModel } from "./models.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";

const settingsSchema = Type.Object({ model: Type.Optional(Type.String()), thinkingLevel: Type.Optional(Type.String()) });

const levels = ["low", "medium", "high", "xhigh", "max"];

async function choices(requestedModel?: string, requestedLevel?: string) {
  const connectedProvider = await antigravity.connected();
  const catalogue = connectedProvider ? await antigravity.models() : [];
  const remembered = await getAgentModelPreference(antigravityProvider);
  const ref = requestedModel ? parseModelRef(requestedModel) : remembered;
  const preferred = ref?.provider === antigravityProvider && catalogue.some(model => model.id === ref.id) ? ref.id : undefined;
  const rememberedLevel = preferred ? await getAgentModelThinkingLevel(antigravityProvider, { provider: antigravityProvider, id: preferred }) : undefined;
  const initial = catalogue.length ? selectAntigravityModel(catalogue, preferred) : undefined;
  const effort = requestedLevel ?? rememberedLevel;
  const selection = initial && effort !== undefined && initial.model.variants[effort] ? selectAntigravityModel(catalogue, initial.model.id, effort) : initial;
  const models: ComposerModelOption[] = catalogue.map(model => ({ provider: antigravityProvider, id: model.id, name: model.name, available: true, selected: selection?.model.id === model.id }));
  return {
    models, connectedProvider, catalogue, selection,
    selectedValue: selection ? modelRefValue({ provider: antigravityProvider, id: selection.model.id }) : "",
    thinkingLevels: selection ? levels.filter(level => selection.model.variants[level]) : [],
    selectedThinkingLevel: selection?.effort ?? "",
  };
}

export const antigravityModelSettings = {
  async renderFooter(context: AgentLaunchFooterContext): Promise<string> {
    const selection = await choices(context.query.get("model") ?? undefined, context.query.get("thinkingLevel") ?? undefined);
    if (context.readOnly) return renderSharedComposerSelections({ ...selection, readOnly: true, modelFormId: "", thinkingLevelFormId: "" });
    return renderLaunchModelSettings({ ...context, ...selection, agentTypeId: antigravityProvider });
  },
  async prepare(parameters: JsonObject = {}): Promise<AgentWorkspaceParameters> {
    if (!Value.Check(settingsSchema, parameters)) throw invalidArguments("Antigravity model and thinking level must be strings.");
    const requestedModel = parameters.model || undefined;
    const requestedLevel = parameters.thinkingLevel || undefined;
    const selection = await choices(requestedModel, requestedLevel);
    if (!selection.connectedProvider) throw antigravitySetupRequired();
    const ref = requestedModel ? parseModelRef(requestedModel) : undefined;
    if (requestedModel && (!ref || ref.provider !== antigravityProvider || !selection.catalogue.some(model => model.id === ref.id))) throw invalidArguments("Choose a model available to your Google Antigravity account.");
    if (requestedLevel && !selection.thinkingLevels.includes(requestedLevel)) throw invalidArguments("This Antigravity model does not support that thinking level.");
    const model = { provider: antigravityProvider, id: selection.selection!.model.id };
    await setAgentModelPreference(antigravityProvider, model, selection.selectedThinkingLevel);
    return { model: modelRefValue(model), thinkingLevel: selection.selectedThinkingLevel || undefined };
  },
};
