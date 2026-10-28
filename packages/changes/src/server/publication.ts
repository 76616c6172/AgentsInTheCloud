/**
 * Decides which capture Changes shows. Selections (picking commits, refreshing, saving an edit, opening a commit link)
 * and the refresh after each Agent turn capture concurrently; the last selection wins, and nothing publishes a history
 * from before a finished turn, which would leave out that turn's commits.
 */
export interface TurnRefresh<Snapshot> {
  capture(previous: Snapshot): Promise<Snapshot>;
  published(snapshot: Snapshot): void;
}

export class ChangesPublication<Snapshot extends object> {
  private request = 0;
  private turns = 0;
  /** The number of turns finished when the shown history was captured. */
  private historyTurn = 0;
  private capturing = 0;
  private waiting: (() => void)[] = [];
  constructor(public snapshot: Snapshot, private readonly turnRefresh: TurnRefresh<Snapshot>) {}

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
    } finally {
      // A turn's refresh left its commits to the selections capturing then. If they all failed or gave way to one that
      // failed, nothing showed them; refresh for the turn again. Nobody awaits this one, so its errors are logged.
      if (--this.capturing === 0) for (const resolve of this.waiting.splice(0)) resolve();
      if (this.capturing === 0 && this.historyTurn !== this.turns) this.refreshTurn(this.turns).catch(error => console.error("Could not refresh Changes after an Agent turn", error));
    }
  }

  /** What Changes shows once no selection is capturing anymore: for a selection's caller when a later one superseded it. */
  async settled(): Promise<Snapshot> {
    while (this.capturing) await new Promise<void>(resolve => this.waiting.push(resolve));
    return this.snapshot;
  }

  /** Refreshes after a turn, unless a selection captures this turn's commits itself, or a later turn refreshes again. */
  turnFinished(): Promise<void> { return this.refreshTurn(++this.turns); }

  private async refreshTurn(turn: number): Promise<void> {
    const selection = this.request, previous = this.snapshot;
    const next = await this.turnRefresh.capture(previous);
    if (this.request !== selection || this.snapshot !== previous || this.capturing || turn !== this.turns) return;
    this.turnRefresh.published(this.publish(next, turn));
  }

  private publish(snapshot: Snapshot, turn: number): Snapshot {
    this.snapshot = snapshot;
    this.historyTurn = turn;
    return snapshot;
  }
}
