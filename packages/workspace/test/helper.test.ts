import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshWorkspaceHelper, workspaceParentSocketDirectory } from "../src/helper.ts";

test("a running workspace restarts the app-mounted helper before readiness checks", async () => {
  const data = await mkdtemp(join(tmpdir(), "workspace-helper-refresh-"));
  const previous = process.env.ATELIER_DATA_DIR;
  process.env.ATELIER_DATA_DIR = data;
  const calls: string[][] = [];
  try {
    await refreshWorkspaceHelper("01234567", "agents-in-the-cloud-01234567", async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: args[0] === "inspect" ? "true\n" : "", stderr: "" };
    });
    expect(calls).toEqual([
      ["inspect", "--format", `{{range .Mounts}}{{if eq .Destination "${workspaceParentSocketDirectory}"}}{{.RW}}{{end}}{{end}}`, "agents-in-the-cloud-01234567"],
      ["exec", "--user", "root", "agents-in-the-cloud-01234567", "systemctl", "restart", "agents-in-the-cloud-helper.service"],
    ]);
  } finally {
    if (previous === undefined) delete process.env.ATELIER_DATA_DIR;
    else process.env.ATELIER_DATA_DIR = previous;
    await rm(data, { recursive: true, force: true });
  }
});

test("a workspace without the helper unit replaces its manually launched helper", async () => {
  const data = await mkdtemp(join(tmpdir(), "workspace-helper-refresh-"));
  const previous = process.env.ATELIER_DATA_DIR;
  process.env.ATELIER_DATA_DIR = data;
  const commands: string[][] = [];
  try {
    await mkdir(join(data, "workspace-sockets", "01234567"), { recursive: true });
    await refreshWorkspaceHelper(
      "01234567",
      "agents-in-the-cloud-01234567",
      async () => ({ exitCode: 0, stdout: "false\n", stderr: "" }),
      async (args) => {
        commands.push(args);
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" };
      },
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.slice(0, 7)).toEqual(["docker", "exec", "--detach", "--user", "root", "agents-in-the-cloud-01234567", "sh"]);
    expect(commands[0]?.at(-1)).toContain("pkill -TERM -x aitc-workspace-");
    expect(commands[0]?.at(-1)).toContain("exec /opt/agents-in-the-cloud/bin/aitc-workspace-helper");
  } finally {
    if (previous === undefined) delete process.env.ATELIER_DATA_DIR;
    else process.env.ATELIER_DATA_DIR = previous;
    await rm(data, { recursive: true, force: true });
  }
});
