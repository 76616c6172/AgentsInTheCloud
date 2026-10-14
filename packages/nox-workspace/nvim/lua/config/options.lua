require("config.remote_clipboard").setup()
-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

-- vim.opt.lazyredraw = true
-- vim.opt.startofline = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.softtabstop = 2
vim.opt.showtabline = 2
vim.opt.expandtab = true
vim.opt.guifont = "IosevkaTerm Nerd Font Propo"
--vim.opt.guifont = "EnvyCodeRNerdFontMono-Regular"
vim.opt.linespace = 2
vim.opt.completeopt = "menuone,noinsert,noselect"
vim.opt.laststatus = 0
vim.opt.termguicolors = true
vim.opt.fillchars:append({ vert = " " })
vim.g.python_recommended_style = 0
vim.opt.guicursor =
  "n-v-c-sm:block-Cursor/lCursor-blinkwait700-blinkoff400-blinkon250,ve:ver25-Cursor/lCursor,o:hor50-Cursor/lCursor,i-ci:ver25-Cursor/lCursor,r-cr:hor20-Cursor/lCursor"
-- For init.lua
-- vim.opt.cursorline = true
-- vim.cmd("highlight clear CursorLine")
--vim.cmd("highlight CursorLineNr term=bold cterm=bold gui=bold")
vim.opt.number = true
vim.opt.signcolumn = "yes:1" -- Reduce sign column width to minimum
vim.opt.numberwidth = 1 -- Minimize the width of the number column
vim.opt.relativenumber = false

-- Enable line number highlighting
vim.opt.cursorline = true -- Highlights the entire current line
vim.opt.cursorlineopt = "number" -- Only highlight the line number
