import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellQuote } from "@agents-in-the-cloud/core";
import type { StartWorkspaceProcess } from "@agents-in-the-cloud/workspace-helper";
import { attachObservableTerminal, type ObservableTerminalAttachOptions } from "../../src/server/attach.ts";

/** Runs workspace processes locally on pipes, with `path` searched first. Only the workspace helper is a stand-in. */
function localStart(path?: string): StartWorkspaceProcess {
  return (start) => {
    const child = Bun.spawn(start.argv, { env: { ...process.env, PATH: path ? `${path}:${process.env.PATH}` : process.env.PATH }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    return {
      stdout: child.stdout, stderr: child.stderr,
      exited: child.exited.then(exitCode => ({ exitCode })),
      write: (data) => { child.stdin.write(data); },
      closeStdin: () => { child.stdin.end(); },
      signal: (signal) => child.kill(signal),
      resize: () => {},
      cancel: () => child.kill("SIGKILL"),
    };
  };
}

async function attach(options: Omit<ObservableTerminalAttachOptions, "cols" | "rows">) {
  const exited = Promise.withResolvers<{ code: number; reason?: string; output: string }>();
  let output = "";
  const decoder = new TextDecoder();
  const connection = attachObservableTerminal({ cols: 80, rows: 24, ...options }, {
    onData: data => { output += decoder.decode(data, { stream: true }); },
    onExit: (code, reason) => exited.resolve({ code, reason, output }),
  });
  const result = await exited.promise;
  connection.close();
  return result;
}

let directory = "";
let marker = "", end = "", failure = "";
const fixture = { session: "session with spaces", requireExistingServer: true, reportSessionMissing: true };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "terminal-session-"));
  marker = join(directory, "session");
  end = join(directory, "end");
  failure = join(directory, "failure");
  await Bun.write(join(directory, "tmux"), `#!/bin/sh
case "$*" in
  *has-session*)
    test ! -f ${shellQuote(failure)} || { echo 'tmux check failed' >&2; exit 1; }
    test -f ${shellQuote(marker)} || { echo "can't find session: fixture" >&2; exit 1; }
    exit 0
    ;;
  *)
    printf 'FINAL-OUTPUT\\n'
    test ! -f ${shellQuote(end)} || rm ${shellQuote(marker)}
    exit 0
    ;;
esac
`);
  await chmod(join(directory, "tmux"), 0o755);
});
afterAll(() => rm(directory, { recursive: true, force: true }));

test("a missing session is reported before attaching, without printing tmux errors", async () => {
  await rm(marker, { force: true });
  expect(await attach({ ...fixture, start: localStart(directory) })).toEqual({ code: 1, reason: "session-missing", output: "" });
});

test("final output arrives before reporting a session removed while attached", async () => {
  await Bun.write(marker, "exists");
  await Bun.write(end, "end after attach");
  try {
    const result = await attach({ ...fixture, start: localStart(directory) });
    expect(result.reason).toBe("session-missing");
    expect(result.output).toContain("FINAL-OUTPUT");
  } finally { await rm(end, { force: true }); }
});

test("detaching from an existing session remains reconnectable", async () => {
  await Bun.write(marker, "exists");
  const result = await attach({ ...fixture, start: localStart(directory) });
  expect(result.code).toBe(0);
  expect(result.reason).toBeUndefined();
  expect(result.output).toContain("FINAL-OUTPUT");
});

test("unexpected session-check failures remain errors, not ended sessions", async () => {
  await Bun.write(failure, "fail check");
  try {
    const result = await attach({ ...fixture, start: localStart(directory) });
    expect(result.code).not.toBe(0);
    expect(result.reason).toBeUndefined();
    expect(result.output).toContain("tmux check failed");
  } finally { await rm(failure, { force: true }); }
});

test("callers that do not request session detection retain their existing exit behavior", async () => {
  await rm(marker, { force: true });
  const result = await attach({ ...fixture, reportSessionMissing: false, start: localStart(directory) });
  expect(result.code).toBe(0);
  expect(result.reason).toBeUndefined();
  expect(result.output).toContain("FINAL-OUTPUT");
});

test("a missing session on real tmux is reported without starting a replacement server", async () => {
  const socketName = `missing-${crypto.randomUUID()}`;
  expect(await attach({ session: "missing", socketName, requireExistingServer: true, reportSessionMissing: true, start: localStart() })).toEqual({ code: 1, reason: "session-missing", output: "" });
  const server = Bun.spawnSync(["tmux", "-L", socketName, "-N", "list-sessions"], { stderr: "pipe" });
  expect(server.exitCode).not.toBe(0);
});
