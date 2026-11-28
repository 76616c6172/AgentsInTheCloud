import { shellQuote } from "@agents-in-the-cloud/core";
import { cliPromptText, type CliAgentSession } from "@agents-in-the-cloud/cli-agent/server";
import { parseModelRef } from "@agents-in-the-cloud/llm/server";
import type { AgentWorkspaceParameters, WorkspaceAgentInput } from "@agents-in-the-cloud/shared";
import { workspaceRoot } from "@agents-in-the-cloud/workspace";
import { antigravityInstallScript } from "./installation.ts";
import { antigravityPreferencesScriptPath } from "./preferences.ts";
import { antigravityProfile } from "./session.ts";

export function antigravityLaunchScript(input: WorkspaceAgentInput, imagePaths: string[], settings: AgentWorkspaceParameters, session: CliAgentSession, conversationId?: string): string {
  const binary = "/home/agents-in-the-cloud/.antigravity/bin/agy";
  const preferencesScript = antigravityPreferencesScriptPath(session);
  const model = settings.model ? parseModelRef(settings.model)!.id : undefined;
  const variant = model && settings.thinkingLevel ? `${model}-${settings.thinkingLevel}` : model;
  const prompt = cliPromptText(input, imagePaths.map(path => `Read the attached image at ${JSON.stringify(path)}.`));
  const args = ["--gemini_dir", antigravityProfile(session), "--dangerously-skip-permissions",
    ...(variant ? ["--model", variant] : []),
    ...(conversationId ? ["--conversation", conversationId] : []),
    ...(prompt ? ["--prompt-interactive", prompt] : [])];
  return `set -eu
preferences_script=${shellQuote(preferencesScript)}
trap 'code=$?; flock "$HOME/.antigravity-config.lock" node "$preferences_script" sync; if [ "$code" -ne 0 ]; then printf "\\nAntigravity CLI failed (exit %s). See the error above.\\n" "$code"; fi' EXIT
(
  flock 9
  ${antigravityInstallScript(binary)}
) 9> "$HOME/.antigravity-install.lock"
flock "$HOME/.antigravity-config.lock" node "$preferences_script" init
cd ${shellQuote(workspaceRoot)}
${shellQuote(binary)} ${args.map(shellQuote).join(" ")}
`;
}
