-- Tune blink.cmp for snappier completions
return {
  {
    "saghen/blink.cmp",
    opts = {
      cmdline = {
        enabled = false,
      },
      sources = {
        providers = {
          lsp = {
            timeout_ms = 500,
            async = true,
          },
        },
      },
      completion = {
        trigger = {
          show_on_insert_on_trigger_character = false,
        },
        list = {
          max_items = 20,
        },
        menu = {
          border = "rounded",
          winhighlight = "Normal:BlinkCmpMenu,FloatBorder:BlinkCmpBorder,CursorLine:BlinkCmpMenuSelection,Search:None",
        },
        documentation = {
          window = {
            border = "rounded",
            winhighlight = "Normal:BlinkCmpDoc,FloatBorder:BlinkCmpBorder,CursorLine:BlinkCmpDocCursorLine,Search:None",
          },
        },
      },
    },
  },
}
