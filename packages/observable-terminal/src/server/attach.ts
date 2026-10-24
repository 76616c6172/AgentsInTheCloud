import { exitStatus, type StartWorkspaceProcess, type WorkspaceExecStart, type WorkspaceHelperUser, type WorkspaceProcess } from "@agents-in-the-cloud/workspace-helper";
import { observableTerminalEnvironment } from "./constants.ts";

export interface ObservableTerminalConnection {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface ObservableTerminalEvents {
  onData(data: Uint8Array): void;
  onExit(exitCode: number, reason?: "session-missing"): void;
}

export interface ObservableTerminalAttachOptions {
  session: string;
  /** Attach only; never start a replacement server for a missing execution. */
  requireExistingServer?: boolean;
  cols: number;
  rows: number;
  readonly?: boolean;
  /** Starts the tmux client, in a workspace or on this machine. */
  start: StartWorkspaceProcess;
  user?: WorkspaceHelperUser;
  workdir?: string;
  /** Report a session that is missing, or ends while attached, as `session-missing` rather than a detach. */
  reportSessionMissing?: boolean;
}

function tmuxAttachArgs(options: Omit<ObservableTerminalAttachOptions, "start">): string[] {
  const args: string[] = options.requireExistingServer ? ["-N"] : [];
  if (!options.readonly) {
    // History belongs to tmux, not the browser terminal. Configure each attachment
    // so new and existing sessions work without caller-specific preparation.
    args.push(
      "set-option", "-t", options.session, "mouse", "on", ";",
      "set-option", "-t", options.session, "set-clipboard", "on", ";",
      "bind-key", "-n", "S-PPage", "copy-mode -e ; send-keys -X page-up", ";",
      "bind-key", "-T", "copy-mode", "S-PPage", "send-keys -X page-up", ";",
      "bind-key", "-T", "copy-mode", "S-NPage", "send-keys -X page-down", ";",
    );
  }
  // Tell tmux that the Gespenst client accepts OSC 8. Pi probes this client
  // feature before emitting file:// hyperlinks; RGB alone is not enough.
  if (!options.readonly) {
    // tmux can check its own options without spawning shells, grep, and more tmux clients.
    args.push("if-shell", "-F", "#{m:*xterm-256color:hyperlinks*,#{terminal-features}}", "", "set-option -gas terminal-features ,xterm-256color:hyperlinks", ";");
    args.push("if-shell", "-F", "#{m:*xterm-256color:clipboard*,#{terminal-features}}", "", "set-option -gas terminal-features ,xterm-256color:clipboard", ";");
  }
  args.push("attach-session");
  if (options.readonly) args.push("-r");
  args.push("-t", options.session);
  return args;
}

export function buildAttachStart(options: Omit<ObservableTerminalAttachOptions, "start">): WorkspaceExecStart {
  return {
    argv: ["tmux", ...tmuxAttachArgs(options)],
    user: options.user ?? "agents-in-the-cloud",
    workdir: options.workdir,
    env: observableTerminalEnvironment,
    terminal: { cols: options.cols, rows: options.rows },
  };
}

/** Whether the session exists, without starting a tmux server. Unexpected tmux failures are errors. */
async function sessionExists(options: ObservableTerminalAttachOptions): Promise<boolean> {
  const check = options.start({
    argv: ["tmux", "-N", "has-session", "-t", `=${options.session}`],
    user: options.user ?? "agents-in-the-cloud",
  });
  const [, diagnostic, exit] = await Promise.all([new Response(check.stdout).arrayBuffer(), new Response(check.stderr).text(), check.exited]);
  const exitCode = exitStatus(exit);
  if (exitCode === 0) return true;
  if (exitCode === 1 && /can't find session:|no server running|error connecting to .*\(No such file or directory\)/.test(diagnostic)) return false;
  throw new Error(diagnostic || `tmux session check failed with exit code ${exitCode}`);
}

export function attachObservableTerminal(options: ObservableTerminalAttachOptions, events: ObservableTerminalEvents): ObservableTerminalConnection {
  let client: WorkspaceProcess | undefined;
  let size = { cols: options.cols, rows: options.rows };
  // Input that arrives while the session check runs, before the client exists.
  const pending: string[] = [];
  let closed = false;
  void (async () => {
    let exitCode = 0;
    let reason: "session-missing" | undefined;
    try {
      // Checking first keeps tmux's own complaint about a missing session off the terminal.
      if (options.reportSessionMissing && !await sessionExists(options)) {
        exitCode = 1;
        reason = "session-missing";
      } else if (!closed) {
        // The helper owns the PTY. If AgentsInTheCloud disappears, the call ends and
        // only this tmux client goes with it, never the session.
        client = options.start(buildAttachStart({ ...options, ...size }));
        for (const data of pending.splice(0)) client.write(data);
        for await (const chunk of client.stdout) events.onData(chunk);
        exitCode = exitStatus(await client.exited);
        // A session that ended while attached is gone, not a detach to reconnect from.
        if (options.reportSessionMissing && !closed && !await sessionExists(options)) reason = "session-missing";
      }
    } catch (error) {
      if (!closed) events.onData(new TextEncoder().encode(`\r\n${(error instanceof Error ? error.message : String(error)).replace(/\r?\n/g, "\r\n")}`));
      exitCode = 1;
    }
    closed = true;
    events.onExit(exitCode, reason);
  })();
  return {
    write: (data) => {
      if (closed) return;
      if (client) client.write(data);
      else pending.push(data);
    },
    resize: (cols, rows) => {
      if (closed) return;
      if (client) client.resize({ cols, rows });
      else size = { cols, rows };
    },
    close: () => {
      if (closed) return;
      closed = true;
      // Hang up this client, never the tmux server or the program in its pane.
      client?.signal("SIGHUP");
    },
  };
}
