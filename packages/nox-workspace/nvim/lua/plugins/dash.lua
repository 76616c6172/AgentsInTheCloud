return {
  "nvimdev/dashboard-nvim",
  lazy = false,
  opts = function()
    local logo = [[
    nvim
    ]]
    logo = string.rep("\n", 8) .. logo .. "\n\n"

    local opts = {
      theme = "doom",
      hide = {
        statusline = false,
      },
      config = {
        header = vim.split(logo, "\n"),
        center = {
          { action = "ene | startinsert", desc = " New File", icon = " ", key = "n" },
          { action = 'lua LazyVim.pick("oldfiles")()', desc = " Recent Files", icon = " ", key = "r" },
          {
            action = function()
              local dir = vim.fn.expand("~/.obsidian")
              vim.cmd.cd(dir)
              vim.cmd.edit(dir)
            end,
            desc = " Obsidian",
            icon = "󰈙 ",
            key = "o",
          },
          { action = "Lazy", desc = " Lazy", icon = "󰒲 ", key = "l" },
          {
            action = function()
              vim.api.nvim_input("<cmd>qa<cr>")
            end,
            desc = " Quit",
            icon = " ",
            key = "q",
          },
        },
        footer = function()
          local stats = require("lazy").stats()
          local ms = (math.floor(stats.startuptime * 100 + 0.5) / 100)
          return { "⚡ Neovim loaded " .. stats.loaded .. "/" .. stats.count .. " plugins in " .. ms .. "ms" }
        end,
      },
    }

    local max_desc_width = 0
    for _, button in ipairs(opts.config.center) do
      max_desc_width = math.max(max_desc_width, vim.api.nvim_strwidth(button.desc))
    end

    for _, button in ipairs(opts.config.center) do
      button.desc = button.desc .. string.rep(" ", max_desc_width - vim.api.nvim_strwidth(button.desc))
      button.key_format = "  %s"
    end

    if vim.o.filetype == "lazy" then
      vim.api.nvim_create_autocmd("WinClosed", {
        pattern = tostring(vim.api.nvim_get_current_win()),
        once = true,
        callback = function()
          vim.schedule(function()
            vim.api.nvim_exec_autocmds("UIEnter", { group = "dashboard" })
          end)
        end,
      })
    end

    return opts
  end,
}
