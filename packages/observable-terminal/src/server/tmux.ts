import { shellQuote } from "@agents-in-the-cloud/core";

export function buildListSessionsCommand(format = "#S"): string {
  return `tmux list-sessions -F ${shellQuote(format)}`;
}

export function buildKillSessionCommand(session: string): string {
  return `tmux kill-session -t ${shellQuote(session)} 2>/dev/null || true`;
}
