import type { JsonObject } from "@agents-in-the-cloud/core";
const response = { "200": { description: "Host operation result. Use Accept: application/json for automation; the UI receives server-rendered HTML." } };
const origin = { name: "Origin", in: "header", required: true, schema: { type: "string" }, description: "Must equal the public AgentsInTheCloud origin. Required for mutations." };
export const hostOpenApiPaths = {
  "/host": { get: { summary: "Inspect Host availability or open Host", description: "Host provides diagnostics of AgentsInTheCloud System, outside individual Workspaces. It does not imply access to the physical machine running Docker.", responses: response } },
  "/host/sample": {
    get: { summary: "Read the last Host diagnostic sample; collect once if none exists", responses: response },
    post: { summary: "Collect a fresh, bounded Host diagnostic sample", parameters: [origin], responses: response },
  },
} satisfies Record<string, JsonObject>;
