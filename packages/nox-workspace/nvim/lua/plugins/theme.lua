return {
  {
    { "nvim-neo-tree/neo-tree.nvim", enabled = false },
    {
      "nvim-lualine/lualine.nvim",
      enabled = false,
    },
    {
      "webhooked/oscura.nvim",
      lazy = false,
      priority = 1000,
      opts = {},
      config = function()
        vim.cmd.colorscheme("oscura-dusk")
      end,
    },

    {
      "akinsho/bufferline.nvim",
      opts = function(_, opts)
        opts.options = {
          indicator = {
            style = "none",
          },
          numbers = "none",
          show_buffer_close_icons = false,
          show_buffer_icons = false,
          show_tab_indicators = false,
          color_icons = true,
          themable = true,
          separator_style = { "", "" },
          hover = {
            enabled = true,
            delay = 10,
            reveal = { "close" },
          },
        }
        return opts
      end,
    },
  },
}
