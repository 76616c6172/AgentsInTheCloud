import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeUpstream, type CommandRunner } from "./nox-upstream.ts";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function identity(cwd: string) {
  git(cwd, "config", "user.name", "Release test");
  git(cwd, "config", "user.email", "release@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nox-upstream-")); directories.push(root);
  git(root, "init", "-b", "main", "upstream");
  const upstream = join(root, "upstream"); identity(upstream);
  writeFileSync(join(upstream, "theme"), "upstream\n");
  git(upstream, "add", "."); git(upstream, "commit", "-m", "base");
  git(root, "init", "--bare", "origin");
  git(root, "clone", upstream, "checkout");
  const checkout = join(root, "checkout"); identity(checkout);
  git(checkout, "remote", "rename", "origin", "upstream");
  git(checkout, "remote", "add", "origin", join(root, "origin"));
  git(checkout, "switch", "-c", "nox");
  writeFileSync(join(checkout, "theme"), "Nox Oscura\n");
  git(checkout, "commit", "-am", "personal theme");
  git(checkout, "push", "origin", "main", "nox");
  writeFileSync(join(upstream, "improvement"), "new feature\n");
  git(upstream, "add", "."); git(upstream, "commit", "-m", "upstream improvement");
  const calls: string[][] = [];
  const run: CommandRunner = async (args) => {
    calls.push(args);
    if (args[0] === "bun") return { code: 0, stdout: "", stderr: "" };
    const result = Bun.spawnSync(args, { cwd: checkout, stdout: "pipe", stderr: "pipe" });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  return { root, upstream, checkout, calls, run };
}
test("prepares a real merge without publishing and preserves the personal theme", async () => {
  const f = fixture(); const previous = git(f.checkout, "rev-parse", "origin/nox");
  await mergeUpstream(f.run);
  expect(git(f.checkout, "show", "HEAD:theme")).toBe("Nox Oscura");
  expect(git(f.checkout, "show", "HEAD:improvement")).toBe("new feature");
  expect(git(f.checkout, "rev-parse", "main")).toBe(git(f.upstream, "rev-parse", "HEAD"));
  expect(git(f.checkout, "rev-parse", "origin/nox")).toBe(previous);
  expect(f.calls.some(c => c[0] === "bun" && c[1] === "test")).toBe(true);
});
test("publishes both branches atomically only after checks", async () => {
  const f = fixture(); await mergeUpstream(f.run, true);
  expect(f.calls.at(-1)).toEqual(["git", "push", "--atomic", "origin", "main", "nox"]);
  expect(git(join(f.root, "origin"), "rev-parse", "nox")).toBe(git(f.checkout, "rev-parse", "HEAD"));
});
test("dirty files stop the operation before fetching", async () => {
  const f = fixture(); writeFileSync(join(f.checkout, "untracked"), "keep me");
  await expect(mergeUpstream(f.run, true)).rejects.toThrow("not clean");
  expect(f.calls).toHaveLength(1);
});
test("diverged main is not overwritten", async () => {
  const f = fixture(); git(f.checkout, "switch", "main");
  writeFileSync(join(f.checkout, "personal-main"), "keep me");
  git(f.checkout, "add", "."); git(f.checkout, "commit", "-m", "divergence");
  const before = git(f.checkout, "rev-parse", "HEAD"); git(f.checkout, "switch", "nox");
  await expect(mergeUpstream(f.run, true)).rejects.toThrow("not an ancestor");
  expect(git(f.checkout, "rev-parse", "main")).toBe(before);
});
test("conflicts remain available for manual resolution and never publish", async () => {
  const f = fixture(); writeFileSync(join(f.upstream, "theme"), "changed upstream theme\n");
  git(f.upstream, "commit", "-am", "conflicting change");
  await expect(mergeUpstream(f.run, true)).rejects.toThrow("failed");
  expect(git(f.checkout, "diff", "--name-only", "--diff-filter=U")).toBe("theme");
  expect(f.calls.some(c => c[1] === "push")).toBe(false);
});
test("failed checks do not publish the local merge", async () => {
  const f = fixture();
  await expect(mergeUpstream(async args => args.join(" ") === "bun run check"
    ? { code: 1, stdout: "", stderr: "type error" } : f.run(args), true)).rejects.toThrow("type error");
  expect(f.calls.some(c => c[1] === "push")).toBe(false);
});
