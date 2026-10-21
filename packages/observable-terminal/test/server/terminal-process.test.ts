import { describeTerminalProcesses, isolatedTmuxEnvironment } from "./terminal-process-scenarios.ts";

describeTerminalProcesses("terminal processes", async (tmuxDirectory) => ({
  async run(start, options) {
    const process = Bun.spawn(start.argv, {
      cwd: start.workdir,
      env: { ...isolatedTmuxEnvironment(tmuxDirectory), ...start.env },
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
    return { exitCode, stdout: Buffer.from(stdout), stderr };
  },
  async close() {},
}));
