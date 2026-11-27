import { jsonResponse, response } from "@agents-in-the-cloud/shared/http";
import { turboStream, turboStreamResponse } from "@agents-in-the-cloud/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { hubHost } from "./bridge.ts";
import { hubHostId, hubSidebarStatusId, renderHubSidebarStatus, renderHubSurface } from "./render.ts";
import type { HubRuntime } from "./runtime.ts";

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

export function createHubRouteHandler(getRuntime: () => Promise<HubRuntime>) {
  async function renderThreadView(runtime: HubRuntime, threadId: string): Promise<string> {
    const host = hubHost();
    const [threads, active, projects, templates, workspaces] = await Promise.all([
      runtime.listThreads(),
      runtime.getThread(threadId),
      host.listProjects(),
      host.listTemplates(),
      host.listWorkspaces({ includeParked: false }),
    ]);
    return await renderHubSurface({ threads, active, projects, templates, workspaces });
  }

  async function respondWithThread(request: Request, runtime: HubRuntime, threadId: string): Promise<Response> {
    runtime.clearThreadAttention(threadId);
    if (wantsJson(request)) {
      const [threads, active] = await Promise.all([runtime.listThreads(), runtime.getThread(threadId)]);
      return jsonResponse({
        thread: active.summary,
        threads,
        itemCount: active.items.length,
        items: active.items,
      });
    }
    const html = await renderThreadView(runtime, threadId);
    const sidebarHtml = renderHubSidebarStatus(runtime.sidebarStatus());
    if (wantsStream(request)) {
      return turboStreamResponse(
        `${turboStream("update", hubHostId, html)}${turboStream("replace", hubSidebarStatusId, sidebarHtml)}`,
      );
    }
    return await hubHost().renderHubPage(html);
  }

  return async function handleHubRequest(request: Request, url: URL): Promise<Response | undefined> {
    if (url.pathname === "/hub" && request.method === "GET") {
      const runtime = await getRuntime();
      const preferredProjectId = url.searchParams.get("project")?.trim() || undefined;
      const thread = await runtime.ensureDefaultThread(preferredProjectId);
      return await respondWithThread(request, runtime, thread.threadId);
    }

    if (url.pathname === "/hub/threads" && request.method === "GET") {
      const runtime = await getRuntime();
      return jsonResponse({ threads: await runtime.listThreads(), status: runtime.sidebarStatus() });
    }

    if (url.pathname === "/hub/threads" && request.method === "POST") {
      const runtime = await getRuntime();
      const body = request.headers.get("content-type") ? await readBody(request) : {};
      const thread = await runtime.createThread({
        title: body.title || undefined,
        projectId: body.projectId?.trim() || undefined,
      });
      if (wantsJson(request)) return jsonResponse({ thread }, { status: 201 });
      return await respondWithThread(request, runtime, thread.threadId);
    }

    const threadMatch = url.pathname.match(/^\/hub\/([^/]+)$/);
    if (threadMatch && request.method === "GET") {
      const threadId = decodeURIComponent(threadMatch[1]!);
      const runtime = await getRuntime();
      return await respondWithThread(request, runtime, threadId);
    }

    const actionMatch = url.pathname.match(/^\/hub\/threads\/([^/]+)\/(messages|abort|model|thinking-level|project|rename|delete)$/);
    if (actionMatch && request.method === "POST") {
      const threadId = decodeURIComponent(actionMatch[1]!);
      const action = actionMatch[2]!;
      const runtime = await getRuntime();
      const body = request.headers.get("content-type") ? await readBody(request) : {};

      if (action === "messages") {
        const whenBusy = body.whenBusy === "steer" ? "steer" : "followUp";
        await runtime.sendMessage(threadId, body.text ?? "", whenBusy);
        if (wantsJson(request)) return jsonResponse({ ok: true, threadId }, { status: 202 });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "abort") {
        await runtime.stopThread(threadId);
        if (wantsJson(request)) return jsonResponse({ ok: true, threadId });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "model") {
        const thread = await runtime.configureThread(threadId, { modelRef: body.model });
        if (wantsJson(request)) return jsonResponse({ thread });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "thinking-level") {
        const thread = await runtime.configureThread(threadId, { thinkingLevel: body.thinkingLevel });
        if (wantsJson(request)) return jsonResponse({ thread });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "project") {
        const projectId = body.projectId?.trim() || null;
        const thread = await runtime.setThreadProject(threadId, projectId);
        if (wantsJson(request)) return jsonResponse({ thread });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "rename") {
        const thread = await runtime.renameThread(threadId, body.title ?? "");
        if (wantsJson(request)) return jsonResponse({ thread });
        return await respondWithThread(request, runtime, threadId);
      }

      if (action === "delete") {
        await runtime.deleteThread(threadId);
        const next = await runtime.ensureDefaultThread();
        if (wantsJson(request)) return jsonResponse({ deleted: threadId, nextThreadId: next.threadId });
        return await respondWithThread(request, runtime, next.threadId);
      }
    }

    const detailMatch = url.pathname.match(/^\/hub\/threads\/([^/]+)\/transcript-items\/([^/]+)$/);
    if (detailMatch && request.method === "GET") {
      const threadId = decodeURIComponent(detailMatch[1]!);
      const key = decodeURIComponent(detailMatch[2]!);
      const runtime = await getRuntime();
      const frame = await runtime.detailFrame(threadId, key);
      if (!frame) return new Response("Transcript item not found", { status: 404 });
      return response(frame);
    }

    return undefined;
  };
}
