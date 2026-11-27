import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { handleProjectsRequest } from "./routes.ts";

export { configureProjectsHost, projectsHost, type ProjectsHostBridge, type ProjectTemplateInfo, type ProjectWorkspaceInfo } from "./bridge.ts";
export {
  assignTemplateToProject,
  assignWorkspaceToProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
  resolveTemplateProjectId,
  resolveWorkspaceProjectId,
  type NoxProjectRecord,
} from "./store.ts";
export { noxCheckIconHtml, noxFilterIconHtml, noxFolderIconHtml, projectsDialogId, renderManageProjectsDialog } from "./render.ts";

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "nox-projects",
  staticFiles: {
    "/nox-projects.css": { url: new URL("../client/projects.css", import.meta.url), contentType: "text/css; charset=utf-8" },
  },
  routes: [{ handle: handleProjectsRequest }],
  openApiPaths: {
    "/projects": {
      get: { summary: "List Nox projects", responses: { "200": { description: "Projects list" } } },
      post: { summary: "Create a Nox project", responses: { "201": { description: "Created project" } } },
    },
    "/projects/manage": {
      get: { summary: "Open the Manage Projects dialog", responses: { "200": { description: "Dialog HTML" } } },
    },
    "/projects/assign-template": {
      post: { summary: "Assign or remove a workspace template from a project", responses: { "200": { description: "Updated" } } },
    },
    "/projects/assign-workspace": {
      post: { summary: "Assign or remove a workspace from a project", responses: { "200": { description: "Updated" } } },
    },
  },
};
