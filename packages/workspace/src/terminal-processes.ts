import { createTerminalProcesses, type TerminalProcesses } from "@agents-in-the-cloud/observable-terminal/server";
import { runInWorkspace, startInWorkspace } from "./helper.ts";

/** In the agent's home, so the workspace keeps results across app restarts until they are released. */
const terminalProcessesRoot = "/home/agents-in-the-cloud/.local/state/agents-in-the-cloud/terminal-processes";

/** Terminal processes in one workspace, run through its helper. */
export function workspaceTerminalProcesses(workspaceId: string): TerminalProcesses {
  return createTerminalProcesses({
    root: terminalProcessesRoot,
    run: (start, options) => runInWorkspace(workspaceId, start, options),
    start: (start) => startInWorkspace(workspaceId, start),
  });
}
