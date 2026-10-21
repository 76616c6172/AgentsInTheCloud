import { ensureSharedHome } from "../home.ts";
import { fileURLToPath } from "node:url";
import { prepareWorkspaceToolsMount } from "./workspace-tools.ts";
import { syncWorkspaceDocs } from "./workspace-docs.ts";
import {
  agentsInTheCloudDataPath,
  dockerHostAgentsInTheCloudDataPath,
  getAgentsInTheCloudRuntimeContext,
} from "@agents-in-the-cloud/core";
import type { WorkspaceModule, WorkspaceServerSocketHandler } from "@agents-in-the-cloud/shared";
import { terminalSocketDimensions } from "@agents-in-the-cloud/observable-terminal/server";
import { workspaceTerminalProcesses } from "../terminal-processes.ts";

/** Viewers of every terminal process in a workspace connect here, such as Terminal views and Agents' bash calls. */
const terminalProcessSocket: WorkspaceServerSocketHandler = (url) => {
  const match = url.pathname.match(/^\/workspaces\/([^/]+)\/terminal-processes\/([^/]+)\/ws$/);
  if (!match) return undefined;
  return workspaceTerminalProcesses(decodeURIComponent(match[1]!)).connect(decodeURIComponent(match[2]!), terminalSocketDimensions(url));
};

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const docsMountPath = "/opt/agents-in-the-cloud/docs";

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "workspace",
  async initialize({ events, registerSocketHandler }) {
    registerSocketHandler(terminalProcessSocket);
    await ensureSharedHome();
    const runtime = getAgentsInTheCloudRuntimeContext();
    await syncWorkspaceDocs(repositoryRoot, agentsInTheCloudDataPath(runtime, "docs"));
    const toolsMount = await prepareWorkspaceToolsMount(runtime);
    events.on("workspace_plan_prepare", ({ plan }) => {
      plan.mounts.push(toolsMount);
      if (plan.mounts.some((mount) => mount.target === docsMountPath)) return;
      plan.mounts.push({
        type: "bind",
        source: dockerHostAgentsInTheCloudDataPath(runtime, "docs"),
        target: docsMountPath,
        readonly: true,
      });
    });
  },
};
