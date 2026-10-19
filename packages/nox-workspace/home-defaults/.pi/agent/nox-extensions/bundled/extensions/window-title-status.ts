/**
 * Window Title Status Extension
 *
 * Sets terminal/tab title to:
 * - "⠋ 00:00" while agent is processing
 *   (same braille spinner cadence as the CLI loader)
 * - "[project-name] 00:00" when idle after a completed run
 *   (shows total elapsed time for the latest completed run in that cwd)
 * - "[project-name]" when idle and no run has completed yet
 *   (uses git repo root name via `git rev-parse --show-toplevel`, falls back to cwd basename)
 *
 * Install: ~/.pi/agent/extensions/window-title-status.ts
 * Reload: /reload
 */

import path from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 80; // matches pi's Loader spinner cadence

export default function windowTitleStatusExtension(pi: ExtensionAPI) {
	let activeRuns = 0;
	let frameIndex = 0;
	let startedAt = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let currentCwd = process.cwd();
	let projectName = path.basename(process.cwd());
	const completedElapsedByCwd = new Map<string, number>();

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60)
			.toString()
			.padStart(2, "0");
		const seconds = (totalSeconds % 60).toString().padStart(2, "0");
		return `${minutes}:${seconds}`;
	}

	function resolveProjectName(cwd: string): string {
		try {
			const repoRoot = execSync("git rev-parse --show-toplevel", {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
				encoding: "utf8",
			})
				.trim();
			if (repoRoot) return path.basename(repoRoot);
		} catch {
			// Not a git repo (or git unavailable) — fall back to cwd basename.
		}
		return path.basename(cwd);
	}

	function getReadyTitle(): string {
		const title = `[${projectName}]`;
		const elapsed = completedElapsedByCwd.get(currentCwd);
		return elapsed === undefined ? title : `${title} ${formatElapsed(elapsed)}`;
	}

	function getWorkingTitle(): string {
		return `${BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length]} ${formatElapsed(Date.now() - startedAt)}`;
	}

	function renderWorkingTitle(ctx: ExtensionContext): void {
		ctx.ui.setTitle(getWorkingTitle());
		frameIndex++;
	}

	function stopAnimation(): void {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
	}

	function setReadyTitle(ctx: ExtensionContext): void {
		stopAnimation();
		ctx.ui.setTitle(getReadyTitle());
	}

	function startAnimation(ctx: ExtensionContext): void {
		if (!timer) {
			timer = setInterval(() => {
				renderWorkingTitle(ctx);
			}, TICK_MS);
		}
		renderWorkingTitle(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		projectName = resolveProjectName(ctx.cwd);
		if (activeRuns <= 0) {
			setReadyTitle(ctx);
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		projectName = resolveProjectName(ctx.cwd);
		if (activeRuns <= 0) {
			setReadyTitle(ctx);
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		projectName = resolveProjectName(ctx.cwd);
		activeRuns++;
		if (activeRuns === 1) {
			startedAt = Date.now();
			frameIndex = 0;
		}
		startAnimation(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		projectName = resolveProjectName(ctx.cwd);
		const previousActiveRuns = activeRuns;
		activeRuns = Math.max(0, activeRuns - 1);
		if (previousActiveRuns > 0 && activeRuns === 0) {
			completedElapsedByCwd.set(ctx.cwd, Date.now() - startedAt);
			setReadyTitle(ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		projectName = resolveProjectName(ctx.cwd);
		setReadyTitle(ctx);
	});
}
