return {
  "lewis6991/satellite.nvim",
  event = "VeryLazy",
  opts = {
    current_only = true,
    winblend = 0,
    zindex = 40,
    excluded_filetypes = { "lazy", "neo-tree", "help", "alpha", "dashboard", "Trouble", "noice", "notify" },
    width = 1,
    handlers = {
      cursor = { enable = true, symbols = { "🬃" } },
      search = { enable = true },
      diagnostic = { enable = true },
      gitsigns = { enable = true },
      marks = { enable = false },
    },
  },
  config = function(_, opts)
    require("satellite").setup(opts)

    local bar_timer = nil
    local fade_timer = nil
    local search_timer = nil
    local bar_visible = false
    local bar_fade_steps = {
      "#2a2e36",
      "#272b33",
      "#242830",
      "#21252c",
      "#1e2228",
      "NONE",
    }
    local bar_fade_interval_ms = 70
    local bar_linger_ms = 260

    local function cleanup_timer(t)
      if t then
        t:stop()
        t:close()
      end
      return nil
    end

    local function fade_bar_out()
      fade_timer = cleanup_timer(fade_timer)
      local step = 0
      fade_timer = vim.uv.new_timer()
      fade_timer:start(
        0,
        bar_fade_interval_ms,
        vim.schedule_wrap(function()
          step = step + 1
          local bg = bar_fade_steps[step]
          if bg then
            vim.api.nvim_set_hl(0, "SatelliteBar", { bg = bg, fg = "NONE" })
          else
            fade_timer = cleanup_timer(fade_timer)
            bar_visible = false
          end
        end)
      )
    end

    local function bar_on()
      if not bar_visible then
        vim.api.nvim_set_hl(0, "SatelliteBar", { bg = "#2a2e36", ctermbg = "NONE", fg = "NONE" })
        bar_visible = true
      end
      bar_timer = cleanup_timer(bar_timer)
      fade_timer = cleanup_timer(fade_timer)
      bar_timer = vim.uv.new_timer()
      bar_timer:start(bar_linger_ms, 0, vim.schedule_wrap(fade_bar_out))
    end

    local function search_ping()
      vim.api.nvim_set_hl(0, "SatelliteSearch", { fg = "#7c8a9e", bg = "NONE" })
      search_timer = cleanup_timer(search_timer)
      search_timer = vim.uv.new_timer()
      search_timer:start(
        200,
        0,
        vim.schedule_wrap(function()
          vim.api.nvim_set_hl(0, "SatelliteSearch", { fg = "#3e4451", bg = "NONE" })
          search_timer = cleanup_timer(search_timer)
        end)
      )
    end

    local function set_satellite_highlights()
      vim.api.nvim_set_hl(0, "SatelliteBackground", { bg = "NONE", ctermbg = "NONE" })
      vim.api.nvim_set_hl(0, "SatelliteBar", { bg = "NONE", fg = "NONE" })
      vim.api.nvim_set_hl(0, "SatelliteCursor", { fg = "#5c6370", bg = "NONE" })
      vim.api.nvim_set_hl(0, "SatelliteSearch", { fg = "#3e4451", bg = "NONE" })
      -- Git patina: muted, earthy tones
      vim.api.nvim_set_hl(0, "SatelliteGitSignsAdd", { fg = "#3f5b3f", bg = "NONE" })
      vim.api.nvim_set_hl(0, "SatelliteGitSignsChange", { fg = "#4a5450", bg = "NONE" })
      vim.api.nvim_set_hl(0, "SatelliteGitSignsDelete", { fg = "#5b3f3f", bg = "NONE" })
      bar_visible = false
    end

    set_satellite_highlights()

    local group = vim.api.nvim_create_augroup("SatelliteHighlights", { clear = true })
    vim.api.nvim_create_autocmd("ColorScheme", {
      group = group,
      callback = set_satellite_highlights,
    })
    vim.api.nvim_create_autocmd("WinScrolled", {
      group = group,
      callback = bar_on,
    })
    vim.api.nvim_create_autocmd("CmdlineEnter", {
      group = group,
      pattern = { "/", "?" },
      callback = search_ping,
    })
  end,
}
