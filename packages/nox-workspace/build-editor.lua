-- Run after every locked plugin has been checked out, so installation cannot
-- accidentally initialize half a LazyVim configuration on the user's first launch.
local function build()
  local lazy = require("lazy")
  local plugins = require("lazy.core.config").plugins
  local urls = vim.json.decode(table.concat(vim.fn.readfile("/opt/agents-in-the-cloud/nox-editor/plugins.json"), "\n"))
  for name in pairs(plugins) do
    assert(urls[name], "Add the configured plugin to the image manifest: " .. name)
  end
  lazy.build({ plugins = vim.tbl_keys(plugins), wait = true, show = false })
  for name, plugin in pairs(plugins) do
    for _, task in ipairs(plugin._.tasks or {}) do
      assert(not task:has_errors(), "Plugin build failed: " .. name)
    end
  end

  lazy.load({ plugins = { "mason.nvim", "nvim-lspconfig", "nvim-treesitter", "blink.cmp" } })
  local registry = require("mason-registry")
  local refreshed = false
  registry.refresh(function() refreshed = true end)
  assert(vim.wait(300000, function() return refreshed end, 100), "Mason registry refresh timed out")
  local tools = {}
  for _, name in ipairs(LazyVim.opts("mason.nvim").ensure_installed) do tools[name] = true end
  local mappings = require("mason-lspconfig.mappings").get_mason_map().lspconfig_to_package
  for name, opts in pairs(LazyVim.opts("nvim-lspconfig").servers) do
    if opts ~= false and mappings[name] then tools[mappings[name]] = true end
  end
  -- These formatters/linters are configured outside Mason's ensure_installed list.
  tools.prettier = true
  for name in pairs(tools) do
    local package = registry.get_package(name)
    if not package:is_installed() and not package:is_installing() then package:install() end
  end
  assert(vim.wait(1200000, function()
    for name in pairs(tools) do
      if registry.get_package(name):is_installing() then return false end
    end
    return true
  end, 100), "Mason installation timed out")

  local ts = require("nvim-treesitter")
  local parsers = LazyVim.opts("nvim-treesitter").ensure_installed
  ts.install(parsers):wait(1200000)
  local installed = vim.tbl_contains
  for _, name in ipairs(parsers) do
    assert(installed(ts.get_installed(), name), "Missing parser: " .. name)
  end
  for name in pairs(tools) do assert(registry.get_package(name):is_installed(), "Missing tool: " .. name) end
  assert(vim.uv.fs_stat(plugins["telescope-fzf-native.nvim"].dir .. "/build/libfzf.so"), "Missing native fzf build")
  vim.cmd.colorscheme("oscura-dusk")
  assert(vim.g.colors_name == "oscura", "Oscura did not load")
  assert(vim.treesitter.language.add("markdown"), "Markdown parser did not load")
  vim.fn.writefile({ vim.json.encode({ plugins = vim.tbl_keys(plugins), tools = vim.tbl_keys(tools), parsers = parsers }) },
    "/opt/agents-in-the-cloud/nox-editor/installed.json")
end

vim.schedule(function()
  local ok, err = xpcall(build, debug.traceback)
  if not ok then
    io.stderr:write(err .. "\n")
    vim.cmd("cquit 1")
  else
    vim.cmd("qa!")
  end
end)
