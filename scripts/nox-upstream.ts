#!/usr/bin/env bun
import { parseArgs } from "node:util";

export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (args: string[]) => Promise<CommandResult>;

/** Prepare locally by default; publishing atomically updates both fork branches. */
export async function mergeUpstream(run: CommandRunner, publish = false): Promise<void> {
  async function checked(args: string[]): Promise<string> {
    const result = await run(args);
    if (result.code !== 0) throw new Error(`${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  async function clean() {
    if (await checked(["git", "status", "--porcelain"])) throw new Error("Working tree is not clean; commit or stash your work first. Nothing is stashed automatically.");
  }
  async function ancestor(before: string, after: string) {
    const result = await run(["git", "merge-base", "--is-ancestor", before, after]);
    if (result.code === 1) throw new Error(`${before} is not an ancestor of ${after}; reconcile that branch explicitly first.`);
    if (result.code !== 0) throw new Error(result.stderr);
  }
  await clean();
  if (await checked(["git", "branch", "--show-current"]) !== "nox") throw new Error("Switch to nox before running this helper.");
  await checked(["git", "fetch", "upstream", "main"]);
  await checked(["git", "fetch", "origin", "main", "nox"]);
  const revision = await checked(["git", "rev-parse", "upstream/main"]);
  await ancestor("origin/main", revision);
  await ancestor("main", revision);
  await ancestor("origin/nox", "HEAD");
  await checked(["git", "switch", "main"]);
  await checked(["git", "merge", "--ff-only", revision]);
  await checked(["git", "switch", "nox"]);
  // On conflict Git leaves the merge in place for the maintainer to resolve or abort.
  await checked(["git", "merge", "--no-edit", revision]);
  await checked(["bun", "install", "--frozen-lockfile"]);
  await checked(["bun", "run", "check"]);
  await checked(["bun", "test", "packages/shared/test", "packages/update/test", "packages/vscode/test", "images/system/src/channel-update.test.ts", "scripts/nox-release.test.ts", "scripts/nox-upstream.test.ts"]);
  await clean();
  if (publish) await checked(["git", "push", "--atomic", "origin", "main", "nox"]);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { publish: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
  if (values.help) {
    console.log("Usage: bun scripts/nox-upstream.ts [--publish]\nFrom a clean nox checkout: fetch upstream, fast-forward main, merge into nox, install locked dependencies, run checks/tests. --publish pushes main+nox atomically and triggers a candidate build. Never promotes or deploys production.\nConflicts: resolve and commit (or git merge --abort), then rerun. Check failures: fix and commit, then rerun.");
  } else {
    await mergeUpstream(async (args) => {
      console.log(`> ${args.join(" ")}`);
      const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "inherit" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
      return { code, stdout, stderr };
    }, values.publish);
    console.log(values.publish ? "Candidate build requested. Review before promoting; production is unchanged." : "Merge and checks complete locally. Rerun with --publish when ready; production is unchanged.");
  }
}
