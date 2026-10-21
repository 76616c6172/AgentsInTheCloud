import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCommandSignal } from "@agents-in-the-cloud/core";
import { clearLocalTerminalProcesses, localTerminalProcesses, runLocally } from "../../src/server/local-terminal-processes.ts";
import { runTerminalProcess } from "../../src/server/terminal-process.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await clearLocalTerminalProcesses(directory);
    await rm(directory, { recursive: true, force: true });
  }
});

async function place() {
  const directory = await mkdtemp(join(tmpdir(), "local-terminal-processes-"));
  directories.push(directory);
  const tmux = (...args: string[]) => runLocally(join(directory, "tmux"))({ argv: ["tmux", ...args], user: "agents-in-the-cloud" }, {});
  return { directory, processes: localTerminalProcesses(directory), tmux };
}

test("local terminal processes start a tmux server of their own", async () => {
  const { directory, processes, tmux } = await place();
  const result = await runTerminalProcess(processes, { command: "echo on this machine; exit 3", cwd: directory }, () => {});
  expect(result).toMatchObject({ exitCode: 3, output: { text: "on this machine" } });
  const socket = (await tmux("display-message", "-p", "#{socket_path}")).stdout.toString().trim();
  expect(socket).toStartWith(`${directory}/tmux/`);
});

test("running a terminal process tells its id while it runs, and releases it", async () => {
  const { directory, processes } = await place();
  let running = "";
  const result = await runTerminalProcess(processes, { command: "echo done", cwd: directory }, async (id) => {
    running = id;
    expect((await processes.state(id)).state).toBe("running");
  });
  expect(result.output.text).toBe("done");
  expect(await processes.state(running)).toEqual({ state: "missing" });
});

test("cancelling a terminal process run kills and releases the process", async () => {
  const { directory, processes } = await place();
  const marker = join(directory, "too-late");
  const cancel = new AbortController();
  let running = "";
  const run = withCommandSignal(cancel.signal, () => runTerminalProcess(processes, { command: `sleep 30; touch ${marker}`, cwd: directory }, (id) => {
    running = id;
    cancel.abort(new Error("Preparation cancelled"));
  }));
  await expect(run).rejects.toThrow("Preparation cancelled");
  expect(await processes.state(running)).toEqual({ state: "missing" });
  expect(await Bun.file(marker).exists()).toBe(false);
});

test("clearing forgets every process and stops those still running", async () => {
  const { directory, processes, tmux } = await place();
  const id = crypto.randomUUID();
  await processes.start({ id, command: "sleep 30", cwd: directory });
  await clearLocalTerminalProcesses(directory);
  expect(await processes.state(id)).toEqual({ state: "missing" });
  expect((await tmux("has-session", "-t", `=aitc-process-${id}`)).exitCode).not.toBe(0);
});
