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
import { readJson, writeJson } from '../jsonfile.ts';
import { DATA_DIR } from '../paths.ts';

/** A change plus what only the server needs: what it touched, and what it was before and after. */
export type Entry = Change & {
  /** The goal id, the branch's refKey, the note id — what an undo checks has not moved since. */
  subject: string;
  before: unknown;
  after: unknown;
};

type File = { entries: Entry[] };

const FILE = join(DATA_DIR, 'actions.json');
/** How many the page draws. The rest are on disk, for undo and for the record. */
const FEED_ROWS = 30;

let cache: File | null = null;

function load(): File {
  if (cache) return cache;
  const parsed = readJson<Partial<File>>(FILE);
  cache = { entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  return cache;
}

function persist(file: File): void {
  writeJson(FILE, file);
  cache = file;
}

/** Oldest first out, beyond `keep` (Q80: 500). */
export function record(entries: Entry[], keep: number): void {
  if (entries.length === 0) return;
  const file = load();
  const next = [...file.entries, ...entries];
  persist({ entries: next.length > keep ? next.slice(next.length - keep) : next });
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
    goalsDone: unseen.filter((e) => e.flag === 'goal-done').length,
  };
}

export function toChange(entry: Entry): Change {
  const { subject: _s, before: _b, after: _a, ...change } = entry;
  return change;
}

export function resetRecordCache(): void {
  cache = null;
}
