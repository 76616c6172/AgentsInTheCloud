import { expect, test } from "bun:test";
import { ChangesPublication } from "../src/server/publication.ts";

interface Snapshot { name: string }
/** Turn refreshes return the queued captures in order, or "turn" once they run out. */
function publication(turnCaptures: Promise<Snapshot>[] = []) {
  const published: string[] = [];
  const subject = new ChangesPublication<Snapshot>({ name: "initial" }, {
    capture: () => turnCaptures.shift() ?? Promise.resolve({ name: "turn" }),
    published: snapshot => published.push(snapshot.name),
  });
  return { subject, published };
}

test("a selection made while a turn refreshes captures a fresh history and wins", async () => {
  const turnCapture = Promise.withResolvers<Snapshot>();
  const { subject, published } = publication([turnCapture.promise]);
  const turn = subject.turnFinished();
  const outdated: boolean[] = [];
  expect(await subject.publishSelection(subject.select(), async stale => { outdated.push(stale); return { name: "picked" }; })).toEqual({ name: "picked" });
  turnCapture.resolve({ name: "turn" });
  await turn;
  expect(outdated).toEqual([true]);
  expect(published).toEqual([]);
  expect(subject.snapshot).toEqual({ name: "picked" });
});

test("a selection still capturing when a turn finishes captures again, and the turn doesn't show the old selection first", async () => {
  const { subject, published } = publication();
  const captures = [Promise.withResolvers<Snapshot>(), Promise.withResolvers<Snapshot>()];
  const outdated: boolean[] = [];
  const selection = subject.publishSelection(subject.select(), stale => { outdated.push(stale); return captures[outdated.length - 1]!.promise; });
  await subject.turnFinished();
  expect(published).toEqual([]);
  expect(subject.snapshot).toEqual({ name: "initial" });
  captures[0]!.resolve({ name: "picked before the turn" });
  captures[1]!.resolve({ name: "picked after the turn" });
  expect(await selection).toEqual({ name: "picked after the turn" });
  expect(outdated).toEqual([false, true]);
});

test("a turn's refresh publishes when no selection interferes, and later selections reuse its history", async () => {
  const { subject, published } = publication();
  await subject.turnFinished();
  expect(published).toEqual(["turn"]);
  let reused: boolean | undefined;
  await subject.publishSelection(subject.select(), async stale => { reused = !stale; return { name: "picked" }; });
  expect(reused).toBe(true);
});

test("the last selection wins", async () => {
  const { subject } = publication();
  const slow = Promise.withResolvers<Snapshot>();
  const first = subject.publishSelection(subject.select(), () => slow.promise);
  const second = subject.publishSelection(subject.select(), async () => ({ name: "second" }));
  expect(await second).toEqual({ name: "second" });
  slow.resolve({ name: "first" });
  expect(await first).toBeUndefined();
  expect(subject.snapshot).toEqual({ name: "second" });
});

test("a turn's commits still publish when the selection that held its refresh back fails", async () => {
  const { subject, published } = publication([Promise.resolve({ name: "turn held back" })]);
  const failing = Promise.withResolvers<Snapshot>();
  const selection = subject.publishSelection(subject.select(), () => failing.promise);
  await subject.turnFinished();
  expect(published).toEqual([]);
  failing.reject(new Error("git failed"));
  await expect(selection).rejects.toThrow("git failed");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(published).toEqual(["turn"]);
  expect(subject.snapshot).toEqual({ name: "turn" });
});
