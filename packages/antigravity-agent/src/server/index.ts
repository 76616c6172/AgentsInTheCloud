import { createCliAgentModule, emptyAgentInput } from "@agents-in-the-cloud/cli-agent/server";
import { registerCliModelConnection } from "@agents-in-the-cloud/llm/server";
import { registerWorkspaceRequestTransform } from "@agents-in-the-cloud/proxy-egress/server";
import { providerBrandIconHtml, type WorkspaceModule } from "@agents-in-the-cloud/shared";
import { antigravity, antigravityProvider } from "./connection.ts";
import { antigravityCredentialHosts, antigravityCredentialTransform } from "./credentials.ts";
import { antigravityLaunchScript } from "./launch-command.ts";
import { antigravityModelSettings } from "./model-settings.ts";
import { prepareAntigravitySession } from "./session.ts";
import { antigravityConversationId, antigravityHistoryFiles, loadAntigravityTranscript } from "./transcript.ts";

const cliModule = createCliAgentModule({
  id: antigravityProvider, label: "Antigravity CLI", iconHtml: providerBrandIconHtml(antigravityProvider, "Google Antigravity"),
  requireSetup: async () => { await antigravity.accessToken(); },
  settings: antigravityModelSettings,
  prepareSession: prepareAntigravitySession,
  launchScript: antigravityLaunchScript,
  resumeScript: async (workspaceId, settings, session) => antigravityLaunchScript(emptyAgentInput(), [], settings, session, await antigravityConversationId(workspaceId, session.id)),
  loadTranscript: loadAntigravityTranscript,
  historyFiles: antigravityHistoryFiles,
});

export const agentsInTheCloudServerModule: WorkspaceModule = {
  ...cliModule,
  initialize(context) {
    cliModule.initialize!(context);
    registerCliModelConnection(antigravity.connection);
    registerWorkspaceRequestTransform("antigravity", antigravityCredentialTransform(antigravity.accessToken), async () => antigravityCredentialHosts);
  },
};
