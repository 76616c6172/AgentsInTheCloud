import { errorMessage, turboStream, turboStreamResponse, workspaceModuleModalFrameId, type WorkspaceModuleRouteContext } from "@agents-in-the-cloud/shared";
import { jsonResponse, response } from "@agents-in-the-cloud/shared/http";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { projectsHost } from "./bridge.ts";
import { renderManageProjectsDialog, renderManageProjectsFrame } from "./render.ts";
import {
  assignTemplateToProject,
  assignWorkspaceToProject,
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "./store.ts";

const jsonRecordSchema = Type.Record(Type.String(), Type.Unknown());

function wantsStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/vnd.turbo-stream.html");
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html") && !accept.includes("text/vnd.turbo-stream.html");
}

async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed: unknown = await request.json();
    if (!Value.Check(jsonRecordSchema, parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)]));
  }
  const form = await request.formData();
  const result: Record<string, string> = {};
  for (const [key, value] of form.entries()) result[key] = String(value);
  return result;
}

async function renderDialogResponse(request: Request, context: WorkspaceModuleRouteContext, error?: string): Promise<Response> {
  const host = projectsHost();
  const [projects, templates, workspaces] = await Promise.all([
    listProjects(),
    host.listTemplates(),
    host.listWorkspaces(),
  ]);
  const dialog = renderManageProjectsDialog({ projects, templates, workspaces, error });
  if (request.headers.get("turbo-frame") === workspaceModuleModalFrameId) {
    return response(renderManageProjectsFrame(dialog));
  }
  if (wantsStream(request)) {
    return turboStreamResponse(turboStream("update", workspaceModuleModalFrameId, dialog));
  }
  return await context.renderModalPage(dialog);
}

export async function handleProjectsRequest(
  request: Request,
  url: URL,
  context: WorkspaceModuleRouteContext,
): Promise<Response | undefined> {
  if (url.pathname === "/projects" && request.method === "GET") {
    if (wantsJson(request)) return jsonResponse({ projects: await listProjects() });
    return await renderDialogResponse(request, context);
  }

  if (url.pathname === "/projects/manage" && request.method === "GET") {
    return await renderDialogResponse(request, context);
  }

  if (url.pathname === "/projects" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const project = await createProject(body.name ?? "");
      projectsHost().invalidateShell();
      if (wantsJson(request)) return jsonResponse({ project }, { status: 201 });
      return await renderDialogResponse(request, context);
    } catch (error) {
      if (wantsJson(request)) return jsonResponse({ error: { code: "invalid_arguments", message: errorMessage(error) } }, { status: 422 });
      return await renderDialogResponse(request, context, errorMessage(error));
    }
  }

  const projectAction = url.pathname.match(/^\/projects\/([^/]+)\/(rename|delete)$/);
  if (projectAction && request.method === "POST") {
    const projectId = decodeURIComponent(projectAction[1]!);
    const action = projectAction[2]!;
    try {
      if (action === "rename") {
        const body = await readBody(request);
        const project = await renameProject(projectId, body.name ?? "");
        projectsHost().invalidateShell();
        if (wantsJson(request)) return jsonResponse({ project });
      } else {
        await deleteProject(projectId);
        projectsHost().invalidateShell();
        if (wantsJson(request)) return jsonResponse({ deleted: projectId });
      }
      return await renderDialogResponse(request, context);
    } catch (error) {
      if (wantsJson(request)) return jsonResponse({ error: { code: "invalid_arguments", message: errorMessage(error) } }, { status: 422 });
      return await renderDialogResponse(request, context, errorMessage(error));
    }
  }

  if (url.pathname === "/projects/assign-template" && request.method === "POST") {
    const body = await readBody(request);
    const templateId = body.templateId ?? "";
    const projectId = body.projectId?.trim() || null;
    await assignTemplateToProject(templateId, projectId);
    projectsHost().invalidateShell();
    if (wantsJson(request)) return jsonResponse({ ok: true, templateId, projectId });
    return await renderDialogResponse(request, context);
  }

  if (url.pathname === "/projects/assign-workspace" && request.method === "POST") {
    const body = await readBody(request);
    const workspaceId = body.workspaceId ?? "";
    const projectId = body.projectId?.trim() || null;
    const templateId = body.templateId?.trim() || undefined;
    await assignWorkspaceToProject(workspaceId, projectId, templateId);
    projectsHost().invalidateShell();
    if (wantsJson(request)) return jsonResponse({ ok: true, workspaceId, projectId });
    return await renderDialogResponse(request, context);
  }

  return undefined;
}
