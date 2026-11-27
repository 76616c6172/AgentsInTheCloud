import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignTemplateToProject,
  assignWorkspaceToProject,
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  resolveTemplateProjectId,
  resolveWorkspaceProjectId,
} from "../../src/server/index.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nox-projects-test-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("nox-projects store and membership resolution", () => {
  test("creates, renames, lists, and deletes projects", async () => {
    const dir = await tempDir();
    const alpha = await createProject("Orbital", dir);
    const beta = await createProject("Core", dir);
    expect((await listProjects(dir)).map((p) => p.name)).toEqual(["Core", "Orbital"]);

    await renameProject(beta.id, "Nox Core", dir);
    expect((await listProjects(dir)).map((p) => p.name)).toEqual(["Nox Core", "Orbital"]);

    await deleteProject(alpha.id, dir);
    expect((await listProjects(dir)).map((p) => p.id)).toEqual([beta.id]);
  });

  test("inherits project from template, supports explicit workspace overrides, and supports removal", async () => {
    const dir = await tempDir();
    const projA = await createProject("Alpha", dir);
    const projB = await createProject("Beta", dir);

    await assignTemplateToProject("tpl-repo", projA.id, dir);
    let projects = await listProjects(dir);
    expect(resolveTemplateProjectId(projects, "tpl-repo")).toBe(projA.id);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-1", templateId: "tpl-repo" })).toBe(projA.id);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-empty" })).toBeUndefined();

    await assignWorkspaceToProject("ws-empty", projB.id, undefined, dir);
    await assignWorkspaceToProject("ws-override", projB.id, "tpl-repo", dir);
    await assignWorkspaceToProject("ws-excluded", null, "tpl-repo", dir);

    projects = await listProjects(dir);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-empty" })).toBe(projB.id);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-override", templateId: "tpl-repo" })).toBe(projB.id);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-excluded", templateId: "tpl-repo" })).toBeUndefined();
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-1", templateId: "tpl-repo" })).toBe(projA.id);

    await assignWorkspaceToProject("ws-excluded", projA.id, "tpl-repo", dir);
    projects = await listProjects(dir);
    expect(resolveWorkspaceProjectId(projects, { workspaceId: "ws-excluded", templateId: "tpl-repo" })).toBe(projA.id);
  });
});
