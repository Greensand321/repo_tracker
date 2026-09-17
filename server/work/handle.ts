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
  /** Called as each lookup starts. Live, so the floor moves while the work happens. */
  onTool(name: string): void;
};
