import { registerAgentToolPresentations } from "@agents-in-the-cloud/agent/server";
import { createLivePresentation, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { configureHubHost, hubHost, type HubHostBridge } from "./bridge.ts";
import { hubComposerControlRegions, hubHostId, hubSidebarStatusId, hubThreadListId, noxHubIconHtml, renderHubSidebarStatus, renderHubSidebarStatusInner, renderHubThreadListItems } from "./render.ts";
import { createHubRouteHandler } from "./routes.ts";
import { HubRuntime, hubWorkspaceSyntheticId } from "./runtime.ts";
import { hubToolPresentations } from "./tool-presentation.ts";

export { configureHubHost, type HubHostBridge, type HubProjectSummary, type HubTemplateSummary, type HubWorkspaceState, type HubWorkspaceSummary, type HubCreateWorkspaceOptions, type HubCreatedWorkspace, type HubWaitOptions, type HubWaitResult } from "./bridge.ts";
export { HubContainerPool, createDockerHubContainerBackend, type HubContainerBackend } from "./container-pool.ts";
export { hubHostId, hubSidebarStatusId, noxHubIconHtml, renderHubSidebarStatus } from "./render.ts";
export { HubRuntime, hubWorkspaceSyntheticId } from "./runtime.ts";
export { createHubTools, hubInstructionsForProject, hubSystemPrompt } from "./tools.ts";
export { createHubContainerTools } from "./workspace-tools.ts";
export { selectHubDefaultModel, selectHubThinkingLevel, resolveHubDefaults } from "./model-selection.ts";
export { formatTranscriptForHub, latestAssistantSnippet, answerTranscriptQuestion } from "./transcript-summary.ts";

let runtimePromise: Promise<HubRuntime> | undefined;

function getHubRuntime(): Promise<HubRuntime> {
  return runtimePromise ??= HubRuntime.open({
    renderThreadControls: (threadId, busy) => hubComposerControlRegions(threadId, busy),
  }).catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
}

const threadParam = [{ name: "threadId", in: "path", required: true, schema: { type: "string" } }];

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "nox-hub",
  staticFiles: {
    "/nox-hub.css": { url: new URL("../client/hub.css", import.meta.url), contentType: "text/css; charset=utf-8" },
  },
  initialize(context) {
    registerAgentToolPresentations(hubToolPresentations);
    context.events.on("agents_in_the_cloud_host_stopping", async () => {
      const pending = runtimePromise;
      runtimePromise = undefined;
      if (pending) await (await pending).dispose();
    });
  },
  cableChannels: [{
    name: "nox-hub",
    async subscribe(identifier, listener, _events, shown) {
      if (identifier.channel !== "module" || identifier.name !== "nox-hub") {
        throw new Error("Invalid Hub channel identifier");
      }
      const runtime = await getHubRuntime();
      const threadId = identifier.params.threadId;
      if (!threadId) {
        const presentation = createLivePresentation(() => [
          { target: hubSidebarStatusId, html: renderHubSidebarStatusInner(runtime.sidebarStatus()) },
        ], 100);
        const unwatch = runtime.subscribeStatus(() => presentation.invalidate());
        const subscription = presentation.subscribe(listener, shown);
        return {
          unsubscribe() {
            unwatch();
            subscription.unsubscribe();
            presentation.dispose();
          },
        };
      }
      const renderList = async () => renderHubThreadListItems(await runtime.listThreads(), threadId, await hubHost().listProjects());
      let cachedThreadsHtml = await renderList();
      const listPresentation = createLivePresentation(() => [
        { target: hubThreadListId, html: cachedThreadsHtml },
        { target: hubSidebarStatusId, html: renderHubSidebarStatusInner(runtime.sidebarStatus()) },
      ], 100);
      const unwatchStatus = runtime.subscribeStatus(() => {
        void renderList().then((html) => {
          cachedThreadsHtml = html;
          listPresentation.invalidate();
        }).catch(() => {});
      });
      const listSub = listPresentation.subscribe(listener, shown);
      const threadSub = await runtime.subscribeThread(threadId, listener, shown);
      return {
        unsubscribe() {
          unwatchStatus();
          listSub.unsubscribe();
          threadSub.unsubscribe();
          listPresentation.dispose();
        },
      };
    },
  }],
  routes: [{ handle: createHubRouteHandler(getHubRuntime) }],
  openApiPaths: {
    "/hub": { get: { summary: "Open Hub orchestrator (active thread)", responses: { "200": { description: "Hub HTML, Turbo Stream, or JSON snapshot" } } } },
    "/hub/threads": {
      get: { summary: "List Hub orchestrator threads", responses: { "200": { description: "Hub threads and status" } } },
      post: { summary: "Create a new Hub orchestrator thread", responses: { "201": { description: "Created Hub thread" } } },
    },
    "/hub/threads/{threadId}/messages": {
      post: {
        summary: "Send a message to a Hub orchestrator thread",
        parameters: threadParam,
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string" }, whenBusy: { type: "string", enum: ["followUp", "steer"] } } } } } },
        responses: { "202": { description: "Message queued for Hub" } },
      },
    },
    "/hub/threads/{threadId}/abort": {
      post: { summary: "Stop Hub's current turn", parameters: threadParam, responses: { "200": { description: "Stopped" } } },
    },
    "/hub/threads/{threadId}/model": {
      post: { summary: "Select Hub's model", parameters: threadParam, responses: { "200": { description: "Model updated" } } },
    },
    "/hub/threads/{threadId}/thinking-level": {
      post: { summary: "Select Hub's thinking level", parameters: threadParam, responses: { "200": { description: "Thinking level updated" } } },
    },
    "/hub/threads/{threadId}/project": {
      post: { summary: "Scope a Hub thread to a project (or clear project scope)", parameters: threadParam, responses: { "200": { description: "Project scope updated" } } },
    },
    "/hub/threads/{threadId}/delete": {
      post: { summary: "Delete a Hub thread", parameters: threadParam, responses: { "200": { description: "Deleted" } } },
    },
  },
};
