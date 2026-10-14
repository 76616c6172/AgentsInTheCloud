-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`

-- Set filetype for templ files
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = "*.templ",
  callback = function()
    vim.bo.filetype = "templ"
  end,
})

-- Render Markdown nicely while revealing raw syntax on the cursor line
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown", "markdown.mdx" },
  callback = function()
    vim.opt_local.conceallevel = 2
    vim.opt_local.concealcursor = ""
    vim.opt_local.spell = false
  end,
})

-- Configure 2-space indentation for ALL programming languages
vim.api.nvim_create_autocmd("FileType", {
  pattern = {
    "python",
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
    "c",
    "cpp",
    "go",
    "json",
    "html",
    "css",
    "templ",
  },
  callback = function()
    vim.bo.shiftwidth = 2
    vim.bo.tabstop = 2
    vim.bo.softtabstop = 2
    vim.bo.expandtab = true
  end,
})

-- Enhanced LSP keymaps for better documentation support
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("UserLspConfig", { clear = true }),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    local bufnr = ev.buf

    -- Enable hover documentation with Ctrl+K and K
    if client and client.server_capabilities.hoverProvider then
      vim.keymap.set("n", "<C-k>", vim.lsp.buf.hover, {
        buffer = bufnr,
        desc = "Show hover documentation",
        silent = true,
      })
      vim.keymap.set("n", "K", vim.lsp.buf.hover, {
        buffer = bufnr,
        desc = "Show hover documentation",
        silent = true,
      })
    end

    -- Additional useful LSP keymaps
    vim.keymap.set("n", "gd", vim.lsp.buf.definition, { buffer = bufnr, desc = "Go to definition" })
    vim.keymap.set("n", "gr", vim.lsp.buf.references, { buffer = bufnr, desc = "Go to references" })
    vim.keymap.set("n", "gi", vim.lsp.buf.implementation, { buffer = bufnr, desc = "Go to implementation" })
    vim.keymap.set("n", "<leader>r", vim.lsp.buf.rename, { buffer = bufnr, desc = "Rename symbol" })
  end,
})
