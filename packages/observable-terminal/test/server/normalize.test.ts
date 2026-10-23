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
      "if-shell", "tmux show-options -g terminal-features | grep -Fq 'xterm-256color:hyperlinks'", "", "set-option -gas terminal-features ,xterm-256color:hyperlinks", ";",
      "if-shell", "tmux show-options -g terminal-features | grep -Fq 'xterm-256color:clipboard'", "", "set-option -gas terminal-features ,xterm-256color:clipboard", ";",
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
