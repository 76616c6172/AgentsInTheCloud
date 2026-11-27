export interface ProjectTemplateInfo {
  id: string;
  title: string;
}

export interface ProjectWorkspaceInfo {
  id: string;
  title: string;
  templateId?: string;
  templateTitle?: string;
  parked: boolean;
}

export interface ProjectsHostBridge {
  listTemplates(): Promise<ProjectTemplateInfo[]>;
  listWorkspaces(): Promise<ProjectWorkspaceInfo[]>;
  invalidateShell(): void;
}

let currentHost: ProjectsHostBridge | undefined;

export function configureProjectsHost(host: ProjectsHostBridge | undefined): void {
  currentHost = host;
}

export function projectsHost(): ProjectsHostBridge {
  if (!currentHost) throw new Error("Projects host bridge is not configured");
  return currentHost;
}
