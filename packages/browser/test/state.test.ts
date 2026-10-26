import { expect, test } from "bun:test";
import { normalizeBrowserUrl } from "../src/server/state.ts";

test("workspace file URLs are accepted, but not files on another host or other schemes", () => {
  expect(normalizeBrowserUrl("file:///work/out/a b.html")).toBe("file:///work/out/a%20b.html");
  expect(normalizeBrowserUrl("file://server/work/report.html")).toBe("");
  expect(normalizeBrowserUrl("ftp://example.com/report.html")).toBe("");
  expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000/");
});
