/// <reference lib="dom" />

export type VoiceRibbonState = "idle" | "loading" | "listening" | "finishing";
type Rgb = readonly [number, number, number];
type Palette = { ribbons: readonly [Rgb, Rgb, Rgb]; additive: boolean };
type Frame = { state: VoiceRibbonState; level: number; progress: number; time: number; dt: number; hover: boolean; palette: Palette; still: boolean };

const fullTurn = Math.PI * 2;
const ribbonFrequencies = [1.5, 2.3, 3.2] as const;
const ribbonSpeeds = [3.2, -4.4, 5.6] as const;
const ribbonGains = [1, 0.75, 0.55] as const;
const paletteRefreshSeconds = 1;

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

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** One canvas's ribbons. Each keeps its own springs so a state change eases in rather than jumping. */
class RibbonPainter {
  private readonly amplitude = new Spring(restAmplitude(0), 150, 18);
  private readonly activity = new Spring(0, 190, 22);
  private readonly stop = new Spring(0, 420, 32);
  private readonly loaded = new Spring(0, 160, 24);
  private readonly phases = [0.6, 2.2, 3.9];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly context: CanvasRenderingContext2D) {}

  paint(frame: Frame): void {
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
    if (!width || !height) return;

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
      amplitudeTarget = frame.hover ? 0.65 : restAmplitude(frame.time);
      speed = frame.hover ? 1 : 0.4;
    } else if (state === "listening") {
      amplitudeTarget = 0.12 + frame.level * 1.45;
      speed = 0.5 + frame.level * 1.6;
    } else {
      amplitudeTarget = 0.02;
      speed = 0.3;
    }
    if (frame.still) {
      this.amplitude.snap(amplitudeTarget);
      this.activity.snap(state === "idle" ? 0 : 1);
      speed = 0;
    }
    const activity = clamp(this.activity.step(state === "idle" ? 0 : 1, dt));
    const stop = clamp(this.stop.step(state === "listening" && frame.hover ? 1 : 0, dt));
    const amplitude = Math.max(0, this.amplitude.step(amplitudeTarget, dt)) * (1 - 0.75 * stop);

    drawing.save();
    drawing.beginPath();
    drawing.roundRect(0, 0, width, height, height / 2);
    drawing.clip();

    drawing.globalCompositeOperation = palette.additive ? "lighter" : "source-over";
    const ribbonAlpha = (palette.additive ? 0.46 : 0.36) * (state === "loading" ? 1 - activity * 0.6 : 1);
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
    thread.addColorStop(0.5, rgba(lead, state === "idle" ? 0.75 : 0.5));
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

    if (stop > 0.01) {
      // Hovering a live session squeezes the ribbons flat around a stop square.
      const middle = width / 2;
      drawing.save();
      drawing.globalAlpha = stop;
      drawing.globalCompositeOperation = "destination-out";
      drawing.beginPath();
      drawing.arc(middle, centre, height * 0.3, 0, fullTurn);
      drawing.fill();
      drawing.globalCompositeOperation = "source-over";
      const side = height * 0.26 * (0.7 + 0.3 * stop);
      drawing.fillStyle = rgba(lead, 1);
      drawing.beginPath();
      drawing.roundRect(middle - side / 2, centre - side / 2, side, side, side * 0.24);
      drawing.fill();
      drawing.restore();
    }
  }
}

function restAmplitude(time: number): number {
  return 0.32 + 0.1 * Math.sin(time * 1.25);
}

function resolveColor(probe: CanvasRenderingContext2D, color: string): Rgb {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

/**
 * Animates the voice control's ribbons on every visible canvas: they breathe at rest, rise
 * with the speaker's level while listening, and draw loading and finishing along their thread.
 */
export class VoiceRibbons {
  state: VoiceRibbonState = "idle";
  progress = 0;

  private readonly painters = new Map<HTMLCanvasElement, RibbonPainter>();
  // The pointer that started a session rests on the button; stop only shows once it comes back.
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
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly hoverCapable = window.matchMedia("(hover: hover)");
  private readonly probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  private frame?: number;
  private lastTime = 0;
  private level = 0;
  private palette?: Palette;
  private paletteAge = 0;

  constructor(private readonly sampleLevel: () => number) {}

  add(canvas: HTMLCanvasElement): void {
    this.painters.set(canvas, new RibbonPainter(canvas, canvas.getContext("2d")!));
    this.observer.observe(canvas);
    canvas.closest("button")!.addEventListener("pointerleave", this.rearmHover);
  }

  remove(canvas: HTMLCanvasElement): void {
    canvas.closest("button")?.removeEventListener("pointerleave", this.rearmHover);
    this.observer.unobserve(canvas);
    this.painters.delete(canvas);
    this.visible.delete(canvas);
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

  private readonly rearmHover = (event: PointerEvent): void => {
    if (event.currentTarget instanceof HTMLButtonElement) this.hoverDisarmed.delete(event.currentTarget);
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
    this.paletteAge += dt;
    const anyCanvas = this.visible.values().next().value!;
    if (!this.palette || this.paletteAge > paletteRefreshSeconds) {
      this.palette = this.readPalette(anyCanvas);
      this.paletteAge = 0;
    }
    const still = this.reducedMotion.matches && this.state === "idle";
    for (const canvas of this.visible) {
      this.painters.get(canvas)!.paint({
        state: this.state,
        level: this.level,
        progress: this.progress,
        time: now / 1000,
        dt,
        hover: this.hovered(canvas),
        palette: this.palette,
        still,
      });
    }
    // A reduced-motion rest frame is drawn once rather than animated.
    if (still) this.lastTime = 0;
    else this.schedule();
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
