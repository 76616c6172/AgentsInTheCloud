import {
	defineTool, getLanguageFromPath, highlightCode, withFileMutationQueue,
	type ExtensionAPI, type Theme,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { readText, editText, openDocument } from "./backend.mjs";

const object = (properties: Record<string, any>) => Type.Object(properties, { additionalProperties: false });
const optional = (description: string) => Type.Optional(Type.String({ description }));
const address = "Copy a fresh two-character hash address: 12|Py| or 12|Py|,15|HD|. 0|AA| inserts before line 1/creates a file. Bare line numbers are print-only; %/$ mutations require allowUnverified.";
const command = object({
	address: Type.String({ description: address }),
	op: StringEnum(["substitute", "delete", "append", "insert", "change", "join", "move", "copy", "indent", "dedent", "sort", "print", "transliterate"] as const),
	path: optional("Override the call's default file for this command. Paths are separate from addresses; never embed a filename in address."),
	cell: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Notebook cell ID/prefix; overrides default cell. Set null for raw file when a default cell is set." })),
	pattern: optional("substitute: fancy-regex pattern, including lookaround/backreferences. Literal newlines can match across an addressed range."),
	replacement: optional("substitute: replacement template. $1/$0/${name}; ${1}suffix disambiguates; $$ is a literal dollar. Backslashes are literal, not command-delimiter escapes."),
	global: Type.Optional(Type.Boolean({ description: "substitute: replace all matches, not just the first per line" })),
	caseInsensitive: Type.Optional(Type.Boolean({ description: "substitute: case-insensitive matching" })),
	text: optional("append/insert/change: literal text; no dot terminator or escaping. A final newline ends the last line; x\n\n adds a blank line. Empty change deletes its range."),
	destination: optional("move/copy: insert after this fresh address; 0|AA| means the beginning. Use destinationPath/destinationCell for transfers; no filename prefixes."),
	destinationPath: optional("move/copy: destination file (default: source file)"),
	destinationCell: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "move/copy: destination cell ID/prefix. Default: source cell for same-file transfers; null explicitly selects raw file." })),
	levels: Type.Optional(Type.Integer({ minimum: 0, maximum: 256, description: "indent/dedent: levels, default 1" })),
	sourceChars: optional("transliterate: source characters"),
	targetChars: optional("transliterate: corresponding replacement characters; same character count as sourceChars"),
	where: optional("Filter addressed lines with this fancy-regex, then apply the operation to each match (ex g). Not supported for move/copy; no nested filters."),
	invert: Type.Optional(Type.Boolean({ description: "With where, operate on NON-matching lines (ex v)" })),
});
const readSchema = object({
	path: Type.String({ description: "UTF-8 file path, relative/absolute; ~ supported" }),
	cell: optional("Read notebook cell source by exact ID or unique prefix. Use exhash_open to list cells."),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Start at this source line (default 1); also the continuation cursor for pattern searches" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: "Maximum returned lines (default 2000)" })),
	pattern: optional("Return only source lines matching this fancy-regex. Use (?i) for case-insensitive matching. Results retain edit-ready addresses."),
});
const editSchema = object({
	path: Type.String({ description: "Default file path, relative/absolute; ~ supported" }),
	cell: optional("Default notebook cell ID/prefix. Omit for ordinary files. Never mix raw notebook and cell edits in one call."),
	commands: Type.Array(command, { minItems: 1, maxItems: 500, description: "Commands in execution order; structural edits bottom-to-top. Single-line in-place edits may reuse their call-start hash." }),
	shiftWidth: Type.Optional(Type.Integer({ minimum: 0, maximum: 256, description: "Spaces per indent level; default 4" })),
	dryRun: Type.Optional(Type.Boolean({ description: "Preview the complete batch and validate every command without writing. Preview hashes describe hypothetical output, not the unchanged disk file." })),
	allowUnverified: Type.Optional(Type.Boolean({ description: "Explicitly permit hashless % (whole buffer) and $ (last line) edits. Prefer verified ranges; default false." })),
});
const openSchema = object({
	path: Type.String({ description: "Local Markdown/source/notebook path or explicit http(s) document URL" }),
	cell: optional("Notebook cell to navigate. Without cell, notebooks show a cell index."),
	language: Type.Optional(StringEnum(["python", "javascript", "typescript", "tsx", "rust", "zig", "swift"] as const, { description: "Override code language, especially for notebook cells; otherwise inferred from extension" })),
	tokens: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 20, description: "Copied section tokens to view as hash-addressed source; verified against the freshly read document" })),
	pattern: optional("Instead of outline, search source with fancy-regex and return edit-ready matching lines. Mutually exclusive with tokens/links."),
	links: Type.Optional(Type.Boolean({ description: "Instead of outline, list Markdown inline links with resolved destinations; open one by passing its path/URL" })),
	depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Outline nesting depth" })),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Search continuation source line" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: "Search result limit" })),
});
const outputSchema = Type.Object({
	text: Type.String(), changed: Type.Array(Type.String()),
	fullOutputPath: Type.Optional(Type.String()),
	dryRun: Type.Optional(Type.Boolean()), committed: Type.Optional(Type.Boolean()),
	nextOffset: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
});

