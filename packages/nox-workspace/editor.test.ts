import { expect, test } from "bun:test";
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";

const root = import.meta.dir;

test("every baked plugin comes from a public repository at a locked revision", async () => {
  const urls = await Bun.file(join(root, "nvim-plugins.json")).json();
  const lock = await Bun.file(join(root, "nvim/lazy-lock.json")).json();
  expect(Object.keys(urls).length).toBeGreaterThan(30);
  for (const [name, url] of Object.entries(urls)) {
    expect(url).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/);
    expect(lock[name].commit).toMatch(/^[a-f0-9]{40}$/);
  }
});

test("the configuration snapshot contains no runtime data or machine-bound links", async () => {
  async function inspect(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      expect(entry.name).not.toMatch(/^(?:\.git|\.cache|\.ruff_cache|tmp|shada|auth\.json|\.env)$/);
      const file = join(path, entry.name);
      expect((await lstat(file)).isSymbolicLink()).toBe(false);
      if (entry.isDirectory()) await inspect(file);
    }
  }
  await inspect(join(root, "nvim"));
});

test("the image builds editor data outside masked home mounts before installing its launcher", async () => {
  const manifest = await Bun.file(join(root, "workspace-image.json")).json();
  const build = manifest.run.indexOf("bash /opt/agents-in-the-cloud/nox-editor/build.sh");
  const launch = manifest.run.indexOf("ln -sf /opt/agents-in-the-cloud/nox-editor/nvim /usr/local/bin/nvim");
  expect(build).toBeGreaterThan(0);
  expect(launch).toBeGreaterThan(build);
  expect(manifest.files).toContainEqual({
    from: "nvim", to: "/opt/agents-in-the-cloud/home-defaults/.config/nvim", afterRun: true,
  });
  for (const script of ["build-editor.sh", "nvim-launch.sh"]) {
    const syntax = Bun.spawnSync(["bash", "-n", join(root, script)]);
    expect(syntax.exitCode).toBe(0);
  }
});
