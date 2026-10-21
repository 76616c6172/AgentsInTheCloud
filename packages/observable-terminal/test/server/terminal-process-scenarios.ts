import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalProcesses, terminalProcessSession, type RunTerminalProcessCommand, type TerminalProcesses } from "../../src/server/terminal-process.ts";

/** Where the processes run. Every command it runs must reach the tmux server in `tmuxDirectory`. */
export interface TerminalProcessPlace {
  run: RunTerminalProcessCommand;
  close(): Promise<void>;
}

/**
 * Commands for the place's own tmux server, never the one the tests themselves may run in.
 * tmux silently falls back to /tmp when TMUX_TMPDIR does not exist, so it must.
 */
export function isolatedTmuxEnvironment(tmuxDirectory: string) {
  return { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: tmuxDirectory };
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
    let tmuxDirectory = "";
    let place: TerminalProcessPlace | undefined;
    let processes: TerminalProcesses;
    let isolated = false;
    const started: string[] = [];

    async function tmux(...args: string[]): Promise<{ exitCode: number; stdout: string }> {
      const result = await place!.run({ argv: ["tmux", ...args], user: "agents-in-the-cloud", workdir: "/" }, {});
      return { exitCode: result.exitCode, stdout: result.stdout.toString() };
    }

    function start(command: string, options: { env?: Record<string, string>; cwd?: string; cols?: number; rows?: number } = {}) {
      const id = crypto.randomUUID();
      started.push(id);
      return { id, started: processes.start({ id, command, cwd: options.cwd ?? directory, ...options }) };
    }

    async function until(condition: () => Promise<boolean>): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await condition()) return;
        await Bun.sleep(25);
      }
      throw new Error("timed out");
    }

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "terminal-process-"));
      tmuxDirectory = join(directory, "tmux");
      await mkdir(tmuxDirectory);
      place = await open(tmuxDirectory);
      processes = createTerminalProcesses({ run: place.run, root: join(directory, "processes") });
      // Like a workspace's supervised server: terminal processes never start one.
      const keepalive = `keepalive-${crypto.randomUUID()}`;
      expect((await tmux("new-session", "-d", "-s", keepalive)).exitCode).toBe(0);
      const socket = (await tmux("display-message", "-p", "-t", `=${keepalive}`, "#{socket_path}")).stdout.trim();
      if (!socket.startsWith(`${tmuxDirectory}/`)) {
        await tmux("kill-session", "-t", `=${keepalive}`);
        throw new Error(`Tests must use their own tmux server, not ${socket}`);
      }
      isolated = true;
      // Opening a place may build it first.
    }, 120_000);

    afterEach(async () => {
      for (const id of started.splice(0)) await processes.release(id);
    });

    afterAll(async () => {
      // Locally, so the server goes even when the place failed. Both run tmux as this user.
      if (isolated) await Bun.spawn(["tmux", "kill-server"], { env: isolatedTmuxEnvironment(tmuxDirectory), stderr: "ignore" }).exited;
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

    test("reports a running process with its tmux session", async () => {
      const { id, started } = start("sleep 30");
      await started;
      expect(await processes.state(id)).toEqual({ state: "running", session: terminalProcessSession(id) });
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
      expect(result.exitCode).toBe(143);
      // Like any terminal, it shows bash reporting the signal.
      expect(result.output.text).toBe("before\nTerminated");
    });

    test("stopping kills a command that ignores interruption", async () => {
      const { id, started } = start("trap '' TERM; echo stubborn; while :; do sleep 0.1; done");
      await started;
      await processes.stop(id);
      const result = await processes.waitForExit(id);
      expect(result.exitCode).toBe(137);
      expect(result.output.text).toBe("stubborn\nKilled");
    });

    test("stopping a finished process changes nothing", async () => {
      const { id, started } = start("echo done");
      await started;
      const result = await processes.waitForExit(id);
      await processes.stop(id);
      expect(await processes.state(id)).toEqual(result);
    });

    test("releasing a running process kills it and forgets it", async () => {
      const marker = join(directory, `${crypto.randomUUID()}.marker`);
      const { id, started } = start(`sleep 0.5; touch ${marker}`);
      await started;
      await processes.release(id);
      expect(await processes.state(id)).toEqual({ state: "missing" });
      expect((await tmux("has-session", "-t", `=${terminalProcessSession(id)}`)).exitCode).not.toBe(0);
      await Bun.sleep(1000);
      expect(await Bun.file(marker).exists()).toBe(false);
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
      await until(async () => (await processes.state(id)).state === "lost");
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
