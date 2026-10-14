-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
vim.keymap.set("n", "<C-p>", function()
  require("telescope.builtin").find_files()
end)
vim.keymap.set("n", "<C-g>", function()
  require("telescope.builtin").git_status()
end, { desc = "Git changed files" })
vim.keymap.set("n", "<C-f>", function()
  require("telescope.builtin").live_grep()
end)

vim.keymap.set("n", "<C-e>", "<cmd>Neotree toggle<cr>", { desc = "Toggle file tree" })

local bufferline = require("bufferline")
for i = 1, 9 do
  vim.keymap.set("n", "<leader>" .. i, function()
    bufferline.go_to(i, true)
  end, { desc = "Go to buffer " .. i })
end

-- Optional: Map <leader>0 to the last buffer
vim.keymap.set("n", "<leader>0", function()
  bufferline.go_to(-1, true)
end, { desc = "Go to last buffer" })

-- Scroll viewport without moving cursor (like vscode)
vim.keymap.set({ "n", "v" }, "<ScrollWheelUp>", "<C-y>")
vim.keymap.set({ "n", "v" }, "<ScrollWheelDown>", "<C-e>")
vim.keymap.set("i", "<ScrollWheelUp>", "<C-o><C-y>")
vim.keymap.set("i", "<ScrollWheelDown>", "<C-o><C-e>")

vim.keymap.set("n", "<Esc>", function()
  vim.cmd("nohlsearch")
  vim.diagnostic.hide()
end, { desc = "Clear search + diagnostics noise" })

vim.keymap.set({ "n", "i", "x" }, "<C-s>", function()
  vim.cmd("silent write")
end, { desc = "Save file" })
