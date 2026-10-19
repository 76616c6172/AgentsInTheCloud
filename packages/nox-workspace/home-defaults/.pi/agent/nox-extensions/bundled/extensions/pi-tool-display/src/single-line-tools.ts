import { stripVTControlCharacters } from "node:util";
import { Box, Text, sliceByColumn, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

const COMPACT = Symbol.for("pi-tool-display.singleLineTool");
const empty: Component = { render: () => [], invalidate() {} };

type Theme = { fg(color: string, text: string): string; bg(color: string, text: string): string; bold(text: string): string };
type Context = {
  expanded?: boolean; isError?: boolean; isPartial?: boolean; executionStarted?: boolean;
  lastComponent?: Component; state?: Record<string, unknown>;
};
type Result = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
type Options = { expanded: boolean; isPartial: boolean };
type Tool = Record<string, unknown> & {
  renderCall?: (args: any, theme: Theme, context: any) => Component;
  renderResult?: (result: any, options: Options, theme: Theme, context: any) => Component;
};

/** Presentation only: preserve execution, schemas, results and expanded renderers. */
export function singleLineTool<T extends Tool>(tool: T): T {
  if ((tool as any)[COMPACT]) return tool;
  const call = tool.renderCall;
  const result = tool.renderResult;
  const decorated = {
    ...tool,
    [COMPACT]: true,
    renderShell: "self",
    renderCall(args: any, theme: Theme, context: Context = {}) {
      const previous = context.lastComponent;
      const inner = call?.(args, theme, { ...context, lastComponent: previous instanceof ToolSurface ? previous.inner : previous })
        ?? new Text(`${String(tool.label ?? tool.name)} ${String(args?.path ?? args?.query ?? args?.command ?? "")}`, 0, 0);
      return new ToolSurface(inner, theme, context, !context.expanded);
    },
    renderResult(value: Result, options: Options, theme: Theme, context: Context = {}) {
      if (!options.expanded) return empty;
      const previous = context.lastComponent;
      const inner = result?.(value, options, theme, { ...context, lastComponent: previous instanceof ToolSurface ? previous.inner : previous })
        ?? new Text(value.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") ?? "", 0, 0);
      return new ToolSurface(inner, theme, { ...context, isPartial: options.isPartial, isError: context.isError || value.isError });
    },
  };
  return decorated as T;
}

/** Use the same status colors and background painting as Pi's default tool shell,
 * but without its vertical padding so collapsed tools still occupy one row. */
class ToolSurface extends Box {
  readonly inner: Component;
  constructor(inner: Component, theme: Theme, context: Context, collapsed = false) {
    const background = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
    super(0, 0, (text) => theme.bg(background, text));
    this.inner = inner;
    this.addChild(collapsed ? new CompactCall(inner) : inner);
  }
}

class CompactCall implements Component {
  private inner: Component;
  constructor(inner: Component) { this.inner = inner; }
  render(width: number): string[] {
    if (width <= 0) return [""];
    const lines = this.inner.render(width);
    const first = lines.find((line) => stripVTControlCharacters(line).trim()) ?? "";
    const trimmed = sliceByColumn(first, 0, visibleWidth(stripVTControlCharacters(first).trimEnd()), true);
    const text = trimmed.replace(/\r\n?|\n/g, " ↵ ").replace(/\t/g, " ");
    return [truncateToWidth(text, width - (lines.length > 1 ? 1 : 0), "…") + (lines.length > 1 ? "…" : "")];
  }
  invalidate(): void { this.inner.invalidate(); }
}
