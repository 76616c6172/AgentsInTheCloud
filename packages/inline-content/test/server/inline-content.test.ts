import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { inlineContentMaxBytes, validateInlineContent } from "../../src/server/inline-content.ts";
import { inlineContentFrameMessage, inlineContentThemeMessage } from "../../src/shared/inline-content-protocol.ts";

describe("inline content fragments", () => {
  test("rejects full documents, empty files and oversized UTF-8 input", () => {
    expect(validateInlineContent("<html><body>Page</body></html>")).toHaveProperty("error");
    expect(validateInlineContent("   ")).toHaveProperty("error");
    expect(validateInlineContent("é".repeat(inlineContentMaxBytes))).toHaveProperty("error");
    expect(validateInlineContent("<section>Fragment</section>")).toEqual({ html: "<section>Fragment</section>" });
  });
});

describe("untrusted frame protocol", () => {
  test("rejects invalid sizes and unsupported capabilities", () => {
    expect(Value.Check(inlineContentFrameMessage, { type: "size", height: -2, overflow: false })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "size", height: Infinity, overflow: false })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "size", height: 360, overflow: false })).toBe(true);
    expect(Value.Check(inlineContentFrameMessage, { type: "execute", command: "anything" })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "link", href: "javascript:alert(1)" })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "selection", text: "Queue first", code: false, rect: { left: 4, top: 10, right: 80, bottom: 28 } })).toBe(true);
    expect(Value.Check(inlineContentFrameMessage, { type: "selection", text: "Queue first", code: false, rect: { left: 4, top: Infinity, right: 80, bottom: 28 } })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "selection", text: "", code: false, rect: { left: 0, top: 0, right: 0, bottom: 0 } })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "selection", text: "x".repeat(1048577), code: false, rect: { left: 0, top: 0, right: 0, bottom: 0 } })).toBe(false);
    expect(Value.Check(inlineContentFrameMessage, { type: "selection-cleared" })).toBe(true);
    expect(Value.Check(inlineContentThemeMessage, { type: "theme", theme: "nord", fontSize: "16px" })).toBe(true);
    expect(Value.Check(inlineContentThemeMessage, { type: "theme", theme: "nord", fontSize: "url(https://example.com)" })).toBe(false);
  });
});
