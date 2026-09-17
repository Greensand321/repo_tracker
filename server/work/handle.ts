/**
 * What a worker is handed when its job is claimed.
 *
 * Its own file so a station can take one without importing the board, and the board can
 * build one without importing every station — the two would otherwise refer to each other
 * in a circle for the sake of one type.
 */

export type RunHandle = {
  /**
   * The batch this job belongs to. Every job in one read shares it, which is what keeps a
   * shared prompt prefix warm on one provider (D66).
   */
  sessionId: string;
  /**
   * Called with a tool's name as a lookup starts, and with null when it finishes — a
   * worker that has stopped looking something up should stop saying it is.
   */
  onTool(name: string | null): void;
  /**
   * Ask for one more provider call. False means the read's budget is gone.
   *
   * A job's first call is paid for when it is claimed; every lookup after that asks here.
   * Without this the budget was only checked at claim time, so a read that claimed forty
   * jobs could then spend eight lookups on each — a cap of forty buying three hundred
   * calls. The number on the settings screen has to be the number.
   */
  spend(): boolean;
};
