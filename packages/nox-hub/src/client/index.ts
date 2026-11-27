import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";
import { createHubController, createHubSidebarController } from "./hub-controller.ts";

const noxHubClientModule: WorkspaceClientModule = {
  id: "nox-hub",
  install({ application, Controller }) {
    application.register("nox-hub", createHubController(Controller));
    application.register("nox-hub-sidebar", createHubSidebarController(Controller));
  },
};

export { noxHubClientModule as agentsInTheCloudClientModule };
