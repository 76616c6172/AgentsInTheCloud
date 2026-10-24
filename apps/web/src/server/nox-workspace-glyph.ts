import { Icons } from "@agents-in-the-cloud/design-system/icons";
import { workspaceTemplateSwatchColor } from "./workspace-template-presentation.ts";

/* Nox: every workspace gets its own braille glyph, generated from its id, in place of the
 * template swatch. The template contributes only a hue; nox-layout.css takes lightness and
 * chroma from the theme's colorful tokens, so glyphs follow whichever theme is active. */

interface GlyphWorkspace {
  id: string;
  parked: boolean;
  busy?: boolean;
  requestingAttention?: boolean;
  workspaceTemplate?: { id: string; swatchColor?: string };
}

const dotPositions = [4.5, 9.5, 14.5, 19.5];

/** FNV-1a, as the template swatch colors use, feeding mulberry32. */
function random(seed: string): () => number {
  let state = 0x811c9dc5;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two braille cells, mirrored: a 4×4 grid whose right half reflects its left. */
export function workspaceGlyphDots(workspaceId: string): boolean[][] {
  const next = random(workspaceId);
  for (;;) {
    const rows = Array.from({ length: 4 }, () => {
      const outer = next() < 0.55;
      const inner = next() < 0.55;
      return [outer, inner, inner, outer];
    });
    const lit = rows.flat().filter(Boolean).length;
    if (lit >= 6 && lit <= 12) return rows;
  }
}

function workspaceGlyphSvg(workspaceId: string): string {
  const dots = workspaceGlyphDots(workspaceId).flatMap((row, y) => row.map((lit, x) => lit
    ? `<circle class="nox-workspace-glyph__dot" cx="${dotPositions[x]}" cy="${dotPositions[y]}" r="2.05" style="--x: ${x}"/>`
    : `<circle cx="${dotPositions[x]}" cy="${dotPositions[y]}" r="1.2" opacity=".2"/>`));
  return `<svg class="nox-workspace-glyph__svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${dots.join("")}</svg>`;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** OKLCH hue of a template color, or undefined when it is too grey to have one. */
export function templateHue(color: string): number | undefined {
  const oklch = /^oklch\(\s*[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(color);
  if (oklch) return Number(oklch[1]) < 0.02 ? undefined : Number(oklch[2]);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!hex) throw new Error(`Unsupported template color: ${color}`);
  const [r, g, b] = hex.slice(1).map((part) => srgbToLinear(parseInt(part, 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  if (Math.hypot(a, bAxis) < 0.02) return undefined;
  return (Math.atan2(bAxis, a) * 180 / Math.PI + 360) % 360;
}

/** The template gives a hue; a little seeded lightness keeps same-template siblings from looking stamped out. */
function glyphTint(workspace: Pick<GlyphWorkspace, "id" | "workspaceTemplate">) {
  const { workspaceTemplate } = workspace;
  const hue = workspaceTemplate && templateHue(workspaceTemplate.swatchColor ?? workspaceTemplateSwatchColor(workspaceTemplate.id));
  return { hue, lightness: (random(`${workspace.id}:lightness`)() - 0.5) * 0.06 };
}

/** Attributes and contents for the row's "new workspace from this template" button. */
export function noxWorkspaceGlyph(workspace: GlyphWorkspace) {
  const { hue, lightness } = glyphTint(workspace);
  const attributes = [
    hue === undefined ? "" : ` data-tinted style="--glyph-hue: ${hue.toFixed(1)}; --glyph-l: ${lightness.toFixed(3)}"`,
    workspace.busy ? " data-busy" : "",
    workspace.parked ? " data-parked" : "",
  ];
  const mark = workspace.requestingAttention ? '<i class="status-dot attention" aria-hidden="true"></i>' : workspaceGlyphSvg(workspace.id);
  return { attributesHtml: attributes.join(""), html: `${mark}<span class="nox-workspace-glyph__plus">${Icons.Plus}</span>` };
}

/** Busy agents in a workspace show its glyph instead of a spinner (nox-layout.css). The rule scopes
 * the glyph, as a mask, and its tint to the workspace's presentation. */
export function noxWorkspaceGlyphStyle(selector: string, workspace: Pick<GlyphWorkspace, "id" | "workspaceTemplate">): string {
  const dots = workspaceGlyphDots(workspace.id).flatMap((row, y) => row.map((lit, x) => lit
    ? `<circle cx="${dotPositions[x]}" cy="${dotPositions[y]}" r="2.05"/>`
    : `<circle cx="${dotPositions[x]}" cy="${dotPositions[y]}" r="1.2" opacity=".2"/>`));
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${dots.join("")}</svg>`;
  const { hue, lightness } = glyphTint(workspace);
  const tint = hue === undefined ? "" : ` --nox-glyph-color: oklch(from var(--nox-glyph-key) calc(l + ${lightness.toFixed(3)}) c ${hue.toFixed(1)});`;
  return `<style>${selector} { --nox-glyph-mask: url("data:image/svg+xml,${encodeURIComponent(mask)}");${tint} }</style>`;
}
