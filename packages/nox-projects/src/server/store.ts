import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentsInTheCloudCoreError, getAgentsInTheCloudRuntimeContext, writeJsonAtomic } from "@agents-in-the-cloud/core";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const projectRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  templateIds: Type.Array(Type.String()),
  workspaceIds: Type.Array(Type.String()),
  excludedWorkspaceIds: Type.Array(Type.String()),
  createdAt: Type.Number(),
});

const projectsFileSchema = Type.Object({
  version: Type.Literal(1),
  projects: Type.Array(projectRecordSchema),
});

export type NoxProjectRecord = Static<typeof projectRecordSchema>;
type ProjectsFile = Static<typeof projectsFileSchema>;

function storePath(dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir): string {
  return join(dataDir, "nox-projects.json");
}

async function readProjectsFile(dataDir?: string): Promise<ProjectsFile> {
  try {
    const raw = await readFile(storePath(dataDir), "utf8");
    return Value.Parse(projectsFileSchema, JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, projects: [] };
    }
    throw error;
  }
}

async function writeProjectsFile(file: ProjectsFile, dataDir?: string): Promise<void> {
  const path = storePath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, file);
}

export async function listProjects(dataDir?: string): Promise<NoxProjectRecord[]> {
  const file = await readProjectsFile(dataDir);
  return [...file.projects].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

export async function getProject(projectId: string, dataDir?: string): Promise<NoxProjectRecord | undefined> {
  const file = await readProjectsFile(dataDir);
  return file.projects.find((project) => project.id === projectId);
}

export async function createProject(name: string, dataDir?: string): Promise<NoxProjectRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new AgentsInTheCloudCoreError("invalid_arguments", "Project name is required");
  const file = await readProjectsFile(dataDir);
  if (file.projects.some((project) => project.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `A project named "${trimmed}" already exists`);
  }
  const record: NoxProjectRecord = {
    id: crypto.randomUUID().replaceAll("-", "").slice(0, 12),
    name: trimmed,
    templateIds: [],
    workspaceIds: [],
    excludedWorkspaceIds: [],
    createdAt: Date.now(),
  };
  file.projects.push(record);
  await writeProjectsFile(file, dataDir);
  return record;
}

export async function renameProject(projectId: string, name: string, dataDir?: string): Promise<NoxProjectRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new AgentsInTheCloudCoreError("invalid_arguments", "Project name is required");
  const file = await readProjectsFile(dataDir);
  const project = file.projects.find((item) => item.id === projectId);
  if (!project) throw new AgentsInTheCloudCoreError("invalid_arguments", `Project not found: ${projectId}`);
  if (file.projects.some((item) => item.id !== projectId && item.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `A project named "${trimmed}" already exists`);
  }
  project.name = trimmed;
  await writeProjectsFile(file, dataDir);
  return project;
}

export async function deleteProject(projectId: string, dataDir?: string): Promise<void> {
  const file = await readProjectsFile(dataDir);
  const before = file.projects.length;
  file.projects = file.projects.filter((item) => item.id !== projectId);
  if (file.projects.length === before) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `Project not found: ${projectId}`);
  }
  await writeProjectsFile(file, dataDir);
}

export async function assignTemplateToProject(templateId: string, projectId: string | null, dataDir?: string): Promise<void> {
  const file = await readProjectsFile(dataDir);
  if (projectId !== null && !file.projects.some((item) => item.id === projectId)) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `Project not found: ${projectId}`);
  }
  for (const project of file.projects) {
    project.templateIds = project.templateIds.filter((id) => id !== templateId);
  }
  if (projectId !== null) {
    const target = file.projects.find((item) => item.id === projectId)!;
    target.templateIds = [...target.templateIds, templateId];
  }
  await writeProjectsFile(file, dataDir);
}

export async function assignWorkspaceToProject(
  workspaceId: string,
  projectId: string | null,
  templateId?: string,
  dataDir?: string,
): Promise<void> {
  const file = await readProjectsFile(dataDir);
  if (projectId !== null && !file.projects.some((item) => item.id === projectId)) {
    throw new AgentsInTheCloudCoreError("invalid_arguments", `Project not found: ${projectId}`);
  }
  const inheritedProjectId = templateId ? resolveTemplateProjectId(file.projects, templateId) : undefined;
  for (const project of file.projects) {
    project.workspaceIds = project.workspaceIds.filter((id) => id !== workspaceId);
    project.excludedWorkspaceIds = project.excludedWorkspaceIds.filter((id) => id !== workspaceId);
  }
  if (projectId === null) {
    if (inheritedProjectId) {
      const inherited = file.projects.find((item) => item.id === inheritedProjectId)!;
      inherited.excludedWorkspaceIds = [...inherited.excludedWorkspaceIds, workspaceId];
    }
  } else if (projectId !== inheritedProjectId) {
    const target = file.projects.find((item) => item.id === projectId)!;
    target.workspaceIds = [...target.workspaceIds, workspaceId];
  }
  await writeProjectsFile(file, dataDir);
}

export function resolveTemplateProjectId(projects: readonly NoxProjectRecord[], templateId: string): string | undefined {
  return projects.find((project) => project.templateIds.includes(templateId))?.id;
}

export function resolveWorkspaceProjectId(
  projects: readonly NoxProjectRecord[],
  workspace: { workspaceId: string; templateId?: string },
): string | undefined {
  const explicit = projects.find((project) => project.workspaceIds.includes(workspace.workspaceId));
  if (explicit) return explicit.id;
  if (!workspace.templateId) return undefined;
  const inherited = projects.find((project) => project.templateIds.includes(workspace.templateId!));
  if (!inherited) return undefined;
  if (inherited.excludedWorkspaceIds.includes(workspace.workspaceId)) return undefined;
  return inherited.id;
}
