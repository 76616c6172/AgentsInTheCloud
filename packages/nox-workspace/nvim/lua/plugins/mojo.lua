return {
  {
    "neovim/nvim-lspconfig",
    opts = function(_, opts)
      -- Manually add filetype detection for Mojo since we aren't using a syntax plugin
      vim.filetype.add({
        extension = {
          mojo = "mojo",
        },
      })

      -- Register the Mojo LSP with LazyVim's server management
      opts.servers = opts.servers or {}
      opts.servers.mojo = vim.tbl_deep_extend("force", opts.servers.mojo or {}, {})
    end,
  },
}
