import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createSubagentsController, createSubagentTranscriptController } from "./subagents-controller.ts";
export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "subagents",
  install({ application, Controller }) {
    application.register("subagents", createSubagentsController(Controller));
    application.register("subagent-transcript", createSubagentTranscriptController(Controller));
  },
};
