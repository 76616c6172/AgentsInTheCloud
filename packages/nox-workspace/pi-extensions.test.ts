import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agent = join(import.meta.dir, "home-defaults/.pi/agent");
const bundle = join(agent, "nox-extensions/bundled");

async function filesIn(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    expect((await lstat(path)).isSymbolicLink()).toBe(false);
    expect(entry.name).not.toMatch(/^(?:node_modules|\.git|auth\.json|models\.json|sessions|\.env)$/);
    if (entry.isDirectory()) files.push(...await filesIn(path, `${prefix}${entry.name}/`));
    else files.push(`${prefix}${entry.name}`);
  }
  return files.sort();
}

test("fresh homes load the self-contained cloud bundle and its preferences", async () => {
  const settings = await Bun.file(join(agent, "settings.json")).json();
  expect(settings.packages).toEqual(["./nox-extensions/bundled"]);
  const profile = await Bun.file(join(bundle, "package.json")).json();
  expect(profile.pi.extensions).toEqual(["./loader.ts"]);
  expect(profile.nox.extensions).toEqual([
    "./extensions/pi-tool-display/index.ts",
    "./extensions/exhash-tools/index.ts",
    "./extensions/follow-on-type.ts",
    "./extensions/notify.ts",
    "./extensions/window-title-status.ts",
  ]);
  expect(profile.dependencies).toBeUndefined();
  expect(Object.keys(profile.peerDependencies).sort()).toEqual([
    "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox",
  ]);
  for (const entry of profile.nox.extensions) expect(await Bun.file(join(bundle, entry)).exists()).toBe(true);
  expect(await Bun.file(join(agent, "extensions/pi-tool-display/config.json")).text()).toBe(
    await Bun.file(join(bundle, "extensions/pi-tool-display/config.json")).text(),
  );
  const image = await Bun.file(join(import.meta.dir, "workspace-image.json")).json();
  expect(image.files).toContainEqual({
    from: "home-defaults/.pi", to: "/opt/agents-in-the-cloud/home-defaults/.pi", afterRun: true,
  });
});

test("the vendored snapshot pins every runtime file, engine asset and license", async () => {
  const snapshot = await Bun.file(join(bundle, "snapshot.json")).json();
  expect(snapshot.sourceRepository).toBe("https://github.com/76616c6172/dotvulpix");
  expect(snapshot.sourceRevision).toBe("39ebd45d88f50acbb8c740ad63a10fc777071bed");
  expect(snapshot.adaptedFiles).toEqual(["loader.ts", "package.json"]);
  expect(snapshot.dirtyFiles).toEqual([]);
  expect(await filesIn(bundle)).toEqual([...Object.keys(snapshot.files), "snapshot.json"].sort());
  for (const path of Object.keys(snapshot.files)) {
    expect(createHash("sha256").update(await Bun.file(join(bundle, path)).bytes()).digest("hex")).toBe(snapshot.files[path]);
  }
  const identity = { version: snapshot.version, sourceRevision: snapshot.sourceRevision, dirtyFiles: snapshot.dirtyFiles, files: snapshot.files };
  expect(createHash("sha256").update(JSON.stringify(identity)).digest("hex")).toBe(snapshot.id);
  for (const path of ["LICENSE", "extensions/pi-tool-display/LICENSE", "extensions/exhash-tools/THIRD-PARTY-NOTICES.txt", "extensions/exhash-tools/engine.wasm.gz"]) {
    expect(snapshot.files[path]).toMatch(/^[a-f0-9]{64}$/);
  }
});

test("the bundled Exhash engine reads, edits and navigates files without installation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nox-bundled-exhash-"));
  try {
    const script = `
      import assert from "node:assert/strict";
      import { readFile, writeFile } from "node:fs/promises";
      import { readText, editText, openDocument } from ${JSON.stringify(join(bundle, "extensions/exhash-tools/backend.mjs"))};
      const cwd = process.argv[1];
      const path = cwd + "/fixture.ts";
      await writeFile(path, "export function value() {\\n  return 1;\\n}\\n");
      const read = await readText({path}, cwd);
      const address = read.text.match(/2\\|[A-Za-z0-9_-]{2}\\|/)[0];
      const edit = await editText({path, commands: [{address, op: "change", text: "  return 42;"}]}, cwd, undefined, (_path, run) => run());
      assert(edit.committed);
      assert((await readFile(path, "utf8")).includes("return 42;"));
      assert((await openDocument({path}, cwd)).text.includes("value"));
      await assert.rejects(() => editText({path, commands: [{address, op: "change", text: "  return 0;"}]}, cwd, undefined, (_path, run) => run()));
      assert((await readFile(path, "utf8")).includes("return 42;"));
    `;
    const child = Bun.spawn(["node", "--input-type=module", "--eval", script, cwd], { stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
