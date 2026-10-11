#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { appImage, distribution, systemImage } from "../packages/shared/src/distribution.ts";
import { resolveImage } from "../packages/update/src/server/registry.ts";

const pinned = Type.String({ pattern: "^ghcr[.]io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$" });
const manifestSchema = Type.Object({
  version: Type.Literal(1),
  revision: Type.String({ pattern: "^[a-f0-9]{40}$" }),
  upstreamRevision: Type.String({ pattern: "^[a-f0-9]{40}$" }),
  platform: Type.Literal("linux/amd64"),
  app: pinned,
  system: pinned,
  workspace: pinned,
}, { additionalProperties: false });
export type NoxRelease = Static<typeof manifestSchema>;
export function parseNoxRelease(text: string): NoxRelease {
  const release: unknown = JSON.parse(text);
  if (!Value.Check(manifestSchema, release)) throw new Error("Invalid release manifest");
  for (const [field, image] of [["app", appImage], ["system", systemImage], ["workspace", `${appImage}-workspace`]] as const) {
    if (!release[field].startsWith(`${image}@`)) throw new Error(`Unexpected ${field} repository`);
  }
  return release;
}
const githubRepo = new URL(distribution.source).pathname.slice(1);
async function run(args: string[], stream = false): Promise<string> {
  const child = Bun.spawn(args, { stdout: stream ? "inherit" : "pipe", stderr: "inherit" });
  const output = stream ? "" : await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Failed: ${args.join(" ")}`);
  return output.trim();
}
async function pin(image: string, revision: string): Promise<string> {
  const descriptor = JSON.parse(await run(["docker", "buildx", "imagetools", "inspect", `${image}:sha-${revision}`, "--format", "{{json .Manifest}}"]));
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.digest)) throw new Error(`Missing digest for ${image}`);
  return `${image}@${descriptor.digest}`;
}

async function main(operation: string) {
  if (!["build", "promote"].includes(operation)) throw new Error("Usage: bun scripts/nox-release.ts build|promote (requires Docker, gh, and registry login)");
  if (await run(["git", "status", "--porcelain"])) throw new Error("Commit changes before releasing");
  const revision = await run(["git", "rev-parse", "HEAD"]);
  const tag = `nox-${revision.slice(0, 12)}`;
  const directory = await mkdtemp(join(tmpdir(), "nox-release-"));
  const manifestPath = join(directory, "release.json");
  try {
    if (operation === "build") {
      const existing = Bun.spawn(["gh", "api", `repos/${githubRepo}/releases/tags/${tag}`], { stdout: "pipe", stderr: "pipe" });
      const error = await new Response(existing.stderr).text();
      if (await existing.exited === 0) throw new Error(`${tag} already exists; promote it instead of rebuilding`);
      if (!error.includes("HTTP 404")) throw new Error(error);
      await run(["bun", "scripts/build-agents-in-the-cloud-image.ts", "--push", "--image", appImage,
        "--tag", `sha-${revision}`, "--no-latest", "--platform", "linux/amd64", "--progress", "plain",
        "--build-arg", `ATELIER_SOURCE=${distribution.source}`], true);
      await run(["bun", "install", "--cwd", "images/system", "--frozen-lockfile"], true);
      await run(["bun", "images/system/build.ts"], true);
      await run(["docker", "buildx", "build", "--push", "--provenance=false", "--platform", "linux/amd64",
        "--tag", `${systemImage}:sha-${revision}`, "--label", `org.opencontainers.image.revision=${revision}`,
        "--label", `org.opencontainers.image.source=${distribution.source}`, "--file", "images/system/Dockerfile", "images/system"], true);
      const app = await pin(appImage, revision);
      const image = JSON.parse(await run(["docker", "buildx", "imagetools", "inspect", app, "--format", "{{json .Image}}"]));
      const [workspace] = Value.Parse(Type.Array(Type.String(), { minItems: 1 }), JSON.parse(image.config.Labels["eagerly-preload"]));
      const release = parseNoxRelease(JSON.stringify({ version: 1, revision,
        upstreamRevision: await run(["git", "merge-base", "HEAD", "origin/main"]),
        platform: "linux/amd64", app, system: await pin(systemImage, revision),
        workspace: workspace!.replace(/:[^/:@]+@/, "@"),
      }));
      await Bun.write(manifestPath, JSON.stringify(release, null, 2) + "\n");
      await run(["gh", "release", "create", tag, manifestPath, "--repo", githubRepo, "--target", revision,
        "--prerelease", "--title", `Nox ${revision.slice(0, 12)} — candidate`,
        "--notes", `Candidate only: update channels are unchanged.\nUpstream base: ${release.upstreamRevision}\nPlatform: ${release.platform}\nAfter acceptance review, run the Nox release workflow with operation=promote at this revision. Deploy using release.json and scripts/nox-deploy.sh.`], true);
    } else {
      await run(["gh", "release", "download", tag, "--repo", githubRepo, "--pattern", "release.json", "--dir", directory]);
      const release = parseNoxRelease(await Bun.file(manifestPath).text());
      if (release.revision !== revision) throw new Error("Release does not match this checkout");
      // Installation and update discovery use anonymous registry access. Check all
      // three packages before moving either channel; a private package is an error.
      for (const reference of [release.app, release.system, release.workspace]) {
        await resolveImage(reference, fetch, { os: "linux", architecture: "amd64" });
      }
      for (const [image, reference] of [[appImage, release.app], [systemImage, release.system]]) {
        await run(["docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", `${image}:latest`, "--tag", `${image}:stable`, reference!], true);
      }
      await run(["gh", "release", "edit", tag, "--repo", githubRepo, "--prerelease=false", "--latest",
        "--title", `Nox ${revision.slice(0, 12)}`, "--notes",
        `Approved release. Both update channels point at these tested images.\nUpstream base: ${release.upstreamRevision}\nPlatform: ${release.platform}\nThe app Update button updates the app. Use scripts/nox-deploy.sh with release.json to also update System and take a consistent backup.`], true);
    }
    console.log(`${distribution.source}/releases/tag/${tag}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (import.meta.main) await main(process.argv[2] ?? "");
