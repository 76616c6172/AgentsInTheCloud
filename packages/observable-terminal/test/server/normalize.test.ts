import { describe, expect, test } from "bun:test";
import { buildListSessionsCommand, terminalProcessSession } from "../../src/server/index.ts";
import { normalizeCarriageReturns, stripTerminalControls } from "../../src/server/text.ts";
import { buildAttachStart } from "../../src/server/attach.ts";

describe("observable terminal normalization", () => {
  test("collapses carriage-return progress repaints", () => {
    const raw = "Cloning into 'repo'...\r\nremote: Counting objects:   1% (1/94)\rremote: Counting objects:   2% (2/94)\rremote: Counting objects: 100% (94/94)\r\n";
    const normalized = normalizeCarriageReturns(raw);
    expect(normalized).toBe("Cloning into 'repo'...\nremote: Counting objects: 100% (94/94)\n");
    expect(normalized).not.toContain("1% (1/94)remote:");
  });

  test("strips terminal control sequences without leaking their final bytes", () => {
    expect(stripTerminalControls("\u001b[?1h\u001b=ok\u001b>")).toBe("ok");
    expect(stripTerminalControls("a\u001b[2Kb\u001b[39;49mc")).toBe("abc");
    expect(stripTerminalControls("a\u001b]8;;file:///tmp/x\u001b\\b\u001b]8;;\u001b\\c")).toBe("abc");
    expect(stripTerminalControls("a\u001bPignored\u001b\\b")).toBe("ab");
  });

  test("quotes custom tmux session list formats", () => {
    expect(buildListSessionsCommand("#{session_name} | #{pane_current_path}")).toBe("tmux list-sessions -F '#{session_name} | #{pane_current_path}'");
  });

  test("interactive attachments configure tmux-owned scrollback before attaching", () => {
    const start = buildAttachStart({ session: "s", cols: 80, rows: 24 });
    expect(start.argv).toEqual([
      "tmux",
      "set-option", "-t", "s", "mouse", "on", ";",
      "set-option", "-t", "s", "set-clipboard", "on", ";",
      "bind-key", "-n", "S-PPage", "copy-mode -e ; send-keys -X page-up", ";",
      "bind-key", "-T", "copy-mode", "S-PPage", "send-keys -X page-up", ";",
      "bind-key", "-T", "copy-mode", "S-NPage", "send-keys -X page-down", ";",
      "if-shell", "-F", "#{m:*xterm-256color:hyperlinks*,#{terminal-features}}", "", "set-option -gas terminal-features ,xterm-256color:hyperlinks", ";",
      "if-shell", "-F", "#{m:*xterm-256color:clipboard*,#{terminal-features}}", "", "set-option -gas terminal-features ,xterm-256color:clipboard", ";",
      "attach-session", "-t", "s",
    ]);
  });

  test("read-only attachments do not configure scrollback", () => {
    const start = buildAttachStart({ session: "s", cols: 80, rows: 24, readonly: true });
    expect(start.argv).toEqual(["tmux", "attach-session", "-r", "-t", "s"]);
  });

  test("terminal process viewers attach read-only to the existing server", () => {
    const session = terminalProcessSession(crypto.randomUUID());
    const start = buildAttachStart({ session, cols: 120, rows: 30, readonly: true, requireExistingServer: true });
    expect(start.argv).toEqual(["tmux", "-N", "attach-session", "-r", "-t", session]);
    expect(start.terminal).toEqual({ cols: 120, rows: 30 });
    expect(start.stdin).toBeUndefined();
  });
});

test("interactive attachment setup configures features inside tmux without duplicating them on reconnect", async () => {
  const socketName = `terminal-features-${crypto.randomUUID()}`;
  const run = async (args: string[]) => {
    const process = Bun.spawn(["tmux", "-L", socketName, ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, output, error] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    return output;
  };
  await run(["new-session", "-d", "-s", "shell", "sleep 30"]);
  try {
    const args = buildAttachStart({ session: "shell", cols: 80, rows: 24 }).argv.slice(1);
    const prelude = args.slice(0, args.indexOf("attach-session") - 1);
    await run(prelude);
    const first = await run(["show-options", "-g", "terminal-features"]);
    expect(first).toContain("xterm-256color:hyperlinks");
    expect(first).toContain("xterm-256color:clipboard");
    await run(prelude);
    expect(await run(["show-options", "-g", "terminal-features"])).toBe(first);
  } finally { await run(["kill-server"]); }
});

test("receipt UUID sessions attach read-only without resizing the existing window", async () => {
  const socketName = `agents-in-the-cloud-attach-${crypto.randomUUID()}`;
  const session = `agents-in-the-cloud-agent-${crypto.randomUUID()}`;
  const run = async (args: string[]) => {
    const process = Bun.spawn(["tmux", "-L", socketName, ...args], { stdout: "pipe", stderr: "pipe" });
    return { code: await process.exited, output: await new Response(process.stdout).text(), error: await new Response(process.stderr).text() };
  };
  expect((await run(["new-session", "-d", "-s", session, "-x", "80", "-y", "24", "sleep 30"])).code).toBe(0);
  try {
    const start = buildAttachStart({ session, cols: 120, rows: 30, readonly: true, requireExistingServer: true });
    expect(start.terminal).toEqual({ cols: 120, rows: 30 });
    // Read-only viewers supply their own PTY dimensions, never resize the execution.
    expect(start.argv).toEqual(["tmux", "-N", "attach-session", "-r", "-t", session]);
    expect((await run(["display-message", "-p", "-t", `${session}:`, "#{window_width}x#{window_height}"])).output.trim()).toBe("80x24");
  } finally { await run(["kill-server"]); }
});
