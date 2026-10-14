return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    opts = {
      heading = {
        -- Conceal '#'-style markers off-cursor; reveal raw syntax on cursor line.
        -- Use inline so hidden markers do not leave visual indentation.
        position = "inline",
        icons = { "", "", "", "", "", "" },
        -- Keep heading color, but avoid painting the whole line background.
        backgrounds = {
          "RenderMarkdownH1",
          "RenderMarkdownH2",
          "RenderMarkdownH3",
          "RenderMarkdownH4",
          "RenderMarkdownH5",
          "RenderMarkdownH6",
        },
      },
      bullet = {
        -- Keep plain Markdown list markers instead of replacing '-' with fat icons.
        enabled = false,
      },
    },
    config = function(_, opts)
      require("render-markdown").setup(opts)

      local function set_markdown_highlights()
        local colors = {
          "#E6E7A3",
          "#F9B98C",
          "#A1C181",
          "#4EBE96",
          "#479FFA",
          "#D84F68",
        }

        for level, color in ipairs(colors) do
          vim.api.nvim_set_hl(0, "RenderMarkdownH" .. level, { fg = color, bg = "NONE", bold = true })
        end

        local code_bg = "#131419"
        vim.api.nvim_set_hl(0, "RenderMarkdownCode", { bg = code_bg })
        vim.api.nvim_set_hl(0, "RenderMarkdownCodeBorder", { bg = code_bg })
        vim.api.nvim_set_hl(0, "RenderMarkdownCodeInline", { bg = code_bg })
      end

      set_markdown_highlights()
      vim.api.nvim_create_autocmd("ColorScheme", {
        callback = set_markdown_highlights,
      })
    end,
  },
}
