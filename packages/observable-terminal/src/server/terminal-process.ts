import { createHash } from "node:crypto";
import { AgentsInTheCloudCoreError, commandSignal, invalidArguments, shellQuote } from "@agents-in-the-cloud/core";
import type { WorkspaceExecStart } from "@agents-in-the-cloud/workspace-helper";
import { observableTerminalCols, observableTerminalEnvironment, observableTerminalHistoryLimit, observableTerminalRows } from "./constants.ts";
import { stripTerminalControls } from "./text.ts";

/**
 * Runs one short command to completion where the terminal processes live, such
 * as `runInWorkspace` bound to one workspace.
 */
export type RunTerminalProcessCommand = (
  start: Omit<WorkspaceExecStart, "stdin" | "terminal">,
  options: { stdin?: string },
) => Promise<{ exitCode: number; stdout: Buffer; stderr: string }>;

export interface TerminalProcessStart {
  /** Chosen by the caller, so a retried start finds the same process instead of running it twice. */
  id: string;
  /** A bash script. It runs on the terminal, so it sees a TTY and can be watched live. */
  command: string;
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface TerminalProcessOutput {
  /** Scrollback and final screen, with colors. */
  ansi: string;
  /** The same, as plain text. */
  text: string;
}

export type TerminalProcessState =
  | { state: "running"; session: string }
  | { state: "exited"; exitCode: number; output: TerminalProcessOutput }
  /** Started, but its terminal disappeared before recording a result, e.g. because tmux was killed. */
  | { state: "lost" }
  /** Never started here, or already released. */
  | { state: "missing" };

export interface TerminalProcesses {
  /** Starts the process in its own tmux session. Starting it again with the same input does nothing. */
  start(options: TerminalProcessStart): Promise<void>;
  state(id: string): Promise<TerminalProcessState>;
  /** Polls until the process exits; the ambient command signal cancels waiting, not the process. */
  waitForExit(id: string): Promise<Extract<TerminalProcessState, { state: "exited" }>>;
  /** Interrupts the command. Its exit and final output are still recorded. */
  stop(id: string): Promise<void>;
  /** Forgets the process and its result, killing it if it still runs. */
  release(id: string): Promise<void>;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const exitPollMs = 250;

export function terminalProcessSession(id: string): string {
  return `aitc-process-${id}`;
}

/**
 * Runs inside the tmux pane, so the result is recorded even when nobody is
 * connected at the moment the command exits. Handling INT and TERM (rather than
 * ignoring them) keeps the wrapper alive to record the result, while the
 * command itself still receives them with their default behavior.
 */
const wrapperScript = `dir=$1
echo $$ > "$dir/pid"
trap : INT TERM
bash -- "$dir/command"
code=$?
# Let tmux read the command's last output before capturing it.
sleep 0.05
tmux capture-pane -p -e -J -S - -t "$TMUX_PANE" > "$dir/output"
printf '%s\\n' "$code" > "$dir/exit.tmp"
mv "$dir/exit.tmp" "$dir/exit"
`;

// The command arrives on stdin. mkdir is the atomic claim on the id: the first
// start launches, later ones only compare their input with the first one's.
const startScript = `root=$1 dir=$2 session=$3 digest=$4 cwd=$5 cols=$6 rows=$7 history=$8 pane=$9
shift 9
mkdir -p "$root" || exit 1
if ! mkdir "$dir" 2>/dev/null; then
  if [ "$(cat "$dir/request" 2>/dev/null)" = "$digest" ]; then exit 0; fi
  echo "Terminal process \${dir##*/} was already started with different input" >&2
  exit 3
fi
printf '%s\\n' "$digest" > "$dir/request"
cat > "$dir/command"
cat > "$dir/run" <<'WRAPPER'
${wrapperScript}WRAPPER
if ! tmux -N new-session -d -s "$session" -x "$cols" -y "$rows" -c "$cwd" "$@" "$pane" \\; \\
  set-option -t "=$session:" status off \\; \\
  set-option -t "=$session:" window-size manual \\; \\
  set-option -t "=$session:" history-limit "$history"; then
  rm -rf "$dir"
  exit 1
fi
# Returning only once the wrapper runs makes every started process stoppable.
i=0
while [ ! -f "$dir/pid" ]; do
  i=$((i + 1))
  if [ "$i" -gt 200 ]; then echo "Terminal process \${dir##*/} did not start" >&2; exit 1; fi
  sleep 0.01
done
`;

// Reading the exit before and after checking the session tells a process that
// just finished apart from one whose terminal disappeared.
const stateScript = `dir=$1 session=$2
report() { printf 'exited %s\\n' "$(cat "$dir/exit")"; cat "$dir/output"; exit 0; }
if [ -f "$dir/exit" ]; then report; fi
if [ ! -d "$dir" ]; then echo missing; exit 0; fi
if tmux -N has-session -t "=$session" 2>/dev/null; then echo running; exit 0; fi
if [ -f "$dir/exit" ]; then report; fi
echo lost
`;

// The wrapper is the process group's leader. It survives TERM to record the
// result; members that ignore TERM are killed after a grace period.
const stopScript = `dir=$1 session=$2
if [ -f "$dir/exit" ] || ! tmux -N has-session -t "=$session" 2>/dev/null; then exit 0; fi
pid=$(cat "$dir/pid")
kill -TERM "-$pid" 2>/dev/null || exit 0
i=0
while [ ! -f "$dir/exit" ] && [ "$i" -lt 40 ]; do sleep 0.05; i=$((i + 1)); done
if [ -f "$dir/exit" ]; then exit 0; fi
for member in $(pgrep -g "$pid"); do
  if [ "$member" != "$pid" ]; then kill -KILL "$member" 2>/dev/null; fi
done
`;

// While the session exists its wrapper is alive, so the recorded pid is still its own.
const releaseScript = `dir=$1 session=$2
if tmux -N has-session -t "=$session" 2>/dev/null; then
  kill -KILL "-$(cat "$dir/pid")" 2>/dev/null
  tmux -N kill-session -t "=$session" 2>/dev/null
fi
rm -rf "$dir"
`;

function requestDigest(options: TerminalProcessStart, cols: number, rows: number): string {
  const env = Object.entries(options.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify({ command: options.command, cwd: options.cwd, env, cols, rows })).digest("hex");
}

function parseOutput(ansi: string): TerminalProcessOutput {
  // The capture ends with the final screen's unused rows.
  const trimmed = ansi.replace(/\s+$/, "");
  return { ansi: trimmed, text: stripTerminalControls(trimmed).replace(/\s+$/, "") };
}

/** Terminal processes in one place, such as a workspace, keeping each result until it is released. */
export function createTerminalProcesses(options: { run: RunTerminalProcessCommand; root: string }): TerminalProcesses {
  const directory = (id: string): string => {
    if (!idPattern.test(id)) throw invalidArguments(`Invalid terminal process id: ${id}`);
    return `${options.root}/${id}`;
  };
  const sh = async (script: string, args: string[], stdin?: string): Promise<string> => {
    const result = await options.run({ argv: ["sh", "-c", script, "sh", ...args], user: "agents-in-the-cloud", workdir: "/" }, { stdin });
    if (result.exitCode !== 0) {
      throw new AgentsInTheCloudCoreError("terminal_process_failed", result.stderr.trim() || `Terminal process command failed with exit code ${result.exitCode}`);
    }
    return result.stdout.toString();
  };

  async function state(id: string): Promise<TerminalProcessState> {
    const session = terminalProcessSession(id);
    const stdout = await sh(stateScript, [directory(id), session]);
    const newline = stdout.indexOf("\n");
    const header = newline < 0 ? stdout : stdout.slice(0, newline);
    if (header === "running") return { state: "running", session };
    if (header === "missing" || header === "lost") return { state: header };
    const exited = /^exited (\d+)$/.exec(header);
    if (!exited) throw new AgentsInTheCloudCoreError("terminal_process_failed", `Unexpected terminal process state: ${header}`);
    return { state: "exited", exitCode: Number(exited[1]), output: parseOutput(stdout.slice(newline + 1)) };
  }

  return {
    async start(start) {
      const dir = directory(start.id);
      const cols = start.cols ?? observableTerminalCols;
      const rows = start.rows ?? observableTerminalRows;
      const env = Object.entries({ ...observableTerminalEnvironment, ...start.env }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
      const pane = `exec sh ${shellQuote(`${dir}/run`)} ${shellQuote(dir)}`;
      await sh(startScript, [
        options.root, dir, terminalProcessSession(start.id), requestDigest(start, cols, rows), start.cwd,
        String(cols), String(rows), String(observableTerminalHistoryLimit), pane, ...env,
      ], start.command);
    },
    state,
    async waitForExit(id) {
      const signal = commandSignal();
      for (;;) {
        signal?.throwIfAborted();
        const current = await state(id);
        if (current.state === "exited") return current;
        if (current.state !== "running") throw new AgentsInTheCloudCoreError("terminal_process_failed", `Terminal process ${id} is ${current.state}`);
        await Bun.sleep(exitPollMs);
      }
    },
    async stop(id) {
      await sh(stopScript, [directory(id), terminalProcessSession(id)]);
    },
    async release(id) {
      await sh(releaseScript, [directory(id), terminalProcessSession(id)]);
    },
  };
}
