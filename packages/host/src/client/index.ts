import { Controller } from "@hotwired/stimulus";
import type { WorkspaceClientModule } from "@agents-in-the-cloud/shared";

class HostDismissController extends Controller<HTMLElement> { dismiss() { this.element.remove(); } }
export const agentsInTheCloudClientModule: WorkspaceClientModule = {
  id: "host",
  install({ application }) {
    application.register("host-dismiss", HostDismissController);
  },
};
