import { expect, test } from "bun:test";
import { parseNoxRelease } from "./nox-release.ts";
import { appImage, systemImage } from "../packages/shared/src/distribution.ts";

const release = {
  version: 1,
  revision: "a".repeat(40), upstreamRevision: "b".repeat(40), platform: "linux/amd64",
  app: `${appImage}@sha256:${"c".repeat(64)}`,
  system: `${systemImage}@sha256:${"d".repeat(64)}`,
  workspace: `${appImage}-workspace@sha256:${"e".repeat(64)}`,
};
test("release manifests pin the full app, System, and workspace image set", () => {
  expect(parseNoxRelease(JSON.stringify(release))).toEqual(release);
});
test.each([
  { app: `${appImage}:latest` },
  { app: release.system },
  { system: "ghcr.io/lucasmeijer/agents-in-the-cloud-system@sha256:" + "a".repeat(64) },
  { workspace: `${appImage}-workspace:stable` },
  { revision: "main" },
  { platform: "linux/arm64" },
  { extra: "unexpected" },
])("rejects unpinned, mismatched, or malformed release fields: %j", (change) => {
  expect(() => parseNoxRelease(JSON.stringify({ ...release, ...change }))).toThrow();
});
