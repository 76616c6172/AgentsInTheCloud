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
  /** Epoch milliseconds. Enforced where the process runs, and never extended by starting again. */
  deadline?: number;
  /** Also keep the output as plain text in `textFile(id)`, which outlives `release`. */
  keepText?: boolean;
}

export interface TerminalProcessOutput {
  /** Scrollback and final screen, with colors. */
  ansi: string;
  /** The same, as plain text. */
  text: string;
}

export type TerminalProcessState =
  | { state: "running"; session: string }
  | {
    state: "exited";
    /** Null when the command never ran: it was stopped before it started, or its deadline had passed. */
    exitCode: number | null;
    /** Stopped with `stop`. */
    aborted: boolean;
    /** Stopped at its deadline. */
    timedOut: boolean;
    output: TerminalProcessOutput;
  }
  /** Started, but its terminal disappeared before recording a result, e.g. because tmux was killed. */
  | { state: "lost" }
  /** Never started here, or already released. */
  | { state: "missing" };

export interface TerminalProcesses {
  /**
   * Starts the process in its own tmux session. Starting it again with the same
   * input does nothing, and so does starting a process that was stopped first.
   */
  start(options: TerminalProcessStart): Promise<void>;
  state(id: string): Promise<TerminalProcessState>;
  /** Polls until the process exits; the ambient command signal cancels waiting, not the process. */
  waitForExit(id: string): Promise<Extract<TerminalProcessState, { state: "exited" }>>;
  /**
   * Interrupts the command, killing it if it ignores that, and records it as
   * aborted. Stopping a process that was not started yet keeps it from starting.
   */
  stop(id: string): Promise<void>;
  /**
   * Forgets the process and its result, killing it if it still runs. Release only
   * once the result is stored elsewhere: starting the same id again runs it again.
   */
  release(id: string): Promise<void>;
  /** Where `keepText` keeps the plain-text output. */
  textFile(id: string): string;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const exitPollMs = 250;

export function terminalProcessSession(id: string): string {
  return `aitc-process-${id}`;
}

// The scripts below live in each process's directory. They are POSIX sh, and
// rely only on tmux, flock and pgrep besides.

/**
 * Interrupts a process group led by the wrapper, sparing the wrapper (so it
 * records the result) and the given processes. Members that ignore TERM are
 * killed after a grace period.
 */
const interruptScript = `interrupt() {
  dir=$1
  shift
  leader=$(cat "$dir/pid")
  kill -TERM "-$leader" 2>/dev/null || return 0
  i=0
  while [ ! -f "$dir/exit" ] && [ "$i" -lt 40 ]; do sleep 0.05; i=$((i + 1)); done
  if [ -f "$dir/exit" ]; then return 0; fi
  for member in $(pgrep -g "$leader"); do
    case " $leader $* " in
      *" $member "*) ;;
      *) kill -KILL "$member" 2>/dev/null ;;
    esac
  done
}
`;

/** Started next to the command when it has a deadline; the wrapper kills it once the command exits. */
const watchdogScript = `dir=$1 ms=$2
trap : TERM
sleep "$((ms / 1000)).$(printf '%03d' "$((ms % 1000))")" || exit 0
touch "$dir/timed-out"
. "$dir/interrupt"
interrupt "$dir" $$
`;

/**
 * Runs inside the tmux pane, so the result is recorded even when nobody is
 * connected at the moment the command exits. Handling INT and TERM (rather than
 * ignoring them) keeps the wrapper alive to record the result, while the
 * command itself still receives them with their default behavior.
 */
const wrapperScript = `dir=$1
echo $$ > "$dir/pid"
trap : INT TERM
now() { echo $(($(date +%s%N) / 1000000)); }
code=none
watchdog=
if [ -f "$dir/aborted" ]; then
  :
elif [ -f "$dir/deadline" ] && [ "$(cat "$dir/deadline")" -le "$(now)" ]; then
  touch "$dir/timed-out"
else
  if [ -f "$dir/deadline" ]; then
    # Computed here: the command may finish before a background job could.
    remaining=$(($(cat "$dir/deadline") - $(now)))
    sh "$dir/watchdog" "$dir" "$remaining" &
    watchdog=$!
  fi
  bash -- "$dir/command"
  code=$?
  if [ -n "$watchdog" ]; then
    pkill -KILL -P "$watchdog"
    kill -KILL "$watchdog" 2>/dev/null
    wait "$watchdog" 2>/dev/null
  fi
fi
# Let tmux read the command's last output before capturing it.
sleep 0.05
tmux capture-pane -p -e -J -S - -t "$TMUX_PANE" > "$dir/output"
if [ -f "$dir/keep-text" ]; then tmux capture-pane -p -J -S - -t "$TMUX_PANE" > "$dir.txt"; fi
printf '%s\\n' "$code" > "$dir/exit.tmp"
mv "$dir/exit.tmp" "$dir/exit"
`;

// Starting, stopping and releasing hold a lock on the root, so a stop can't
// slip between claiming an id and launching it. The command arrives on stdin.
const lockRoot = `mkdir -p "$root" || exit 1
exec 9<"$root"
flock 9
`;

const startScript = `root=$1 dir=$2 session=$3 digest=$4 cwd=$5 cols=$6 rows=$7 history=$8 deadline=$9
shift 9
keep=$1 pane=$2
shift 2
${lockRoot}if ! mkdir "$dir" 2>/dev/null; then
  if [ "$(cat "$dir/request" 2>/dev/null)" = "$digest" ]; then exit 0; fi
  # Stopped before it started.
  if [ -f "$dir/aborted" ] && [ ! -f "$dir/request" ]; then exit 0; fi
  echo "Terminal process \${dir##*/} was already started with different input" >&2
  exit 3
fi
printf '%s\\n' "$digest" > "$dir/request"
cat > "$dir/command"
if [ -n "$deadline" ]; then printf '%s\\n' "$deadline" > "$dir/deadline"; fi
if [ "$keep" = 1 ]; then touch "$dir/keep-text"; fi
cat > "$dir/interrupt" <<'INTERRUPT'
${interruptScript}INTERRUPT
cat > "$dir/watchdog" <<'WATCHDOG'
${watchdogScript}WATCHDOG
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
flag() { if [ -f "$dir/$1" ]; then echo 1; else echo 0; fi; }
report() { printf 'exited %s %s %s\\n' "$(cat "$dir/exit")" "$(flag aborted)" "$(flag timed-out)"; cat "$dir/output"; exit 0; }
if [ -f "$dir/exit" ]; then report; fi
if [ ! -d "$dir" ]; then echo missing; exit 0; fi
if tmux -N has-session -t "=$session" 2>/dev/null; then echo running; exit 0; fi
if [ -f "$dir/exit" ]; then report; fi
echo lost
`;

const stopScript = `root=$1 dir=$2 session=$3
${lockRoot}if [ ! -d "$dir" ]; then
  mkdir "$dir"
  touch "$dir/aborted" "$dir/output"
  printf 'none\\n' > "$dir/exit"
  exit 0
fi
if [ -f "$dir/exit" ]; then exit 0; fi
touch "$dir/aborted"
flock -u 9
if ! tmux -N has-session -t "=$session" 2>/dev/null; then exit 0; fi
. "$dir/interrupt"
interrupt "$dir"
`;

// While the session exists its wrapper is alive, so the recorded pid is still its own.
const releaseScript = `root=$1 dir=$2 session=$3
${lockRoot}if tmux -N has-session -t "=$session" 2>/dev/null; then
  kill -KILL "-$(cat "$dir/pid")" 2>/dev/null
  tmux -N kill-session -t "=$session" 2>/dev/null
fi
rm -rf "$dir"
`;

function requestDigest(options: TerminalProcessStart, cols: number, rows: number): string {
  const env = Object.entries(options.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const { command, cwd, deadline, keepText } = options;
  return createHash("sha256").update(JSON.stringify({ command, cwd, env, cols, rows, deadline, keepText })).digest("hex");
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
    const exited = /^exited (\d+|none) ([01]) ([01])$/.exec(header);
    if (!exited) throw new AgentsInTheCloudCoreError("terminal_process_failed", `Unexpected terminal process state: ${header}`);
    return {
      state: "exited",
      exitCode: exited[1] === "none" ? null : Number(exited[1]),
      aborted: exited[2] === "1",
      timedOut: exited[3] === "1",
      output: parseOutput(stdout.slice(newline + 1)),
    };
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
        String(cols), String(rows), String(observableTerminalHistoryLimit), start.deadline === undefined ? "" : String(start.deadline),
        start.keepText ? "1" : "0", pane, ...env,
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
      await sh(stopScript, [options.root, directory(id), terminalProcessSession(id)]);
    },
    async release(id) {
      await sh(releaseScript, [options.root, directory(id), terminalProcessSession(id)]);
    },
    textFile(id) {
      return `${directory(id)}.txt`;
    },
  };
}