function result(value: any) {
	const { text, changed, fullOutputPath, dryRun, committed, nextOffset } = value;
	return {
		content: [{ type: "text" as const, text }],
		details: value,
		structuredContent: { text, changed, ...(fullOutputPath ? { fullOutputPath } : {}), ...(dryRun !== undefined ? { dryRun, committed } : {}), ...(nextOffset !== undefined ? { nextOffset } : {}) },
	};
}
function renderText(text: string, path: string, theme: Theme): Text {
	const language = getLanguageFromPath(path);
	const rendered = text.split("\n").map(line => {
		const match = /^(\s*\d+\|[A-Za-z0-9_-]{2}\|)(.*)$/.exec(line);
		if (match) {
			const content = match[2];
			return theme.fg("dim", match[1]) + (language ? (highlightCode(content, language)[0] ?? content) : theme.fg("toolOutput", content));
		}
		return theme.fg(line.startsWith("[") ? "warning" : "toolOutput", line);
	});
	return new Text(rendered.join("\n"), 0, 0);
}
function renderers(label: string) {
	return {
		renderCall(args: any, theme: Theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("accent", args.path ?? "…")}${args.cell ? ` [cell ${args.cell}]` : ""}${args.dryRun ? theme.fg("warning", " (preview)") : ""}`, 0, 0);
		},
		renderResult(value: any, options: any, theme: Theme, context: any) {
			const text = value.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
			if (options.isPartial) return new Text(theme.fg("muted", "working…"), 0, 0);
			if (context.isError) return new Text(theme.fg("error", text), 0, 0);
			if (!options.expanded) return new Text(theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
			return renderText(text, context.args?.path ?? "", theme);
		},
	};
}

// Optional integration for all three tools; execution and standalone rendering stay intact.
function registerDisplayedTool(pi: ExtensionAPI, tool: any, adapter: any = { kind: "read" }) {
	const globals = globalThis as any;
	const display = globals[Symbol.for("pi-tool-display.api.v1")];
	if (display?.version === 1 && typeof display.decorateTool === "function") pi.registerTool(display.decorateTool(tool, adapter));
	else {
		const key = Symbol.for("pi-tool-display.pendingDecorations.v1");
		(globals[key] ??= []).push({ tool, adapter });
		pi.registerTool(tool);
	}
}
export default function (pi: ExtensionAPI) {
	registerDisplayedTool(pi, defineTool({
		name: "exhash_read", label: "exhash read",
		description: "Read UTF-8 text or notebook cell source with upstream exhash lineno|hash| addresses (two Base64url characters). Optional regex search returns addressed matches. Up to 2000 lines/50 KiB; long lines are visibly clipped and full output saved. Use before editing.",
		promptSnippet: "Read/search files and notebook cells with verified edit addresses",
		promptGuidelines: ["Use exhash_read when an edit may follow; copy its two-character addresses exactly, never compute hashes.", "Use exhash_open to navigate large code/docs or discover notebook cell IDs."],
		annotations: { readOnlyHint: true, openWorldHint: false },
		parameters: readSchema, outputSchema,
		async execute(_id, params, signal, _update, ctx) { return result(await readText(params, ctx.cwd, signal)); },
		...renderers("exhash read"),
	}));
	const editTool = defineTool({
		name: "exhash_edit", label: "exhash edit",
		description: "Apply structured upstream exhash edits, optionally across files/notebook cells. All commands compute/validate before writing; single-file replacement is atomic. Multi-file commits are staged with best-effort rollback, not crash-atomic. Supports preview, regex filtering, transfers and printed verification. Dots/backslashes in literal text need no ex escaping. Unknown captures/no-match substitutions fail. Existing line endings and final-newline presence are preserved for ordinary files.",
		promptSnippet: "Verified structured edits, previews, filtered operations and file/cell transfers",
		promptGuidelines: [
			"Use fresh addresses from exhash_read/exhash_open; after stale errors re-read. Old four-hex addresses are invalid.",
			"Batch related commands; order structural changes bottom-to-top. Single-line in-place commands can share their original address within one batch; ranges cannot.",
			"Prefer move/copy for existing text and change for dollar-heavy literal text. Substitute uses $1/${name}; $$ means a literal dollar.",
			"Use where/invert to filter a verified range, dryRun for risky batches, and print to inspect final addressed lines. Preview output hashes are hypothetical.",
			"Source/destination file paths and cell IDs are separate fields, not part of an address. %/$ mutation needs explicit allowUnverified.",
			"After a partial-commit/recovery error, inspect affected files rather than blindly retrying.",
		],
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		parameters: editSchema, outputSchema,
		async execute(_id, params, signal, _update, ctx) { return result(await editText(params, ctx.cwd, signal, withFileMutationQueue)); },
		...renderers("exhash edit"),
	});
	registerDisplayedTool(pi, editTool, { kind: "edit", overrideExistingRenderers: true, renderCall: editTool.renderCall });
	registerDisplayedTool(pi, defineTool({
		name: "exhash_open", label: "exhash open",
		description: "Navigate local code/Markdown/notebooks or an explicit document URL using upstream tree-sitter/Markdown scanners. Default: section outline with verified range tokens (notebooks: cell index). Copy tokens to read sections, pattern to search, or links to list destinations. Local section ranges can feed exhash_edit; URLs are read-only.",
		promptSnippet: "Navigate code/doc outlines, verified sections, links and notebook cells",
		annotations: { readOnlyHint: true, openWorldHint: true },
		parameters: openSchema, outputSchema,
		async execute(_id, params, signal, _update, ctx) { return result(await openDocument(params, ctx.cwd, signal)); },
		...renderers("exhash open"),
	}));
	pi.registerCommand("exhash", {
		description: "Show bundled upstream exhash engine version and portability status",
		handler: async (_args, ctx) => {
			const manifest = JSON.parse(await readFile(new URL("./engine.json", import.meta.url), "utf8"));
			ctx.ui.notify(`exhash ${manifest.upstreamVersion} (${manifest.upstreamCommit.slice(0, 8)}) · bundled WASI · ${process.platform}/${process.arch} · no Python/uv required`, "info");
		},
	});
}
