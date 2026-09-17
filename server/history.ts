/**
 * A dated record of branch state, appended on every successful collection.
 *
 * It exists because "what changed and by how much" (R11) cannot be reconstructed after
 * the fact — if the history is not being written from the first run, that feature becomes
 * impossible rather than merely unbuilt. One line per branch per day, a few kilobytes a
 * month.
 *
 * It went unread for two days on purpose (D31). `readSince` is the first reader: the
 * `what_changed` tool, which is the feature it was written for.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Snapshot } from '../shared/types.ts';
import { HISTORY_DIR, ensureDirs } from './paths.ts';

export type HistoryRow = {
  date: string; // YYYY-MM-DD
  repo: string;
  branch: string;
  sha: string;
  commits: number;
  ahead: number;
  behind: number;
  ci: string;
  pr: string;
};

/** Unambiguous even for branch names containing slashes, colons or dots. */
const rowId = (repo: string, branch: string): string => JSON.stringify([repo, branch]);

export function recordHistory(snapshot: Snapshot): void {
  ensureDirs();
  const date = snapshot.generatedAt.slice(0, 10);
  const file = join(HISTORY_DIR, `${date.slice(0, 7)}.jsonl`);

  // One row per branch per day: the point is the shape of change over weeks, and a row
  // every sixty seconds would bury that in noise while growing without bound.
  const already = seenToday(file, date);
  const lines: string[] = [];

  for (const branch of snapshot.branches) {
    if (already.has(rowId(branch.repoKey, branch.name))) continue;
    const row: HistoryRow = {
      date,
      repo: branch.repoKey,
      branch: branch.name,
      sha: branch.headSha,
      commits: branch.commits.length,
      ahead: branch.ahead,
      behind: branch.behind,
      ci: branch.ci.state,
      pr: branch.pr ? branch.pr.state : 'none',
    };
    lines.push(JSON.stringify(row));
  }

  if (lines.length > 0) appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function seenToday(file: string, date: string): Set<string> {
  const seen = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return seen;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line) as HistoryRow;
      if (row.date === date) seen.add(rowId(row.repo, row.branch));
    } catch {
      // A truncated last line is survivable; the history is additive, not authoritative.
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Reading it back — the first consumer is the `what_changed` tool
// ---------------------------------------------------------------------------

/**
 * Every row on or after `sinceDate` (YYYY-MM-DD), oldest first.
 *
 * Reads only the month files that could contain them, so asking for a week never opens a
 * year. A month with no file is a month the program was not run — normal, not an error.
 */
export function readSince(sinceDate: string, now: Date = new Date()): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const month of monthsBetween(sinceDate.slice(0, 7), now.toISOString().slice(0, 7))) {
    let raw: string;
    try {
      raw = readFileSync(join(HISTORY_DIR, `${month}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as HistoryRow;
        if (typeof row.date === 'string' && row.date >= sinceDate) rows.push(row);
      } catch {
        // A truncated last line is survivable; the history is additive, not authoritative.
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Inclusive, as YYYY-MM. Capped so a nonsense date cannot spin. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [to];
  for (let guard = 0; guard < 24; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= to) break;
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return months;
}
