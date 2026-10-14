#!/usr/bin/env bash
# Run manually against an immutable workspace image, using the selected Docker context.
# Both launches have fresh private mounts and no network, just like separate workspaces.
set -Eeuo pipefail
[[ $# == 1 ]] || { echo 'Usage: bash acceptance/nox-editor.sh WORKSPACE_IMAGE' >&2; exit 2; }
for launch in 1 2; do
  printf '\nFresh offline editor launch %s\n' "$launch"
  docker run --rm -i --network none --user 1000:1000 \
    --tmpfs /home/agents-in-the-cloud:uid=1000,gid=1000,mode=700 \
    --tmpfs /home/agents-in-the-cloud/.local/share:uid=1000,gid=1000 \
    --tmpfs /home/agents-in-the-cloud/.local/state:uid=1000,gid=1000 \
    --tmpfs /home/agents-in-the-cloud/.cache:uid=1000,gid=1000 \
    --tmpfs /work:uid=1000,gid=1000 \
    --entrypoint bash "$1" -s <<'CONTAINER'
set -Eeuo pipefail
export HOME=/home/agents-in-the-cloud
mkdir -p "$HOME/.config"
cp -R /opt/agents-in-the-cloud/home-defaults/.config/nvim "$HOME/.config/nvim"
cd /work
git init -q
printf 'module example.invalid/offline\n\ngo 1.23\n' > go.mod
printf '{"private":true,"type":"module"}\n' > package.json
printf '{"compilerOptions":{"target":"ES2022"}}\n' > tsconfig.json
cat > /tmp/verify-editor.lua <<'LUA'
local function verify()
  local root = "/opt/agents-in-the-cloud/nox-editor"
  local data = root .. "/data/nvim"
  assert(vim.fn.stdpath("data") == data, "Private home masked the baked editor data")
  assert(vim.fn.stdpath("state"):match("^/home/agents%-in%-the%-cloud/"), "Editor state is not private")
  assert(vim.fn.stdpath("cache"):match("^/home/agents%-in%-the%-cloud/"), "Editor cache is not private")
  local inventory = vim.json.decode(table.concat(vim.fn.readfile(root .. "/installed.json"), "\n"))
  local lock = vim.json.decode(table.concat(vim.fn.readfile(vim.fn.stdpath("config") .. "/lazy-lock.json"), "\n"))
  for _, name in ipairs(inventory.plugins) do
    local head = vim.fn.readfile(data .. "/lazy/" .. name .. "/.git/HEAD")[1]
    assert(head == lock[name].commit, "Wrong plugin revision: " .. name)
  end
  require("lazy").load({ plugins = { "mason.nvim", "blink.cmp", "telescope.nvim" } })
  for _, name in ipairs(inventory.tools) do
    assert(require("mason-registry").get_package(name):is_installed(), "Missing tool: " .. name)
  end
  for _, name in ipairs(inventory.parsers) do
    assert(vim.treesitter.language.add(name), "Cannot load parser: " .. name)
  end
  assert(vim.uv.fs_stat(data .. "/lazy/blink.cmp/target/release/libblink_cmp_fuzzy.so"), "Missing native completion")
  assert(vim.fn.executable(data .. "/lazy/markdown-preview.nvim/app/bin/markdown-preview-linux") == 1, "Missing Markdown preview")
  assert(vim.fn.executable("clang-tidy") == 1, "Missing C/C++ linter")
  assert(vim.fn.executable("gotests") == 1, "Missing Go tools")
  vim.cmd.colorscheme("oscura-dusk")
  assert(vim.g.colors_name == "oscura", "Wrong colorscheme")
  local probes = {
    { "offline.md", { "# Offline editor", "", "Everything is already installed." }, "marksman" },
    { "main.py", { "answer = 42" }, "pyright" },
    { "main.ts", { "export const answer: number = 42;" }, "ts_ls" },
    { "main.go", { "package main", "func main() {}" }, "gopls" },
    { "main.c", { "int main(void) { return 0; }" }, "clangd" },
  }
  for _, probe in ipairs(probes) do
    vim.fn.writefile(probe[2], "/work/" .. probe[1])
    vim.cmd.edit("/work/" .. probe[1])
    assert(vim.wait(30000, function()
      for _, client in ipairs(vim.lsp.get_clients({ bufnr = 0, name = probe[3] })) do
        if client.initialized then return true end
      end
      return false
    end, 100), "Language server did not initialize offline: " .. probe[3])
    assert(vim.treesitter.get_parser():parse()[1], "Cannot parse " .. probe[1])
    io.stdout:write("Offline language server ready: " .. probe[3] .. "\n")
  end
  assert(vim.fn.writefile({ "workspace-local writable layer" }, data .. "/offline-write-probe") == 0)
  io.stdout:write(vim.json.encode({ plugins = #inventory.plugins, tools = #inventory.tools, parsers = #inventory.parsers, offline = true }) .. "\n")
end
vim.schedule(function()
  local ok, err = xpcall(verify, debug.traceback)
  if not ok then
    io.stderr:write(err .. "\n")
    vim.cmd("cquit 1")
  else
    vim.cmd("qa!")
  end
end)
LUA
nvim --headless '+lua dofile("/tmp/verify-editor.lua")'
CONTAINER
done
