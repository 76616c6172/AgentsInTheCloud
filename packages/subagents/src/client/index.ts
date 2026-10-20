import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createSubagentsController } from "./subagents-controller.ts";
export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "subagents",
  install({ application, Controller }) {
    application.register("subagents", createSubagentsController(Controller));
  },
};
