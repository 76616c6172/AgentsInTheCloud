import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoProgram } from "@agents-in-the-cloud/core";
import { closeWorkspaceHelper, runWorkspaceProcess } from "@agents-in-the-cloud/workspace-helper";
import { describeTerminalProcesses } from "./terminal-process-scenarios.ts";

/** The same scenarios through a real helper, which runs as root and starts processes as the agent's user. */
describeTerminalProcesses("terminal processes through the workspace helper", async (tmuxDirectory) => {
  const directory = await mkdtemp(join(tmpdir(), "terminal-process-helper-"));
  const binary = join(directory, "aitc-workspace-helper");
  await buildGoProgram(fileURLToPath(new URL("../../../workspace-helper/helper", import.meta.url)), binary, `linux/${process.arch === "arm64" ? "arm64" : "amd64"}`);
  const socket = join(directory, "helper.sock");
  const state = join(directory, "state");
  const helper = Bun.spawn(["sudo", "-n", binary, "--listen", socket, "--state", state], { stdout: "inherit", stderr: "inherit" });
  for (let attempt = 0; !existsSync(socket); attempt++) {
    if (attempt > 200) throw new Error("the helper did not start listening");
    await Bun.sleep(25);
  }
  return {
    async run(start, options) {
      const result = await runWorkspaceProcess(socket, { ...start, env: { ...start.env, TMUX_TMPDIR: tmuxDirectory } }, options);
      return { ...result, stderr: result.stderr.toString() };
    },
    async close() {
      closeWorkspaceHelper(socket);
      helper.kill();
      await helper.exited;
      // The helper keeps its state as root.
      await Bun.spawn(["sudo", "-n", "rm", "-rf", directory]).exited;
    },
  };
});
