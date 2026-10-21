import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTerminalProcesses, type RunTerminalProcessCommand, type TerminalProcesses } from "../../src/server/terminal-process.ts";

/**
 * Runs commands here, the way the workspace helper runs them in a workspace,
 * against the tmux server in `tmuxDirectory` rather than the one the tests may
 * themselves run in.
 */
export function runLocally(tmuxDirectory: string): RunTerminalProcessCommand {
  return async (start, options) => {
    const child = Bun.spawn(start.argv, {
      cwd: start.workdir,
      env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: tmuxDirectory, ...start.env },
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout: Buffer.from(stdout), stderr };
  };
}

/**
 * Starts a tmux server in `tmuxDirectory` through `run`, like a workspace's
 * supervised one: terminal processes never start a server themselves. tmux
 * silently falls back to /tmp when TMUX_TMPDIR does not exist, so this refuses
 * to go on with any server but its own.
 */
export async function startPrivateTmux(run: RunTerminalProcessCommand, tmuxDirectory: string): Promise<{ stop(): Promise<void> }> {
  await mkdir(tmuxDirectory, { recursive: true });
  const tmux = async (...args: string[]) => {
    const result = await run({ argv: ["tmux", ...args], user: "agents-in-the-cloud", workdir: "/" }, {});
    if (result.exitCode !== 0) throw new Error(`tmux ${args[0]} failed: ${result.stderr}`);
    return result.stdout.toString().trim();
  };
  const keepalive = `keepalive-${crypto.randomUUID()}`;
  await tmux("new-session", "-d", "-s", keepalive);
  const socket = await tmux("display-message", "-p", "-t", `=${keepalive}`, "#{socket_path}");
  if (!socket.startsWith(`${tmuxDirectory}/`)) {
    await tmux("kill-session", "-t", `=${keepalive}`);
    throw new Error(`Tests must use their own tmux server, not ${socket}`);
  }
  // By its socket, so stopping can only ever reach this server.
  return { stop: async () => { await Bun.spawn(["tmux", "-S", socket, "kill-server"], { stderr: "ignore" }).exited; } };
}

/** Terminal processes kept in `directory`, on the tmux server in its `tmux` folder. */
export function terminalProcessesIn(directory: string): TerminalProcesses {
  return createTerminalProcesses({ run: runLocally(join(directory, "tmux")), root: join(directory, "processes") });
}
