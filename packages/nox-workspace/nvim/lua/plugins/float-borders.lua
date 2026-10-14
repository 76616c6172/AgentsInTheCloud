-- Subtle rounded borders for all floating windows
return {
  -- Noice: LSP hover + signature help borders
  {
    "folke/noice.nvim",
    opts = {
      cmdline = {
        enabled = true,
        view = "cmdline",
      },
      popupmenu = {
        enabled = false,
      },
      lsp = {
        hover = {
          silent = true,
        },
      },
      presets = {
        command_palette = false,
        lsp_doc_border = true,
      },
    },
  },

  -- LSP diagnostics float border
  {
    "neovim/nvim-lspconfig",
    opts = {
      diagnostics = {
        float = {
          border = "rounded",
        },
      },
    },
  },

  -- Subtle border highlights (shared across all floats)
  {
    "LazyVim/LazyVim",
    opts = function()
      vim.api.nvim_create_autocmd("ColorScheme", {
        group = vim.api.nvim_create_augroup("MinimalFloatBorders", { clear = true }),
        callback = function()
          local border_fg = "#2b2f38"
          vim.api.nvim_set_hl(0, "BlinkCmpBorder", { fg = border_fg, bg = "NONE" })
          vim.api.nvim_set_hl(0, "BlinkCmpMenu", { link = "NormalFloat" })
          vim.api.nvim_set_hl(0, "BlinkCmpDoc", { link = "NormalFloat" })
          vim.api.nvim_set_hl(0, "FloatBorder", { fg = border_fg, bg = "NONE" })
          vim.api.nvim_set_hl(0, "WinSeparator", { fg = "NONE", bg = "NONE" })
          vim.api.nvim_set_hl(0, "NeoTreeWinSeparator", { fg = "NONE", bg = "NONE" })
          vim.api.nvim_set_hl(0, "NeoTreeVertSplit", { fg = "NONE", bg = "NONE" })
        end,
      })
      -- Apply immediately
      local border_fg = "#2b2f38"
      vim.api.nvim_set_hl(0, "BlinkCmpBorder", { fg = border_fg, bg = "NONE" })
      vim.api.nvim_set_hl(0, "BlinkCmpMenu", { link = "NormalFloat" })
      vim.api.nvim_set_hl(0, "BlinkCmpDoc", { link = "NormalFloat" })
      vim.api.nvim_set_hl(0, "FloatBorder", { fg = border_fg, bg = "NONE" })
      vim.api.nvim_set_hl(0, "WinSeparator", { fg = "NONE", bg = "NONE" })
      vim.api.nvim_set_hl(0, "NeoTreeWinSeparator", { fg = "NONE", bg = "NONE" })
      vim.api.nvim_set_hl(0, "NeoTreeVertSplit", { fg = "NONE", bg = "NONE" })
    end,
  },
}
