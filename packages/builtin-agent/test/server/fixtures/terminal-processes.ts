import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTerminalProcesses, type TerminalProcesses } from "@agents-in-the-cloud/observable-terminal/server";

/**
 * Commands for the fixture's own tmux server, never the one the tests may run in.
 * tmux silently falls back to /tmp when TMUX_TMPDIR does not exist, so it must.
 */
function tmuxEnvironment(path: string) {
  return { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: join(path, "tmux") };
}

export async function command(argv: string[], path: string): Promise<string> {
  const child = Bun.spawn(argv, { env: tmuxEnvironment(path), stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`${argv[0]} failed: ${stderr}`);
  return stdout;
}

/** Starts the private server terminal processes expect, like a workspace's supervised one. */
export async function startTmux(path: string): Promise<void> {
  await mkdir(join(path, "tmux"));
  await command(["tmux", "new-session", "-d", "-s", "keeper"], path);
  const socket = (await command(["tmux", "display-message", "-p", "-t", "=keeper", "#{socket_path}"], path)).trim();
  if (!socket.startsWith(join(path, "tmux/"))) throw new Error(`Tests must use their own tmux server, not ${socket}`);
}

export async function stopTmux(path: string): Promise<void> {
  await command(["tmux", "kill-server"], path);
}

/** Terminal processes run locally, as the workspace helper would run them. */
export function localTerminalProcesses(path: string): TerminalProcesses {
  return createTerminalProcesses({
    root: join(path, "processes"),
    async run(start, options) {
      const child = Bun.spawn(start.argv, {
        env: { ...tmuxEnvironment(path), ...start.env },
        stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
      return { exitCode, stdout: Buffer.from(stdout), stderr };
    },
  });
}
