import { expect, test } from "bun:test";
import { HighlightCache } from "../src/highlight-cache.ts";
import { highlightCodeHtml } from "../src/highlight.ts";
import { fixtures, prefixes, source } from "../bench/cases.ts";
import { languageFromPath } from "../src/index.ts";

function roles(code: string, language: string): [string, string][] {
  const html = highlightCodeHtml({ code, language }).html;
  return [...html.matchAll(/<span class="syntax-([\w-]+)">([^<]*)<\/span>/g)].map((match) => [match[2]!.trim(), match[1]!]);
}

test("highlighting incomplete captured inputs keeps every character", () => {
  for (const fixture of fixtures) {
    for (const code of prefixes(source(fixture), 256)) {
      const html = highlightCodeHtml({ code, language: languageFromPath(fixture) }).html;
      const text = html.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&#39;", "'").replaceAll("&amp;", "&");
      expect(text).toBe(code);
    }
  }
});

test("nested web languages are highlighted", () => {
  const tokens = roles('<style>.x { color: red }</style><script>const count = 42;</script>', "html");
  expect(tokens).toContainEqual(["const", "keyword"]);
  expect(tokens).toContainEqual(["42", "number"]);
  expect(tokens).toContainEqual(["style", "tag"]);
});

test("method calls are colored as functions", () => {
  const tokens = new Map(roles("const entry = { name: task.name, at: Date.now() };", "javascript"));
  expect(tokens.get("now")).toBe("function");
});

test("JSON keys stand apart from string values", () => {
  const tokens = roles('{"name": "Mango", "count": 3}', "json");
  expect(tokens).toContainEqual(["&quot;name&quot;", "attribute"]);
  expect(tokens).toContainEqual(["&quot;Mango&quot;", "string"]);
});

test("cache evicts least recently used entries at the entry limit", () => {
  const cache = new HighlightCache(100, 2);
  const result = { html: "1234" };
  cache.set("a", result);
  cache.set("b", result);
  expect(cache.get("a")).toBe(result);
  cache.set("c", result);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe(result);
  expect(cache.get("c")).toBe(result);
});

test("cache accounts for replacements and oversized entries within its character limit", () => {
  const cache = new HighlightCache(12, 10);
  cache.set("a", { html: "1234" });
  cache.set("c", { html: "1234" });
  cache.set("c", { html: "12345678" });
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("c")?.html).toBe("12345678");
  cache.set("oversized", { html: "1234" });
  expect(cache.get("oversized")).toBeUndefined();
  expect(cache.get("c")).toBeDefined();
  cache.set("c", { html: "123456789012" });
  expect(cache.get("c")).toBeUndefined();
});
