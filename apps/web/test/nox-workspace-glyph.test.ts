import { expect, test } from "bun:test";
import { noxWorkspaceGlyph, templateHue, workspaceGlyphDots } from "../src/server/nox-workspace-glyph.ts";

test("a workspace's glyph is stable, mirrored and readable", () => {
  for (const id of ["c27c3db1", "0c86e008", "037fe03e", "8ad2b5a5", "f5b65eaa"]) {
    const dots = workspaceGlyphDots(id);
    expect(workspaceGlyphDots(id)).toEqual(dots);
    for (const row of dots) expect(row).toEqual([...row].reverse());
    const lit = dots.flat().filter(Boolean).length;
    expect(lit).toBeGreaterThanOrEqual(6);
    expect(lit).toBeLessThanOrEqual(12);
  }
  expect(workspaceGlyphDots("c27c3db1")).not.toEqual(workspaceGlyphDots("0c86e008"));
});

test("template colors contribute only their hue", () => {
  expect(templateHue("oklch(0.7 0.15 248)")).toBe(248);
  expect(templateHue("#ff0000")).toBeCloseTo(29.2, 0);
  expect(templateHue("#2563eb")).toBeCloseTo(262.9, 0);
  expect(templateHue("#808080")).toBeUndefined();
  expect(() => templateHue("red")).toThrow("Unsupported template color: red");
});

test("the glyph slot shows the workspace's state", () => {
  const workspace = { id: "c27c3db1", parked: false, workspaceTemplate: { id: "template", swatchColor: "#2563eb" } };
  const idle = noxWorkspaceGlyph(workspace);
  expect(idle.attributesHtml).toBe(' data-tinted style="--glyph-hue: 262.9; --glyph-l: 0.017"');
  expect(idle.html).toContain('class="nox-workspace-glyph__svg"');
  expect(idle.html).toContain('class="nox-workspace-glyph__plus"');

  expect(noxWorkspaceGlyph({ ...workspace, busy: true }).attributesHtml).toContain(" data-busy");
  expect(noxWorkspaceGlyph({ ...workspace, parked: true }).attributesHtml).toContain(" data-parked");
  const attention = noxWorkspaceGlyph({ ...workspace, busy: true, requestingAttention: true });
  expect(attention.html).toContain('class="status-dot attention"');
  expect(attention.html).not.toContain("nox-workspace-glyph__svg");

  expect(noxWorkspaceGlyph({ id: "c27c3db1", parked: false }).attributesHtml).toBe("");
});
