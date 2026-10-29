import { expect, mock, spyOn, test } from "bun:test";
import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { createTerminalProcesses, type RunTerminalProcessCommand } from "../../src/server/terminal-process.ts";

function connection(run: RunTerminalProcessCommand) {
  const start = mock(() => { throw new Error("A failed state check must not start a terminal client"); });
  const processes = createTerminalProcesses({ root: "/tmp/terminal-process-connection", run, start });
  const socket = { send: mock(() => {}), close: mock<(code?: number, reason?: string) => void>(() => {}) };
  return { session: processes.connect("agent", { cols: 80, rows: 24 }), socket, start };
}

test("a reconnect to a stopped workspace closes only that terminal connection", async () => {
  const unavailable = new AgentsInTheCloudCoreError("workspace_unavailable", "Workspace is stopped");
  const { session, socket, start } = connection(async () => { throw unavailable; });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await session.open!(socket);
    expect(socket.close.mock.calls).toEqual([[1011, "Terminal unavailable"]]);
    expect(start).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([["Could not connect to terminal process agent", unavailable]]);
  } finally {
    log.mockRestore();
  }
});

test("a failed state check after disconnect is logged without closing the socket again", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<RunTerminalProcessCommand>>>();
  const unavailable = new Error("Workspace stopped during connection");
  const { session, socket, start } = connection(() => pending.promise);
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const opening = session.open!(socket);
    session.close!(socket);
    pending.reject(unavailable);
    await opening;
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([["Could not connect to terminal process agent", unavailable]]);
  } finally {
    log.mockRestore();
  }
});
