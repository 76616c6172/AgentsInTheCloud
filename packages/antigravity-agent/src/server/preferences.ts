import { workspaceRoot } from "@agents-in-the-cloud/workspace";
import type { CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";

export const antigravityOnboardingState = JSON.stringify({
  consumerOnboardingComplete: true,
  enterpriseOnboardingComplete: false,
  onboardingComplete: true,
});

export function antigravityPreferencesScriptPath(session: Pick<CliAgentSession, "directory">): string {
  return `${session.directory}/antigravity-preferences.mjs`;
}

export function antigravityPreferencesScript(): string {
  return `import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const sessionDir = dirname(fileURLToPath(import.meta.url));
const cliDir = join(sessionDir, "gemini", "antigravity-cli");
const sessionSettings = join(cliDir, "settings.json");
const baselineSettings = join(sessionDir, "antigravity-settings-baseline.json");
const sharedDir = join(os.homedir(), ".antigravity");
const sharedSettings = join(sharedDir, "settings.json");
const sessionKeybindings = join(cliDir, "keybindings.json");
const baselineKeybindings = join(sessionDir, "antigravity-keybindings-baseline.json");
const sharedKeybindings = join(sharedDir, "keybindings.json");
const workspace = ${JSON.stringify(workspaceRoot)};
const defaultColorScheme = "terminal";
const mode = process.argv[2];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function readJson(path) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : undefined;
}
function writeAtomic(path, content) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + "." + process.pid;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, path);
}
if (mode === "init") {
  const storedShared = readJson(sharedSettings);
  const shared = storedShared ? { ...storedShared } : {};
  if (!("colorScheme" in shared)) {
    shared.colorScheme = defaultColorScheme;
    writeAtomic(sharedSettings, JSON.stringify(shared, null, 2) + "\\n");
  }
  const existing = readJson(sessionSettings);
  const config = existing ? { ...existing } : { ...shared };
  if (!("colorScheme" in config)) config.colorScheme = defaultColorScheme;
  const trusted = Array.isArray(config.trustedWorkspaces) ? config.trustedWorkspaces : [];
  if (!trusted.includes(workspace)) config.trustedWorkspaces = [...trusted, workspace];
  const serialized = JSON.stringify(config, null, 2) + "\\n";
  writeAtomic(sessionSettings, serialized);
  writeAtomic(baselineSettings, serialized);
  if (!fs.existsSync(sessionKeybindings) && fs.existsSync(sharedKeybindings)) {
    const keybindings = fs.readFileSync(sharedKeybindings, "utf8");
    writeAtomic(sessionKeybindings, keybindings);
    writeAtomic(baselineKeybindings, keybindings);
  }
} else if (mode === "sync") {
  const current = readJson(sessionSettings);
  if (current) {
    const normalizedCurrent = { ...current, colorScheme: current.colorScheme ?? defaultColorScheme };
    const baseline = readJson(baselineSettings) ?? {};
    const updated = Object.keys(normalizedCurrent).filter((key) => JSON.stringify(canonical(normalizedCurrent[key])) !== JSON.stringify(canonical(baseline[key])));
    const removed = Object.keys(baseline).filter((key) => !(key in normalizedCurrent));
    if (updated.length || removed.length) {
      const shared = readJson(sharedSettings) ?? {};
      for (const key of updated) shared[key] = normalizedCurrent[key];
      for (const key of removed) delete shared[key];
      writeAtomic(sharedSettings, JSON.stringify(shared, null, 2) + "\\n");
      writeAtomic(baselineSettings, JSON.stringify(normalizedCurrent, null, 2) + "\\n");
    }
  }
  if (fs.existsSync(sessionKeybindings)) {
    const currentKb = fs.readFileSync(sessionKeybindings, "utf8");
    const baselineKb = fs.existsSync(baselineKeybindings) ? fs.readFileSync(baselineKeybindings, "utf8") : undefined;
    if (currentKb !== baselineKb) {
      writeAtomic(sharedKeybindings, currentKb);
      writeAtomic(baselineKeybindings, currentKb);
    }
  }
}
`;
}
