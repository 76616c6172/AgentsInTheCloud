import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, type Component } from "@earendil-works/pi-tui";

const GROUPED_TOOL_SPACING_PATCH_VERSION = 1;
const ORIGINAL_RENDER_KEY = Symbol.for(
	"pi-tool-display.groupedToolSpacing.originalRender",
);
const PATCH_VERSION_KEY = Symbol.for(
	"pi-tool-display.groupedToolSpacing.patchVersion",
);

type ContainerRender = (this: Container, width: number) => string[];

type PatchableContainerPrototype = Container & {
	[ORIGINAL_RENDER_KEY]?: ContainerRender;
	[PATCH_VERSION_KEY]?: number;
};

function isToolExecutionComponent(
	component: Component,
): component is ToolExecutionComponent {
	return component instanceof ToolExecutionComponent;
}

export function patchGroupedToolSpacing(): void {
	const prototype = Container.prototype as PatchableContainerPrototype;
	if (
		prototype[PATCH_VERSION_KEY] === GROUPED_TOOL_SPACING_PATCH_VERSION &&
		typeof prototype[ORIGINAL_RENDER_KEY] === "function"
	) {
		return;
	}

	prototype[ORIGINAL_RENDER_KEY] ??= prototype.render;
	const originalRender = prototype[ORIGINAL_RENDER_KEY];
	if (!originalRender) {
		return;
	}

	prototype.render = function renderWithGroupedTools(width: number): string[] {
		if (!this.children.some(isToolExecutionComponent)) {
			return originalRender.call(this, width);
		}

		const lines: string[] = [];
		let previousVisibleChildWasTool = false;

		for (const child of this.children) {
			const childLines = child.render(width);
			if (childLines.length === 0) {
				continue;
			}

			const childIsTool = isToolExecutionComponent(child);
			const renderedLines =
				childIsTool &&
				previousVisibleChildWasTool &&
				childLines[0] === ""
					? childLines.slice(1)
					: childLines;

			lines.push(...renderedLines);
			previousVisibleChildWasTool = childIsTool;
		}

		return lines;
	};
	prototype[PATCH_VERSION_KEY] = GROUPED_TOOL_SPACING_PATCH_VERSION;
}
