import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";

const BASH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BASH_SPINNER_INTERVAL_MS = 80;
const BASH_SPINNER_STATE_KEY = "__piToolDisplayBashSpinner";

interface BashCallArgs {
	command?: string;
	timeout?: number;
}

interface BashCallRenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

class BashCallText implements Component {
	private content = "";
	private expanded = false;
	private readonly wrappedText = new Text("", 0, 0);

	setText(content: string): void {
		this.content = content;
		this.wrappedText.setText(content);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	render(width: number): string[] {
		if (this.expanded) {
			return this.wrappedText.render(width);
		}

		const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
		if (safeWidth === 0) {
			return [""];
		}

		const singleLine = this.content
			.replace(/\r\n?|\n/g, " ↵ ")
			.replace(/\t/g, " ⇥ ");
		return [truncateToWidth(singleLine, safeWidth, "…")];
	}

	invalidate(): void {
		this.wrappedText.invalidate();
	}
}

interface BashSpinnerState {
	frameIndex: number;
	startedAt?: number;
	timer?: ReturnType<typeof setInterval>;
}

interface BashSpinnerStateCarrier {
	[BASH_SPINNER_STATE_KEY]?: BashSpinnerState;
}

interface BashCallRenderContextLike {
	executionStarted: boolean;
	isPartial: boolean;
	expanded?: boolean;
	invalidate(): void;
	lastComponent?: unknown;
	state?: unknown;
}

interface BashCallRenderOptions {
	outputHidden?: boolean;
}

function toStateCarrier(value: unknown): BashSpinnerStateCarrier | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return value as BashSpinnerStateCarrier;
}

function getOrCreateSpinnerState(value: unknown): BashSpinnerState | undefined {
	const carrier = toStateCarrier(value);
	if (!carrier) {
		return undefined;
	}

	const existing = carrier[BASH_SPINNER_STATE_KEY];
	if (existing) {
		return existing;
	}

	const created: BashSpinnerState = { frameIndex: 0 };
	carrier[BASH_SPINNER_STATE_KEY] = created;
	return created;
}

function stopSpinner(state: BashSpinnerState | undefined): void {
	if (!state?.timer) {
		if (state) {
			state.frameIndex = 0;
			state.startedAt = undefined;
		}
		return;
	}

	clearInterval(state.timer);
	state.timer = undefined;
	state.frameIndex = 0;
	state.startedAt = undefined;
}

function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) {
		return `${totalMinutes}m ${seconds}s`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function buildBashCallText(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	spinnerFrame?: string,
	elapsedMs?: number,
	options: BashCallRenderOptions = {},
): string {
	const commandDisplay =
		typeof args.command === "string" && args.command.trim().length > 0
			? args.command
			: "...";
	const timeoutSuffix = args.timeout
		? theme.fg("muted", ` (timeout ${args.timeout}s)`)
		: "";
	const spinnerPrefix = spinnerFrame ? `${theme.fg("warning", `${spinnerFrame} `)}` : "";
	const elapsedSuffix =
		spinnerFrame && elapsedMs !== undefined
			? theme.fg("muted", ` · ${formatElapsed(elapsedMs)}`)
			: "";
	const hiddenSuffix = options.outputHidden
		? theme.fg("muted", " · output hidden")
		: "";

	return `${theme.fg("toolTitle", theme.bold("$"))} ${spinnerPrefix}${theme.fg("accent", commandDisplay)}${timeoutSuffix}${elapsedSuffix}${hiddenSuffix}`;
}

export function renderBashCall(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	context: BashCallRenderContextLike,
	options: BashCallRenderOptions = {},
): Component {
	const text = context.lastComponent instanceof BashCallText
		? context.lastComponent
		: new BashCallText();
	text.setExpanded(context.expanded === true);
	const spinnerState = getOrCreateSpinnerState(context.state);
	const shouldSpin = context.executionStarted && context.isPartial;

	if (shouldSpin && spinnerState) {
		spinnerState.startedAt ??= Date.now();
		if (!spinnerState.timer) {
			spinnerState.timer = setInterval(() => {
				spinnerState.frameIndex = (spinnerState.frameIndex + 1) % BASH_SPINNER_FRAMES.length;
				text.setText(
					buildBashCallText(
						args,
						theme,
						BASH_SPINNER_FRAMES[spinnerState.frameIndex],
						Date.now() - (spinnerState.startedAt ?? Date.now()),
						options,
					),
				);
				context.invalidate();
			}, BASH_SPINNER_INTERVAL_MS);
		}
	}

	if (!shouldSpin) {
		stopSpinner(spinnerState);
	}

	const spinnerFrame = shouldSpin && spinnerState ? BASH_SPINNER_FRAMES[spinnerState.frameIndex] : undefined;
	const elapsedMs = shouldSpin && spinnerState?.startedAt !== undefined
		? Date.now() - spinnerState.startedAt
		: undefined;
	text.setText(buildBashCallText(args, theme, spinnerFrame, elapsedMs, options));
	return text;
}
