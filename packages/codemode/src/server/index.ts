import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { registerAgentToolPresentations } from "@agents-in-the-cloud/agent/server";
import { registerBuiltinAgentIntegration } from "@agents-in-the-cloud/builtin-agent/server";
import { codemodeIntegration } from "./integration.ts";
import { handleOneShotAgentRequest } from "./page.ts";
import { codemodeToolPresentations } from "./presentation.ts";

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "codemode",
  initialize() {
    registerBuiltinAgentIntegration(codemodeIntegration);
    registerAgentToolPresentations(codemodeToolPresentations);
  },
  openApiPaths: {
    "/workspaces/{id}/agents/{agentId}/one-shot/{oneShotId}": { get: {
      summary: "A code mode script's one-shot agent's page: its live, read-only transcript",
      parameters: ["id", "agentId", "oneShotId"].map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      responses: { "200": { description: "The page, for the pane's page frame", content: { "text/html": { schema: { type: "string" } } } }, "404": { description: "No such one-shot agent" } },
    } },
  },
  staticFiles: { "/codemode.css": { url: new URL("../client/codemode.css", import.meta.url), contentType: "text/css; charset=utf-8" } },
  routes: [{ handle: (request, url) => handleOneShotAgentRequest(request, url) }],
};
