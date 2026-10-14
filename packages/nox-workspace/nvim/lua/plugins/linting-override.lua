return {
  -- Configure nvim-lint (replaces LazyVim's default linting)
  {
    "mfussenegger/nvim-lint",
    event = "VeryLazy",
    config = function()
      local lint = require("lint")
      -- Configure linters for each language
      lint.linters_by_ft = {
        python = { "ruff" },
        c = { "clangtidy" },
        cpp = { "clangtidy" },
        go = { "golangcilint" },
      }
      -- Only run linting on file save
      vim.api.nvim_create_autocmd({ "BufWritePost" }, {
        group = vim.api.nvim_create_augroup("custom-lint-on-save", { clear = true }),
        callback = function(ev)
          if vim.bo[ev.buf].buftype ~= "" then
            return
          end
          vim.diagnostic.show(nil, ev.buf)
          lint.try_lint(nil, { buf = ev.buf })
        end,
      })
      -- Hide diagnostics when entering insert mode
      vim.api.nvim_create_autocmd("InsertEnter", {
        group = vim.api.nvim_create_augroup("hide-diagnostics-insert", { clear = true }),
        callback = function()
          vim.diagnostic.hide()
        end,
      })
    end,
  },
  -- Enhanced LSP configuration
  {
    "neovim/nvim-lspconfig",
    opts = function(_, opts)
      -- Disable update_in_insert for diagnostics
      opts.diagnostics = opts.diagnostics or {}
      opts.diagnostics.update_in_insert = false
      opts.diagnostics.virtual_text = {
        spacing = 4,
        source = "if_many",
        prefix = "●",
      }
      return opts
    end,
  },
  -- conform.nvim configuration with AST-aware formatters
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        python = { "ruff_format" },
        c = { "clang_format" },
        cpp = { "clang_format" },
        javascript = { "prettier" },
        typescript = { "prettier" },
        javascriptreact = { "prettier" },
        typescriptreact = { "prettier" },
        json = { "prettier" },
        go = { "goimports", "gofumpt" },
        templ = { "templ" },
      },
      formatters = {
        ruff_format = {
          command = "ruff",
          args = { "format", "--stdin-filename", "$FILENAME", "--indent-width", "2", "-" },
          stdin = true,
        },
        clang_format = {
          prepend_args = {
            "--style={IndentWidth: 2, UseTab: Never, ColumnLimit: 200, IndentCaseLabels: true, AllowShortFunctionsOnASingleLine: None}",
          },
        },
        prettier = {
          prepend_args = {
            "--tab-width",
            "2",
            "--print-width",
            "200",
            "--single-quote",
            "--trailing-comma",
            "es5",
          },
        },
      },
    },
  },
}
