import { shellQuote } from "@agents-in-the-cloud/core";
import { observableTerminalEnvironment } from "./constants.ts";

export interface ObservableTerminalSessionOptions {
  session: string;
  /** Workspaces use a supervised server; never auto-start an unmanaged one. */
  requireExistingServer?: boolean;
  socketName?: string;
  cwd: string;
  command: string;
  remainOnExit?: boolean;
  historyLimit?: number;
}

function envPrefix(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
}

/** A tmux session for a terminal someone uses directly, such as System's host terminals. */
export function buildObservableSessionCommand(options: ObservableTerminalSessionOptions): string {
  const target = shellQuote(options.session);
  const flags = ["new-session", "-d", "-s", target];
  for (const [key, value] of Object.entries(observableTerminalEnvironment)) flags.push("-e", shellQuote(`${key}=${value}`));
  flags.push("-c", shellQuote(options.cwd), options.command);
  const commands = [flags.join(" ")];
  if (options.remainOnExit) {
    commands.push(`set-window-option -t ${target} remain-on-exit on`);
    commands.push(`set-window-option -t ${target} remain-on-exit-format ''`);
  }
  commands.push(`set-option -t ${target} status off`);
  if (options.historyLimit) commands.push(`set-option -t ${target} history-limit ${options.historyLimit}`);
  return `${envPrefix(observableTerminalEnvironment)} tmux ${options.requireExistingServer ? "-N " : ""}${options.socketName ? `-L ${shellQuote(options.socketName)} ` : ""}${commands.join(" \\; ")}`;
}

export function buildListSessionsCommand(format = "#S"): string {
  return `tmux list-sessions -F ${shellQuote(format)}`;
}

export function buildKillSessionCommand(session: string): string {
  return `tmux kill-session -t ${shellQuote(session)} 2>/dev/null || true`;
}
