import { registerCustomTheme } from "@pierre/diffs";
import { agentsInTheCloudTheme, agentsInTheCloudThemeName } from "./theme.ts";

registerCustomTheme(agentsInTheCloudThemeName, () => Promise.resolve(agentsInTheCloudTheme), "zed");

export { changesDiffOptions, toolDiffOptions } from "./diff-options.ts";
