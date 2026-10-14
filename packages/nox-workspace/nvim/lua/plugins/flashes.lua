return {
  "folke/flash.nvim",
  event = "VeryLazy",
  ---@type Flash.Config
  opts = {
    label = {
      rainbow = { enabled = false },
    },
    highlight = {
      backdrop = true,
      groups = {
        label = "",
      },
    },
    modes = {
      search = { enabled = true },
      char = {
        enabled = true,
        jump_labels = false,
      },
    },
  },
  keys = {
    {
      "s",
      mode = { "n", "x" },
      function()
        require("flash").jump()
      end,
      desc = "Flash",
    },
    {
      "S",
      mode = { "n", "x", "o" },
      function()
        require("flash").treesitter()
      end,
      desc = "Flash Treesitter",
    },
  },
}
