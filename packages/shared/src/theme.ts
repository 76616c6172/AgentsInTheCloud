import { Type } from "typebox";
import { Value } from "typebox/value";

export const agentsInTheCloudThemes = [
  { id: "daylight", label: "Daylight", appearance: "light", background: "#f3f5f9" },
  { id: "cappuccino", label: "Cappuccino", appearance: "dark", background: "#2b2018" },
  { id: "tokyo-night", label: "Tokyo Night", appearance: "dark", background: "#1a1b26" },
  { id: "midnight", label: "Midnight", appearance: "dark", background: "#0d1117" },
  { id: "nord", label: "Nord", appearance: "dark", background: "#2e3440" },
  { id: "nox-oscura", label: "Nox Oscura", appearance: "dark", background: "#131419" },
] as const;

export type AgentsInTheCloudTheme = (typeof agentsInTheCloudThemes)[number]["id"];

export function isAgentsInTheCloudTheme(value: unknown): value is AgentsInTheCloudTheme {
  return agentsInTheCloudThemes.some((theme) => theme.id === value);
}

export function themeAppearance(theme: AgentsInTheCloudTheme): "light" | "dark" {
  return agentsInTheCloudThemes.find(({ id }) => id === theme)!.appearance;
}

const themeSettingsSchema = Type.Object({ theme: Type.Optional(Type.String()) });

export function parseThemeSettings(text: string | undefined, fallback: AgentsInTheCloudTheme): AgentsInTheCloudTheme {
  const settings: unknown = text === undefined ? {} : JSON.parse(text);
  if (!Value.Check(themeSettingsSchema, settings)) throw new Error("Invalid theme settings");
  return isAgentsInTheCloudTheme(settings.theme) ? settings.theme : fallback;
}
