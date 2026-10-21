import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StartWorkspaceProcess } from "@agents-in-the-cloud/workspace-helper";
import { createTerminalProcesses, type RunTerminalProcessCommand, type TerminalProcesses } from "../../src/server/terminal-process.ts";

function environment(tmuxDirectory: string, env: Record<string, string> | undefined) {
  return { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: tmuxDirectory, ...env };
}

/**
 * Runs commands here, the way the workspace helper runs them in a workspace,
 * against the tmux server in `tmuxDirectory` rather than the one the tests may
 * themselves run in.
 */
export function runLocally(tmuxDirectory: string): RunTerminalProcessCommand {
  return async (start, options) => {
    const child = Bun.spawn(start.argv, {
      cwd: start.workdir,
      env: environment(tmuxDirectory, start.env),
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout: Buffer.from(stdout), stderr };
  };
}

/** Starts terminal clients here on a PTY, the way the workspace helper starts them, against the same tmux server. */
export function startLocally(tmuxDirectory: string): StartWorkspaceProcess {
  return (start) => {
    if (!start.terminal) throw new Error("Only terminal clients start locally");
    let output!: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const stdout = new ReadableStream<Uint8Array>({ start: (controller) => { output = controller; } });
    const terminal = new Bun.Terminal({
      name: "xterm-256color", ...start.terminal,
      data: (_terminal, data) => { if (!ended) output.enqueue(data); },
    });
    const child = Bun.spawn(start.argv, { cwd: start.workdir, env: environment(tmuxDirectory, start.env), terminal });
    const exited = child.exited.then((exitCode) => {
      ended = true;
      output.close();
      terminal.close();
      return { exitCode };
    });
    return {
      stdout,
      stderr: new ReadableStream({ start: (controller) => controller.close() }),
      exited,
      write: (data) => terminal.write(data),
      closeStdin() {},
      signal: (signal) => child.kill(signal),
      resize: ({ cols, rows }) => {
        terminal.resize(cols, rows);
        // Resizing the PTY alone doesn't tell the client.
        child.kill("SIGWINCH");
      },
      cancel: () => child.kill("SIGHUP"),
    };
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
  const tmuxDirectory = join(directory, "tmux");
  return createTerminalProcesses({ run: runLocally(tmuxDirectory), start: startLocally(tmuxDirectory), root: join(directory, "processes") });
}
