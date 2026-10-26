import { expect, test } from "bun:test";
import { ChangesPublication } from "../src/server/publication.ts";

interface Snapshot { name: string }
function deferred() {
  let resolve!: (snapshot: Snapshot) => void;
  const promise = new Promise<Snapshot>(done => { resolve = done; });
  return { promise, resolve };
}

test("a selection made while a turn refreshes captures a fresh history and wins", async () => {
  const publication = new ChangesPublication<Snapshot>({ name: "initial" });
  const turnCapture = deferred();
  const turn = publication.refreshAfterTurn(() => turnCapture.promise);
  const outdated: boolean[] = [];
  const selection = publication.publishSelection(publication.select(), async stale => { outdated.push(stale); return { name: "picked" }; });
  expect(await selection).toEqual({ name: "picked" });
  turnCapture.resolve({ name: "turn" });
  expect(await turn).toBeUndefined();
  expect(outdated).toEqual([true]);
  expect(publication.snapshot).toEqual({ name: "picked" });
});

test("a selection still capturing when a turn finishes captures again, and the turn doesn't show the old selection first", async () => {
  const publication = new ChangesPublication<Snapshot>({ name: "initial" });
  const captures = [deferred(), deferred()];
  const outdated: boolean[] = [];
  const selection = publication.publishSelection(publication.select(), stale => { outdated.push(stale); return captures[outdated.length - 1]!.promise; });
  const turn = publication.refreshAfterTurn(async () => ({ name: "turn" }));
  expect(await turn).toBeUndefined();
  expect(publication.snapshot).toEqual({ name: "initial" });
  captures[0]!.resolve({ name: "picked before the turn" });
  captures[1]!.resolve({ name: "picked after the turn" });
  expect(await selection).toEqual({ name: "picked after the turn" });
  expect(outdated).toEqual([false, true]);
});

test("a turn's refresh publishes when no selection interferes, and later selections reuse its history", async () => {
  const publication = new ChangesPublication<Snapshot>({ name: "initial" });
  expect(await publication.refreshAfterTurn(async previous => ({ name: `after ${previous.name}` }))).toEqual({ name: "after initial" });
  let reused: boolean | undefined;
  await publication.publishSelection(publication.select(), async stale => { reused = !stale; return { name: "picked" }; });
  expect(reused).toBe(true);
});

test("the last selection wins", async () => {
  const publication = new ChangesPublication<Snapshot>({ name: "initial" });
  const slow = deferred();
  const first = publication.publishSelection(publication.select(), () => slow.promise);
  const second = publication.publishSelection(publication.select(), async () => ({ name: "second" }));
  expect(await second).toEqual({ name: "second" });
  slow.resolve({ name: "first" });
  expect(await first).toBeUndefined();
  expect(publication.snapshot).toEqual({ name: "second" });
});
