/**
 * Decides which capture Changes shows. Selections (picking commits, refreshing, saving an edit, opening a commit link)
 * and the refresh after each Agent turn capture concurrently; the last selection wins, and nothing publishes a history
 * from before a finished turn, which would leave out that turn's commits.
 */
export class ChangesPublication<Snapshot extends object> {
  private request = 0;
  private turns = 0;
  /** The number of turns finished when the shown history was captured. */
  private historyTurn = 0;
  private capturing = 0;
  constructor(public snapshot: Snapshot) {}

  /** Starts a selection, superseding earlier ones. */
  select(): number { return ++this.request; }
  superseded(ticket: number): boolean { return ticket !== this.request; }

  /**
   * Publishes a selection's capture, or returns undefined when a later selection superseded it. Captures again when a
   * turn finished meanwhile. `outdated` asks for a freshly captured history instead of reusing the shown one.
   */
  async publishSelection(ticket: number, capture: (outdated: boolean) => Promise<Snapshot>): Promise<Snapshot | undefined> {
    this.capturing++;
    try {
      for (let outdated = this.historyTurn !== this.turns; ; outdated = true) {
        const turn = this.turns;
        const next = await capture(outdated);
        if (this.superseded(ticket)) return undefined;
        if (turn === this.turns) return this.publish(next, turn);
      }
    } finally { this.capturing--; }
  }

  /** Refreshes after a turn, unless a selection captures this turn's commits itself, or a later turn refreshes again. */
  async refreshAfterTurn(capture: (previous: Snapshot) => Promise<Snapshot>): Promise<Snapshot | undefined> {
    const turn = ++this.turns, selection = this.request, previous = this.snapshot;
    const next = await capture(previous);
    if (this.request !== selection || this.snapshot !== previous || this.capturing || turn !== this.turns) return undefined;
    return this.publish(next, turn);
  }

  private publish(snapshot: Snapshot, turn: number): Snapshot {
    this.snapshot = snapshot;
    this.historyTurn = turn;
    return snapshot;
  }
}
