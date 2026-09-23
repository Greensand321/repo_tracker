/**
 * The record of everything the agent changed — Plane B, on disk, kept to `agentHistory`.
 *
 * It is what makes autonomy safe without asking first (D94): the page lists what changed
 * from here, never from the model's words; the feed is a view of it; and undo reads the
 * before-and-after kept here. It survives restarts, because "what did it do while I was
 * away" is exactly the question asked after one.
 */

import { join } from 'node:path';

import type { Change, ChangeFeed } from '../../shared/types.ts';
import { getGoal } from '../goals.ts';
import { readJson, writeJson } from '../jsonfile.ts';
import { DATA_DIR } from '../paths.ts';

/** A change plus what only the server needs: what it touched, and what it was before and after. */
export type Entry = Change & {
  /** The goal id, the branch's refKey, the note id — what an undo checks has not moved since. */
  subject: string;
  before: unknown;
  after: unknown;
  /**
   * A purpose change only: the judgement drawn against the old purpose, which changing the
   * words throws away. Kept so undoing the change does not also cost a paid re-check.
   */
  assessment?: unknown;
};

type File = { entries: Entry[] };

const FILE = join(DATA_DIR, 'actions.json');
/** How many the page draws. The rest are on disk, for undo and for the record. */
const FEED_ROWS = 30;

let cache: File | null = null;

function load(): File {
  if (cache) return cache;
  const parsed = readJson<Partial<File>>(FILE);
  cache = { entries: Array.isArray(parsed?.entries) ? parsed.entries.flatMap(normalise) : [] };
  return cache;
}

/**
 * An entry as the rest of the code can trust it, or nothing. A file that parses but holds
 * the wrong shape — hand-edited, or half of an old format — must not take the feed down
 * with it, and the feed is read on every refresh.
 */
function normalise(raw: unknown): Entry[] {
  const e = raw as Partial<Entry> | null;
  if (!e || typeof e !== 'object') return [];
  if (typeof e.id !== 'string' || typeof e.turn !== 'string' || typeof e.kind !== 'string' || typeof e.text !== 'string') return [];
  return [{
    id: e.id,
    at: typeof e.at === 'string' ? e.at : new Date(0).toISOString(),
    turn: e.turn,
    words: typeof e.words === 'string' ? e.words : '',
    kind: e.kind,
    text: e.text,
    undoable: e.undoable === true,
    undone: typeof e.undone === 'string' ? e.undone : null,
    seen: e.seen === true,
    flag: e.flag === 'goal-done' ? 'goal-done' : null,
    subject: typeof e.subject === 'string' ? e.subject : '',
    before: e.before ?? null,
    after: e.after ?? null,
    ...(e.assessment !== undefined ? { assessment: e.assessment } : {}),
  }];
}

function persist(file: File): void {
  writeJson(FILE, file);
  cache = file;
}

/**
 * Oldest first out, beyond `keep` (Q80: 500) — **a whole prompt at a time**, and never the
 * prompt being recorded. Cutting through the middle of one would leave an "undo all" that
 * reports every step undone while the rest of what that prompt did stays in place.
 * A single prompt larger than `keep` is kept whole, over the limit, until the next one.
 */
export function record(entries: Entry[], keep: number): void {
  if (entries.length === 0) return;
  const file = load();
  const current = new Set(entries.map((e) => e.turn));
  let kept = file.entries;
  const room = Math.max(0, keep - entries.length);
  if (kept.filter((e) => !current.has(e.turn)).length > 0 && kept.length > room) {
    // Turns in the order they began. A turn's entries need not be together: accepting a
    // regrouping adds to its answer's turn later.
    const order = [...new Set(kept.map((e) => e.turn))].filter((t) => !current.has(t));
    const count = new Map<string, number>();
    for (const e of kept) count.set(e.turn, (count.get(e.turn) ?? 0) + 1);
    const dropped = new Set<string>();
    let size = kept.length;
    for (const turn of order) {
      if (size <= room) break;
      dropped.add(turn);
      size -= count.get(turn) ?? 0;
    }
    kept = kept.filter((e) => !dropped.has(e.turn));
  }
  persist({ entries: [...kept, ...entries] });
}

export const allEntries = (): Entry[] => load().entries;
export const findEntry = (id: string): Entry | null => load().entries.find((e) => e.id === id) ?? null;
export const turnEntries = (turn: string): Entry[] => load().entries.filter((e) => e.turn === turn);

export function markUndone(id: string, at = new Date()): void {
  const file = load();
  const entry = file.entries.find((e) => e.id === id);
  if (!entry || entry.undone) return;
  entry.undone = at.toISOString();
  entry.seen = true;
  persist(file);
}

/** Mark some, or all, as looked at. The feed's unseen count and the dateline follow. */
export function markSeen(ids: string[] | 'all'): number {
  const file = load();
  const want = ids === 'all' ? null : new Set(ids);
  let changed = 0;
  for (const entry of file.entries) {
    if (!entry.seen && (want === null || want.has(entry.id))) {
      entry.seen = true;
      changed++;
    }
  }
  if (changed > 0) persist(file);
  return changed;
}

/** What the page shows: the newest few, without the before-and-after it has no use for. */
export function feed(): ChangeFeed {
  const entries = load().entries;
  const unseen = entries.filter((e) => !e.seen && !e.undone);
  return {
    recent: entries.slice(-FEED_ROWS).reverse().map(toChange),
    unseen: unseen.length,
    // Only while it still stands: a goal the owner has since reopened or deleted is not
    // one the dateline should still be asking them to check.
    goalsDone: unseen.filter((e) => e.flag === 'goal-done' && getGoal(e.subject)?.done === true).length,
  };
}

export function toChange(entry: Entry): Change {
  const { subject: _s, before: _b, after: _a, assessment: _x, ...change } = entry;
  return change;
}

export function resetRecordCache(): void {
  cache = null;
}
