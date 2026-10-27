import { expect, test } from "bun:test";
import { inlineContentDocument } from "../../src/server/inline-content-document.ts";

const content = async (fragment: string) => (await inlineContentDocument(fragment)).match(/<main id="ic-content">(.*)<\/main>/s)![1]!;

test("authored details become the transcript's disclosure, keeping their classes", async () => {
  const html = await content(`<details class="ic-quiet"><summary>Why <code>x</code>?</summary><p>Because.</p></details>`);
  expect(html).toMatch(/^<details class="ic-quiet disclosure"><summary class="[^"]*content-row[^"]*is-muted[^"]*"><span class="content-row__icon"><svg class="disclosure-icon"/);
  expect(html).toContain(`<span class="content-row__label-text">Why <code>x</code>?</span>`);
  expect(html).toMatch(/<\/summary><div class="disclosure-content"><p>Because\.<\/p><\/div><\/details>$/);
});

test("details without a summary get no content gutter, and nesting stays balanced", async () => {
  expect(await content(`<div><details><p>Bare</p></details></div>`)).toBe(`<div><details class=" disclosure"><p>Bare</p></details></div>`);
  const nested = await content(`<details><summary>Outer</summary><details><summary>Inner</summary>i</details>o</details>`);
  expect(nested.match(/<div class="disclosure-content">/g)).toHaveLength(2);
  expect(nested).toMatch(/i<\/div><\/details>o<\/div><\/details>$/);
});
