import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalProcesses, terminalProcessSession, type RunTerminalProcessCommand, type TerminalProcesses, type TerminalProcessState } from "../../src/server/terminal-process.ts";
import { startPrivateTmux } from "../support/local-terminal-processes.ts";

/** Where the processes run. Every command it runs must reach the tmux server in `tmuxDirectory`. */
export interface TerminalProcessPlace {
  run: RunTerminalProcessCommand;
  close(): Promise<void>;
}

/**
 * The rejection's message. Awaiting a helper call through `expect(...).rejects`
 * stalls its gRPC stream under bun test, so these await the promise directly.
 */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("expected a rejection");
}

export function describeTerminalProcesses(name: string, open: (tmuxDirectory: string) => Promise<TerminalProcessPlace>): void {
  describe(name, () => {
    let directory = "";
    let place: TerminalProcessPlace | undefined;
    let tmuxServer: { stop(): Promise<void> } | undefined;
    let processes: TerminalProcesses;
    const started: string[] = [];

    async function tmux(...args: string[]): Promise<{ exitCode: number; stdout: string }> {
      const result = await place!.run({ argv: ["tmux", ...args], user: "agents-in-the-cloud", workdir: "/" }, {});
      return { exitCode: result.exitCode, stdout: result.stdout.toString() };
    }

    function start(command: string, options: { env?: Record<string, string>; cwd?: string; cols?: number; rows?: number; deadline?: number; keepText?: boolean } = {}) {
      const id = crypto.randomUUID();
      started.push(id);
      return { id, started: processes.start({ id, command, cwd: options.cwd ?? directory, ...options }) };
    }

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "terminal-process-"));
      const tmuxDirectory = join(directory, "tmux");
      place = await open(tmuxDirectory);
      tmuxServer = await startPrivateTmux(place.run, tmuxDirectory);
      processes = createTerminalProcesses({ run: place.run, root: join(directory, "processes") });
      // Opening a place may build it first.
    }, 120_000);

    afterEach(async () => {
      for (const id of started.splice(0)) await processes.release(id);
    });

    afterAll(async () => {
      await tmuxServer?.stop();
      await place?.close();
      await rm(directory, { recursive: true, force: true });
    });

    test("records the exit code and the whole scrollback once the command exits", async () => {
      const { id, started } = start("seq 1 500; exit 7");
      await started;
      const result = await processes.waitForExit(id);
      expect(result.exitCode).toBe(7);
      const lines = result.output.text.split("\n");
      expect(lines[0]).toBe("1");
      expect(lines.at(-1)).toBe("500");
      expect(lines).toHaveLength(500);
    });

    test("records all output of a command that exits right after a burst of it", async () => {
      const { id, started } = start("seq 1 50000; exit 4");
      await started;
      const result = await processes.waitForExit(id);
      expect(result.exitCode).toBe(4);
      const lines = result.output.text.split("\n");
      expect(lines).toHaveLength(50000);
      expect(lines.at(-1)).toBe("50000");
    });

    test("runs on a terminal of the requested size, in its directory and environment", async () => {
      const { id, started } = start("stty size; pwd; echo \"$GREETING\"; test -t 0 && echo tty", { cols: 100, rows: 20, env: { GREETING: "hello there" } });
      await started;
      expect((await processes.waitForExit(id)).output.text).toBe(`20 100\n${directory}\nhello there\ntty`);
    });

    test("keeps colors in the ANSI output and leaves them out of the text", async () => {
      const { id, started } = start("printf '\\033[31mred\\033[0m plain\\n'");
      await started;
      const { output } = await processes.waitForExit(id);
      expect(output.ansi).toContain("\u001b[31mred");
      expect(output.text).toBe("red plain");
    });

    test("shows carriage-return progress as its final state", async () => {
      const { id, started } = start("for i in 1 2 3; do printf '\\rprogress %s%%' \"$i\"; done; printf '\\n'");
      await started;
      expect((await processes.waitForExit(id)).output.text).toBe("progress 3%");
    });

    test("reports a running process, in the tmux session named after it", async () => {
      const { id, started } = start("sleep 30");
      await started;
      expect(await processes.state(id)).toEqual({ state: "running" });
      expect((await tmux("has-session", "-t", `=${terminalProcessSession(id)}`)).exitCode).toBe(0);
    });

    test("starting again with the same input does not run the command twice", async () => {
      const counter = join(directory, `${crypto.randomUUID()}.count`);
      const command = `echo run >> ${counter}`;
      const { id, started } = start(command);
      await started;
      await processes.start({ id, command, cwd: directory });
      await processes.waitForExit(id);
      await processes.start({ id, command, cwd: directory });
      expect(await readFile(counter, "utf8")).toBe("run\n");
    });

    test("refuses to reuse an id for different input", async () => {
      const { id, started } = start("sleep 30");
      await started;
      expect(await rejection(processes.start({ id, command: "sleep 31", cwd: directory }))).toContain("already started with different input");
    });

    test("accepts commands larger than one argument may be", async () => {
      const filler = `: ${"x".repeat(300_000)}\n`;
      const { id, started } = start(`${filler}echo done`);
      await started;
      expect((await processes.waitForExit(id)).output.text).toBe("done");
    });

    test("stopping interrupts the command and still records its output", async () => {
      const { id, started } = start("echo before; sleep 30");
      await started;
      await processes.stop(id);
      const result = await processes.waitForExit(id);
      expect(result).toMatchObject({ exitCode: 143, aborted: true, timedOut: false });
      // Like any terminal, it shows bash reporting the signal.
      expect(result.output.text).toBe("before\nTerminated");
    });

    test("stopping kills a command that ignores interruption", async () => {
      const { id, started } = start("trap '' TERM; echo stubborn; while :; do sleep 0.1; done");
      await started;
      await processes.stop(id);
      const result = await processes.waitForExit(id);
      expect(result).toMatchObject({ exitCode: 137, aborted: true, timedOut: false });
      expect(result.output.text).toBe("stubborn\nKilled");
    });

    test("stopping a finished process changes nothing", async () => {
      const { id, started } = start("echo done");
      await started;
      const result = await processes.waitForExit(id);
      await processes.stop(id);
      expect(await processes.state(id)).toEqual(result);
    });

    test("stopping a process before it starts keeps it from starting", async () => {
      const marker = join(directory, `${crypto.randomUUID()}.marker`);
      const id = crypto.randomUUID();
      started.push(id);
      await processes.stop(id);
      const stopped = { state: "exited", exitCode: null, aborted: true, timedOut: false, output: { ansi: "", text: "" } } satisfies TerminalProcessState;
      expect(await processes.state(id)).toEqual(stopped);
      await processes.start({ id, command: `touch ${marker}`, cwd: directory });
      expect(await processes.state(id)).toEqual(stopped);
      // Nothing was launched that could still run it.
      expect((await tmux("has-session", "-t", `=${terminalProcessSession(id)}`)).exitCode).not.toBe(0);
      expect(await Bun.file(marker).exists()).toBe(false);
    });

    test("a deadline interrupts the command where it runs", async () => {
      const { id, started } = start("echo before; sleep 30", { deadline: Date.now() + 500 });
      await started;
      expect((await processes.state(id)).state).toBe("running");
      const result = await processes.waitForExit(id);
      expect(result).toMatchObject({ exitCode: 143, aborted: false, timedOut: true });
      expect(result.output.text).toBe("before\nTerminated");
    });

    test("a deadline kills a command that ignores interruption", async () => {
      const { id, started } = start("trap '' TERM; echo stubborn; while :; do sleep 0.1; done", { deadline: Date.now() + 300 });
      await started;
      expect(await processes.waitForExit(id)).toMatchObject({ exitCode: 137, aborted: false, timedOut: true });
    });

    test("a command whose deadline already passed never runs", async () => {
      const marker = join(directory, `${crypto.randomUUID()}.marker`);
      const { id, started } = start(`touch ${marker}`, { deadline: Date.now() - 1 });
      await started;
      expect(await processes.waitForExit(id)).toMatchObject({ exitCode: null, aborted: false, timedOut: true });
      expect(await Bun.file(marker).exists()).toBe(false);
    });

    test("a command that finishes before its deadline is not timed out", async () => {
      const { id, started } = start("echo quick", { deadline: Date.now() + 30_000 });
      await started;
      const result = await processes.waitForExit(id);
      expect(result).toMatchObject({ exitCode: 0, aborted: false, timedOut: false });
      expect(result.output.text).toBe("quick");
    });

    test("kept plain text holds the whole output and outlives release", async () => {
      const { id, started } = start("printf '\\033[31mred\\033[0m\\n'; seq 1 300", { keepText: true });
      await started;
      await processes.waitForExit(id);
      await processes.release(id);
      const lines = (await readFile(processes.textFile(id), "utf8")).trimEnd().split("\n");
      expect(lines[0]).toBe("red");
      expect(lines.at(-1)).toBe("300");
      expect(lines).toHaveLength(301);
    });

    test("releasing a running process kills it and forgets it", async () => {
      const marker = join(directory, `${crypto.randomUUID()}.marker`);
      // A duration no other process's command line contains.
      const nap = `sleep 30.${crypto.getRandomValues(new Uint32Array(1))[0]}`;
      const { id, started } = start(`${nap}; touch ${marker}`);
      await started;
      await processes.release(id);
      expect(await processes.state(id)).toEqual({ state: "missing" });
      expect((await tmux("has-session", "-t", `=${terminalProcessSession(id)}`)).exitCode).not.toBe(0);
      // No process is left that could still get to the touch.
      expect((await place!.run({ argv: ["pgrep", "-x", "-f", nap], user: "agents-in-the-cloud", workdir: "/" }, {})).exitCode).toBe(1);
    });

    test("releasing a finished process forgets its result", async () => {
      const { id, started } = start("echo done");
      await started;
      await processes.waitForExit(id);
      await processes.release(id);
      expect(await processes.state(id)).toEqual({ state: "missing" });
    });

    test("a process whose terminal disappeared is lost, and is not started again", async () => {
      const { id, started } = start("sleep 30");
      await started;
      await tmux("kill-session", "-t", `=${terminalProcessSession(id)}`);
      expect(await processes.state(id)).toEqual({ state: "lost" });
      await processes.start({ id, command: "sleep 30", cwd: directory });
      expect(await processes.state(id)).toEqual({ state: "lost" });
      expect(await rejection(processes.waitForExit(id))).toBe(`Terminal process ${id} is lost`);
    });

    test("an unknown process is missing", async () => {
      expect(await processes.state(crypto.randomUUID())).toEqual({ state: "missing" });
    });

    test("ids are limited to characters safe for tmux and paths", async () => {
      expect(await rejection(processes.start({ id: "../escape", command: "true", cwd: directory }))).toBe("Invalid terminal process id: ../escape");
      expect(await rejection(processes.state("a:b"))).toBe("Invalid terminal process id: a:b");
    });
  });
}
