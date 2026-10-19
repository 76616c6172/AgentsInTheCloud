import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import profile from "./package.json";

export default async function (pi: ExtensionAPI) {
  // Nox distribution: Pi updates independently; do not gate on old version strings.
  for (const entry of profile.nox.extensions) {
    await (await import(entry)).default(pi);
  }
}
