-- Make highlight groups transparent while preserving their other attributes
local function make_transparent(name)
	local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = name, link = false })
	if ok then
		hl.bg = nil
		hl.ctermbg = nil
		hl.default = nil -- Replace existing highlights, including plugin defaults.
		vim.api.nvim_set_hl(0, name, hl)
	end
end

local groups = {
	-- transparent background
	"Normal",
	"NormalFloat",
	"FloatBorder",
	"Pmenu",
	"Terminal",
	"EndOfBuffer",
	"FoldColumn",
	"Folded",
	"SignColumn",
	"LineNr",
	"CursorLineNr",
	"NormalNC",
	"WhichKeyFloat",
	"TelescopeBorder",
	"TelescopeNormal",
	"TelescopePromptBorder",
	"TelescopePromptTitle",
	-- neotree
	"NeoTreeNormal",
	"NeoTreeNormalNC",
	"NeoTreeVertSplit",
	"NeoTreeWinSeparator",
	"NeoTreeEndOfBuffer",
	-- nvim-tree
	"NvimTreeNormal",
	"NvimTreeVertSplit",
	"NvimTreeEndOfBuffer",
	-- notify
	"NotifyINFOBody",
	"NotifyERRORBody",
	"NotifyWARNBody",
	"NotifyTRACEBody",
	"NotifyDEBUGBody",
	"NotifyINFOTitle",
	"NotifyERRORTitle",
	"NotifyWARNTitle",
	"NotifyTRACETitle",
	"NotifyDEBUGTitle",
	"NotifyINFOBorder",
	"NotifyERRORBorder",
	"NotifyWARNBorder",
	"NotifyTRACEBorder",
	"NotifyDEBUGBorder",
}

local function apply_transparency()
	for _, name in ipairs(groups) do
		make_transparent(name)
	end

	-- Include every bufferline state, diagnostic, separator, and the empty bar.
	for name in pairs(vim.api.nvim_get_hl(0, {})) do
		if name:match("^BufferLine") then
			make_transparent(name)
		end
	end
end

local group = vim.api.nvim_create_augroup("UserTransparency", { clear = true })
vim.api.nvim_create_autocmd("ColorScheme", {
	group = group,
	-- Run after plugins have rebuilt their highlights for the new theme.
	callback = function()
		vim.schedule(apply_transparency)
	end,
})
vim.api.nvim_create_autocmd("User", {
	group = group,
	pattern = "LazyLoad",
	callback = function(event)
		if event.data == "bufferline.nvim" then
			vim.schedule(apply_transparency)
		end
	end,
})

apply_transparency()
