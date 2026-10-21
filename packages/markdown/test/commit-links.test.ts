import { expect, test } from "bun:test";
import { renderMarkdown } from "../src/markdown.ts";

const hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

test("commit links show the commit instead of the author's link text", () => {
  const html = renderMarkdown("ws", `Fixed in [an invented subject](agents-in-the-cloud://commit/${hash}).`);
  expect(html).not.toContain("invented subject");
  expect(html).toContain(`href="/workspaces/ws/changes/open?commit=${hash}"`);
  expect(html).toContain('data-turbo-stream="true"');
  expect(html).toContain(`data-commit-link-url-value="/workspaces/ws/changes/commit-label?commit=${hash}"`);
  expect(html).toContain("<code>a1b2c3d</code>");
});

test("autolinked ranges load their size; live snapshots are labelled without a lookup", () => {
  expect(renderMarkdown("ws", "<agents-in-the-cloud://commit/a1b2c3d^..e4f5a6b>")).toContain("<code>a1b2c3d^</code>..<code>e4f5a6b</code>");
  const live = (spec: string) => renderMarkdown("ws", `<agents-in-the-cloud://commit/${spec}>`);
  expect(live("working")).toContain(">Uncommitted changes</a>");
  expect(live("staged")).toContain(">Staged changes</a>");
  expect(live("working..staged")).toContain(">Unstaged changes</a>");
  expect(live("working..a1b2c3d")).toContain("><code>a1b2c3d</code>..Uncommitted changes</a>");
  expect(live("working")).not.toContain("data-controller");
});

test("malformed commit links keep only their text", () => {
  expect(renderMarkdown("ws", "[main](agents-in-the-cloud://commit/main)")).toBe("<p>main</p>");
});
