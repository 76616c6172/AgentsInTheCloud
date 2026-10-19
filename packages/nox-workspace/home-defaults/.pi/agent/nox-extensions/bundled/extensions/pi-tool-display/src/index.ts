import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  loadToolDisplayConfig,
  normalizeToolDisplayConfig,
  saveToolDisplayConfig,
} from "./config-store.js";
import {
  applyCapabilityConfigGuards,
  detectToolDisplayCapabilities,
  type ToolDisplayCapabilities,
} from "./capabilities.js";
import { registerToolDisplayCommand } from "./config-modal.js";
import { registerToolDisplayOverrides } from "./tool-overrides.js";
import { patchGroupedToolSpacing } from "./grouped-tool-spacing.js";
import { patchCollapsedToolImages } from "./collapsed-tool-images.js";
// Disabled locally: thinking-label registers a context hook that mutates outbound
// model context to strip display labels. This install is intended to be
// rendering-only from the agent's perspective.
import registerNativeUserMessageBox from "./user-message-box-native.js";
import {
  BUILT_IN_TOOL_OVERRIDE_NAMES,
  type ToolDisplayConfig,
} from "./types.js";

function ownershipChanged(
  previous: ToolDisplayConfig,
  next: ToolDisplayConfig,
): boolean {
  return BUILT_IN_TOOL_OVERRIDE_NAMES.some(
    (toolName) =>
      previous.registerToolOverrides[toolName] !==
      next.registerToolOverrides[toolName],
  );
}

export default function toolDisplayExtension(pi: ExtensionAPI): void {
  const initial = loadToolDisplayConfig();
  let config: ToolDisplayConfig = initial.config;
  let pendingLoadError = initial.error;
  let capabilities: ToolDisplayCapabilities = {
    hasMcpTooling: false,
    hasRtkOptimizer: false,
  };

  const refreshCapabilities = (): void => {
    capabilities = detectToolDisplayCapabilities(pi, process.cwd());
  };

  const getConfig = (): ToolDisplayConfig => config;
  const getCapabilities = (): ToolDisplayCapabilities => capabilities;
  const getEffectiveConfig = (): ToolDisplayConfig =>
    applyCapabilityConfigGuards(config, capabilities);

  const setConfig = (
    next: ToolDisplayConfig,
    ctx: ExtensionCommandContext,
  ): void => {
    const normalized = normalizeToolDisplayConfig(next);
    const requiresReload = ownershipChanged(config, normalized);
    config = normalized;

    const saved = saveToolDisplayConfig(normalized);
    if (!saved.success && saved.error) {
      ctx.ui.notify(saved.error, "error");
    }

    if (requiresReload) {
      ctx.ui.notify(
        "Tool ownership updates apply after /reload.",
        "warning",
      );
    }
  };

  patchGroupedToolSpacing();
  patchCollapsedToolImages();
  registerToolDisplayOverrides(pi, getEffectiveConfig);
  registerNativeUserMessageBox(pi, getConfig);
  registerToolDisplayCommand(pi, { getConfig, setConfig, getCapabilities });
  // registerThinkingLabeling(pi); // disabled locally; see comment above

  pi.on("session_start", async (_event, ctx) => {
    refreshCapabilities();
    if (pendingLoadError) {
      ctx.ui.notify(pendingLoadError, "warning");
      pendingLoadError = undefined;
    }
  });

  pi.on("before_agent_start", async () => {
    refreshCapabilities();
  });
}
