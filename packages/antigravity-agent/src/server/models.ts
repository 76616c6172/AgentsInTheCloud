export interface AntigravityModel {
  id: string;
  name: string;
  variants: Record<string, string>;
}

export function parseAntigravityModels(output: string): AntigravityModel[] {
  const models = new Map<string, AntigravityModel>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || line === "Fetching available models...") continue;
    const fields = line.split("\t");
    const [variant, label] = fields;
    if (fields.length !== 2 || !variant || !/^[a-z0-9][a-z0-9._-]*$/.test(variant) || !label?.trim()) throw new Error("Antigravity returned an invalid model catalogue.");
    const level = /-(low|medium|high|xhigh|max)$/.exec(variant)?.[1] ?? "";
    const id = level ? variant.slice(0, -level.length - 1) : variant;
    const model = models.get(id) ?? { id, name: level ? label.replace(/ \((?:Low|Medium|High|XHigh|Max)\)$/, "") : label, variants: {} };
    model.variants[level] = variant;
    models.set(id, model);
  }
  if (!models.size) throw new Error("Antigravity did not offer any models for this account.");
  return [...models.values()];
}

export function selectAntigravityModel(models: AntigravityModel[], model?: string, effort?: string) {
  const selected = model ? models.find(candidate => candidate.id === model) : models.find(candidate => candidate.id === "gemini-4-neon") ?? models[0];
  if (!selected) throw new Error("Choose a model available to your Google Antigravity account.");
  const level = effort ?? (selected.variants.medium ? "medium" : Object.keys(selected.variants)[0]!);
  const variant = selected.variants[level];
  if (!variant) throw new Error("This Antigravity model does not support that thinking level.");
  return { model: selected, effort: level, variant };
}
