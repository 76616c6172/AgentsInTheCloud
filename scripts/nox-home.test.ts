import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directories: string[] = [];
const imageNvim = join(import.meta.dir, "../packages/nox-workspace/nvim");
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nox-home-test-"));
  directories.push(root);
  const files = {
    "dotfiles/nvim/init.lua": 'require("config.lazy")',
    "dotfiles/nvim/lazy-lock.json": '{"plugin":{"commit":"pinned"}}',
    "dotfiles/nvim/tmp/99-state": "private runtime state",
    "dotfiles/nvim/.ruff_cache/cache": "cache",
    "dotfiles/zsh/powerlevel10k/p10k.zsh": "prompt settings",
    "dotfiles/zsh/powerlevel10k/theme.zwc": "compiled laptop artifact",
    "dotfiles/zsh/fzf-tab/fzf-tab.plugin.zsh": "completion plugin",
    "dotfiles/zsh/fzf-zoxide/.zoxide_fzf_dir": "#!/bin/sh\nexit 0\n",
    "dotfiles/zsh/cloud.zsh": "# cloud profile",
    "dotfiles/tmux/.tmux.conf": "set -g focus-events on",
    "dotfiles/zsh/.zshrc": "source ~/.secrets/env\ncolor_opts='fg:#ffffff'\nexport FZF_DEFAULT_OPTS=\"--color=$color_opts\"\nexport FZF_CTRL_R_OPTS='--no-info'\nexport LS_COLORS='di=34'\nexport EZA_COLORS='di=34'\n",
    ".secrets/env": "SECRET=never-copy",
    "theme.lua": 'return { "webhooked/oscura.nvim" }',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await mkdir(join(root, "dotfiles/nvim/lua/plugins"), { recursive: true });
  await symlink(join(root, "theme.lua"), join(root, "dotfiles/nvim/lua/plugins/theme.lua"));
  return { root, output: join(root, "home.tar.gz") };
}

async function snapshot(root: string, output: string) {
  const child = Bun.spawn(["bash", join(import.meta.dir, "nox-home.sh"), "snapshot", root, output], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}

function tar(output: string, ...args: string[]): string {
  const child = Bun.spawnSync(["tar", ...args, "-f", output], { stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return child.stdout.toString();
}

test("home snapshot uses image-matched Neovim config rather than laptop plugins or private state", async () => {
  const { root, output } = await fixture();
  expect(await snapshot(root, output)).toMatchObject({ code: 0 });
  const entries = tar(output, "-tz");
  expect(entries).toContain("./.config/nvim/lazy-lock.json");
  expect(entries).toContain("./.config/fzf-tab/fzf-tab.plugin.zsh");
  expect(entries).toContain("./.config/nox-shell/bashrc");
  expect(tar(output, "-xzO", "./.tmux.conf")).toBe("set -g focus-events on");
  expect(entries).not.toContain(".secrets");
  expect(entries).not.toContain("99-state");
  expect(entries).not.toContain(".ruff_cache");
  expect(entries).not.toContain(".zwc");
  expect(tar(output, "-xzO", "./.config/nvim/lua/plugins/theme.lua")).toBe(await Bun.file(join(imageNvim, "lua/plugins/theme.lua")).text());
  expect(tar(output, "-xzO", "./.config/nvim/lazy-lock.json")).toBe(await Bun.file(join(imageNvim, "lazy-lock.json")).text());
  expect(tar(output, "-xzO", "./.config/nox-shell-colors.zsh")).not.toContain("source");
  expect(tar(output, "-xzO", "./.zshrc")).toBe("# cloud profile");
});

test("installation backs up managed settings, survives a different home mount, and switches updates without changing unrelated files", async () => {
  const { root, output } = await fixture();
  const home = join(root, "system-home");
  await mkdir(join(home, ".config/nvim"), { recursive: true });
  await writeFile(join(home, ".config/nvim/init.lua"), "original Neovim");
  await writeFile(join(home, ".zshrc"), "original shell");
  await writeFile(join(home, ".bashrc"), "keep Bash unchanged");
  await writeFile(join(home, ".profile"), "keep login settings unchanged");
  expect((await snapshot(root, output)).code).toBe(0);
  const install = (target: string) => {
    const result = Bun.spawnSync(["bash", join(import.meta.dir, "nox-home-install.sh"), target, output], { stdout: "pipe", stderr: "pipe" });
    expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  };
  install(home);
  const [backup] = await readdir(join(home, ".nox-home/backups"));
  expect(await Bun.file(join(home, ".nox-home/backups", backup!, ".zshrc")).text()).toBe("original shell");
  expect(await Bun.file(join(home, ".nox-home/backups", backup!, ".config/nvim/init.lua")).text()).toBe("original Neovim");
  const firstRelease = await readlink(join(home, ".nox-home/current"));
  expect(firstRelease).toStartWith("releases/");

  const mounted = join(root, "workspace-home");
  await rename(home, mounted);
  expect(await Bun.file(join(mounted, ".config/nvim/lua/plugins/theme.lua")).text()).toBe(await Bun.file(join(imageNvim, "lua/plugins/theme.lua")).text());
  expect(await Bun.file(join(mounted, ".zshrc")).text()).toBe("# cloud profile");
  await writeFile(join(root, "dotfiles/zsh/cloud.zsh"), "# updated cloud profile");
  expect((await snapshot(root, output)).code).toBe(0);
  install(mounted);
  expect(await Bun.file(join(mounted, ".zshrc")).text()).toBe("# updated cloud profile");
  expect(await Bun.file(join(mounted, ".bashrc")).text()).toBe('keep Bash unchanged\nsource "$HOME/.config/nox-shell/bashrc"\n');
  expect(await Bun.file(join(mounted, ".nox-home/backups", backup!, ".bashrc")).text()).toBe("keep Bash unchanged");
  expect(await Bun.file(join(mounted, ".profile")).text()).toBe("keep login settings unchanged");
  expect(await Bun.file(join(mounted, ".nox-home", firstRelease, ".zshrc")).text()).toBe("# cloud profile");
  expect(await Bun.file(join(mounted, ".nox-home/backups", backup!, ".zshrc")).text()).toBe("original shell");
});

test("changed palette format fails before publishing a partial snapshot", async () => {
  const { root, output } = await fixture();
  await writeFile(join(root, "dotfiles/zsh/.zshrc"), "source ~/.secrets/env\n");
  expect((await snapshot(root, output)).code).not.toBe(0);
  expect(await Bun.file(output).exists()).toBe(false);
});
