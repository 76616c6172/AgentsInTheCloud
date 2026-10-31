/// <reference lib="dom" />

export type VoiceRibbonState = "idle" | "loading" | "listening" | "finishing";
type Rgb = readonly [number, number, number];
type Palette = { ribbons: readonly [Rgb, Rgb, Rgb]; additive: boolean };
type Frame = { state: VoiceRibbonState; level: number; progress: number; time: number; dt: number; hover: boolean; palette: Palette; still: boolean };

const fullTurn = Math.PI * 2;
const ribbonFrequencies = [1.5, 2.3, 3.2] as const;
const ribbonSpeeds = [3.2, -4.4, 5.6] as const;
const ribbonGains = [1, 0.75, 0.55] as const;
const restPhases = [0.6, 2.2, 3.9] as const;
const restAmplitude = 0.32;
const restPresence = 0.4;
const hoverAmplitude = 0.55;
const hoverSpeed = 0.7;
const finishingPresence = 0.6;
const restingCue = 0.62;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const rgba = ([red, green, blue]: Rgb, alpha: number) => `rgba(${red},${green},${blue},${alpha})`;

class Spring {
  private velocity = 0;
  constructor(public value: number, private readonly stiffness: number, private readonly damping: number) {}

  step(target: number, dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / steps;
    for (let index = 0; index < steps; index += 1) {
      this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  settled(target: number): boolean {
    return Math.abs(target - this.value) < 0.002 && Math.abs(this.velocity) < 0.01;
  }

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** One canvas's ribbons. Each keeps its own springs so a state change eases in rather than jumping. */
class RibbonPainter {
  private readonly amplitude = new Spring(restAmplitude, 150, 18);
  private readonly activity = new Spring(0, 190, 22);
  private readonly stop = new Spring(0, 420, 32);
  private readonly cue = new Spring(0, 260, 26);
  private cueKind: "cancel" | "stop" = "cancel";
  private readonly loaded = new Spring(0, 160, 24);
  private readonly presence = new Spring(restPresence, 150, 22);
  private readonly phases: number[] = [...restPhases];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly context: CanvasRenderingContext2D) {}

  /** Draws one frame and reports whether the ribbons are still moving. At rest they settle, dimmed, and hold still. */
  paint(frame: Frame): boolean {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    const drawing = this.context;
    drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawing.clearRect(0, 0, width, height);
    if (!width || !height) return false;

    const { state, dt, palette } = frame;
    const [lead] = palette.ribbons;
    const centre = height / 2;
    const inset = width > height * 1.5 ? height * 0.45 : height * 0.13;
    const left = inset;
    const right = width - inset;
    const span = right - left;
    const reach = height * 0.36;

    let amplitudeTarget: number;
    let speed: number;
    if (state === "idle") {
      // Pointing at the resting control wakes it, hinting that it's ready to listen.
      amplitudeTarget = frame.hover ? hoverAmplitude : restAmplitude;
      speed = frame.hover ? hoverSpeed : 0;
    } else if (state === "listening") {
      amplitudeTarget = 0.12 + frame.level * 1.45;
      speed = 0.5 + frame.level * 1.6;
    } else {
      amplitudeTarget = 0.02;
      speed = 0.3;
    }
    const activityTarget = state === "idle" ? 0 : 1;
    const stopTarget = state === "listening" && frame.hover ? 1 : 0;
    const presenceTarget = state === "idle" && !frame.hover ? restPresence : state === "finishing" ? finishingPresence : 1;
    // While a tap would cancel or stop, the middle shows × or ■; pointing at it enlarges the sign.
    const acting = state === "loading" || state === "listening";
    const cueTarget = acting ? frame.hover ? 1 : restingCue : 0;
    if (acting) this.cueKind = state === "loading" ? "cancel" : "stop";
    if (frame.still) {
      this.amplitude.snap(amplitudeTarget);
      this.activity.snap(activityTarget);
      this.presence.snap(presenceTarget);
      this.phases.splice(0, 3, ...restPhases);
      speed = 0;
    }
    const activity = clamp(this.activity.step(activityTarget, dt));
    const stop = clamp(this.stop.step(stopTarget, dt));
    const amplitude = Math.max(0, this.amplitude.step(amplitudeTarget, dt)) * (1 - 0.75 * stop);
    const presence = clamp(this.presence.step(presenceTarget, dt));
    const cue = clamp(this.cue.step(cueTarget, dt));
    // At rest the ribbons drift back to the same shape, so the idle control always looks alike.
    if (state === "idle" && speed === 0) for (let ribbon = 0; ribbon < 3; ribbon += 1) this.phases[ribbon] = restPhases[ribbon]! + wrapAngle(this.phases[ribbon]! - restPhases[ribbon]!) * Math.exp(-6 * dt);

    drawing.save();
    drawing.beginPath();
    drawing.roundRect(0, 0, width, height, height / 2);
    drawing.clip();

    drawing.globalCompositeOperation = palette.additive ? "lighter" : "source-over";
    const ribbonAlpha = (palette.additive ? 0.46 : 0.36) * (state === "loading" ? 1 - activity * 0.6 : 1) * presence;
    for (let ribbon = 0; ribbon < 3; ribbon += 1) {
      this.phases[ribbon]! += ribbonSpeeds[ribbon]! * speed * dt;
      const size = reach * amplitude * ribbonGains[ribbon]!;
      if (size < 0.15) continue;
      const offset = (x: number) => {
        const across = (x - left) / span;
        return size * Math.sin(Math.PI * across) ** 2 * Math.sin(across * ribbonFrequencies[ribbon]! * fullTurn + this.phases[ribbon]!);
      };
      drawing.beginPath();
      for (let x = left; x <= right; x += 1) drawing.lineTo(x, centre - offset(x));
      for (let x = right; x >= left; x -= 1) drawing.lineTo(x, centre + offset(x) * 0.6);
      drawing.closePath();
      drawing.fillStyle = rgba(palette.ribbons[ribbon]!, ribbonAlpha);
      drawing.fill();
    }
    drawing.globalCompositeOperation = "source-over";

    // The thread the ribbons rise from, fading out towards both ends.
    const thread = drawing.createLinearGradient(left, 0, right, 0);
    thread.addColorStop(0, rgba(lead, 0));
    thread.addColorStop(0.5, rgba(lead, (state === "idle" ? 0.75 : 0.5) * Math.max(presence, 0.6)));
    thread.addColorStop(1, rgba(lead, 0));
    drawing.strokeStyle = thread;
    drawing.lineWidth = 1.2;
    drawing.beginPath();
    drawing.moveTo(left, centre);
    drawing.lineTo(right, centre);
    drawing.stroke();

    if (state === "loading") {
      // A bright head draws along the thread as the model gets ready.
      const head = lerp(left, right, clamp(this.loaded.step(frame.progress, dt)));
      const trail = drawing.createLinearGradient(left, 0, head, 0);
      trail.addColorStop(0, rgba(lead, 0));
      trail.addColorStop(1, rgba(lead, 0.95));
      drawing.strokeStyle = trail;
      drawing.lineWidth = 1.6;
      drawing.lineCap = "round";
      drawing.beginPath();
      drawing.moveTo(left, centre);
      drawing.lineTo(head, centre);
      drawing.stroke();
      const glowRadius = height * 0.22;
      const glow = drawing.createRadialGradient(head, centre, 0, head, centre, glowRadius);
      glow.addColorStop(0, rgba(lead, 0.9 * activity));
      glow.addColorStop(1, rgba(lead, 0));
      drawing.fillStyle = glow;
      drawing.fillRect(head - glowRadius, centre - glowRadius, glowRadius * 2, glowRadius * 2);
    } else {
      this.loaded.snap(0);
    }

    if (state === "finishing") {
      // A glint sweeps along the thread until the last words land.
      const position = lerp(left - 20, right + 20, (frame.time * 1.1) % 1);
      const glint = drawing.createLinearGradient(position - 22, 0, position + 22, 0);
      glint.addColorStop(0, rgba(lead, 0));
      glint.addColorStop(0.5, rgba(lead, 1));
      glint.addColorStop(1, rgba(lead, 0));
      drawing.strokeStyle = glint;
      drawing.lineWidth = 1.8;
      drawing.beginPath();
      drawing.moveTo(Math.max(left, position - 22), centre);
      drawing.lineTo(Math.min(right, position + 22), centre);
      drawing.stroke();
    }
    drawing.restore();

    if (cue > 0.01) {
      // The sign sits in a gap cut through the ribbons; hovering a live session also squeezes them flat.
      const middle = width / 2;
      drawing.save();
      drawing.globalAlpha = clamp(cue * 1.6);
      drawing.globalCompositeOperation = "destination-out";
      drawing.beginPath();
      drawing.arc(middle, centre, height * 0.3 * (0.5 + 0.5 * cue), 0, fullTurn);
      drawing.fill();
      drawing.globalCompositeOperation = "source-over";
      const side = height * 0.26 * (0.55 + 0.45 * cue);
      drawing.fillStyle = rgba(lead, 1);
      drawing.strokeStyle = rgba(lead, 1);
      drawing.lineCap = "round";
      drawing.lineWidth = Math.max(1.6, side * 0.2);
      drawing.beginPath();
      if (this.cueKind === "stop") {
        drawing.roundRect(middle - side / 2, centre - side / 2, side, side, side * 0.24);
        drawing.fill();
      } else {
        const arm = side * 0.42;
        drawing.moveTo(middle - arm, centre - arm);
        drawing.lineTo(middle + arm, centre + arm);
        drawing.moveTo(middle + arm, centre - arm);
        drawing.lineTo(middle - arm, centre + arm);
        drawing.stroke();
      }
      drawing.restore();
    }

    if (state !== "idle" || speed !== 0) return true;
    return !(this.amplitude.settled(amplitudeTarget) && this.presence.settled(presenceTarget) && this.activity.settled(activityTarget) && this.stop.settled(stopTarget) && this.cue.settled(cueTarget)
      && this.phases.every((phase, ribbon) => Math.abs(wrapAngle(phase - restPhases[ribbon]!)) < 0.002));
  }
}

function wrapAngle(angle: number): number {
  return angle - fullTurn * Math.round(angle / fullTurn);
}

function resolveColor(probe: CanvasRenderingContext2D, color: string): Rgb {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

/**
 * Draws the voice control's ribbons on every visible canvas. They rest dimmed and still, rise with
 * the speaker's level while listening, and draw loading and finishing along their thread.
 * Frames only run while something moves; hover, resizing, visibility and theme changes wake it.
 */
export class VoiceRibbons {
  state: VoiceRibbonState = "idle";
  progress = 0;

  private readonly painters = new Map<HTMLCanvasElement, RibbonPainter>();
  // The pointer that started a session rests on the button; its hover only counts once it comes back.
  private readonly hoverDisarmed = new Set<HTMLButtonElement>();
  private readonly visible = new Set<HTMLCanvasElement>();
  private readonly observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!(target instanceof HTMLCanvasElement)) continue;
      if (isIntersecting) this.visible.add(target);
      else this.visible.delete(target);
    }
    this.schedule();
  });
  private readonly resizes = new ResizeObserver(() => this.schedule());
  private readonly themeChanged = (): void => {
    this.palette = undefined;
    this.schedule();
  };
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly hoverCapable = window.matchMedia("(hover: hover)");
  private readonly probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  private frame?: number;
  private lastTime = 0;
  private level = 0;
  private palette?: Palette;

  constructor(private readonly sampleLevel: () => number) {}

  add(canvas: HTMLCanvasElement): void {
    if (!this.painters.size) document.addEventListener("agents-in-the-cloud:theme-change", this.themeChanged);
    this.painters.set(canvas, new RibbonPainter(canvas, canvas.getContext("2d")!));
    this.observer.observe(canvas);
    this.resizes.observe(canvas);
    const button = canvas.closest("button")!;
    button.addEventListener("pointerenter", this.hoverChanged);
    button.addEventListener("pointerleave", this.hoverChanged);
  }

  remove(canvas: HTMLCanvasElement): void {
    const button = canvas.closest("button");
    button?.removeEventListener("pointerenter", this.hoverChanged);
    button?.removeEventListener("pointerleave", this.hoverChanged);
    this.observer.unobserve(canvas);
    this.resizes.unobserve(canvas);
    this.painters.delete(canvas);
    this.visible.delete(canvas);
    if (!this.painters.size) document.removeEventListener("agents-in-the-cloud:theme-change", this.themeChanged);
  }

  setState(state: VoiceRibbonState): void {
    if (this.state === "idle" && state !== "idle") {
      for (const canvas of this.painters.keys()) {
        const button = canvas.closest("button")!;
        if (button.matches(":hover")) this.hoverDisarmed.add(button);
      }
    }
    this.state = state;
    this.schedule();
  }

  private readonly hoverChanged = (event: PointerEvent): void => {
    if (event.type === "pointerleave" && event.currentTarget instanceof HTMLButtonElement) this.hoverDisarmed.delete(event.currentTarget);
    this.schedule();
  };

  private hovered(canvas: HTMLCanvasElement): boolean {
    const button = canvas.closest("button")!;
    return this.hoverCapable.matches && button.matches(":hover") && !this.hoverDisarmed.has(button);
  }

  private schedule(): void {
    if (this.frame === undefined && this.visible.size) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = undefined;
    if (!this.visible.size) {
      this.lastTime = 0;
      return;
    }
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    const target = this.state === "listening" ? this.sampleLevel() : 0;
    this.level += (target - this.level) * (1 - Math.exp(-(target > this.level ? 24 : 5.5) * dt));
    this.palette ??= this.readPalette(this.visible.values().next().value!);
    const still = this.reducedMotion.matches && this.state === "idle";
    let moving = false;
    for (const canvas of this.visible) {
      moving = this.painters.get(canvas)!.paint({
        state: this.state,
        level: this.level,
        progress: this.progress,
        time: now / 1000,
        dt,
        hover: this.hovered(canvas),
        palette: this.palette,
        still,
      }) || moving;
    }
    if (moving) this.schedule();
    else this.lastTime = 0;
  };

  private readPalette(canvas: HTMLCanvasElement): Palette {
    const style = getComputedStyle(canvas);
    const color = (name: string) => resolveColor(this.probe, style.getPropertyValue(name));
    const bright = color("--text-bright");
    const text = color("--text");
    const muted = color("--text-muted");
    const between = (channel: 0 | 1 | 2) => Math.round(lerp(text[channel], muted[channel], 0.35));
    const silver: Rgb = [between(0), between(1), between(2)];
    return { ribbons: [bright, silver, muted], additive: style.colorScheme.includes("dark") };
  }
}
