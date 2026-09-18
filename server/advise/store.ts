/**
 * Where summaries live between runs.
 *
 * The cache key is the branch's head SHA plus the prompt version plus the model. A
 * branch that has not moved is never summarised twice, which is what keeps a hundred
 * branches costing pennies rather than dollars — and it means changing the prompt
 * regenerates everything rather than leaving a quiet mix of old and new.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InsightMeta, Progress } from '../../shared/types.ts';
import { DATA_DIR, ensureDirs } from '../paths.ts';

export type StoredInsight = {
  title: string;
  summary: string;
  progress: Progress;
  meta: InsightMeta;
};

type InsightFile = Record<string, StoredInsight>;

const FILE = join(DATA_DIR, 'insights.json');

/** Unambiguous even for branch names containing slashes or hashes. */
export const insightKey = (repoKey: string, branch: string): string =>
  JSON.stringify([repoKey, branch]);

let cache: InsightFile | null = null;

function load(): InsightFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as InsightFile;
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * Returns the stored summary only if it still describes this exact branch state. A
 * summary of a commit you have since moved past is worse than no summary.
 */
export function getInsight(
  repoKey: string,
  branch: string,
  headSha: string,
  promptVersion: string,
  model: string,
): StoredInsight | null {
  const stored = load()[insightKey(repoKey, branch)];
  if (!stored) return null;
  if (stored.meta.headSha !== headSha) return null;
  if (stored.meta.promptVersion !== promptVersion) return null;
  if (stored.meta.model !== model) return null;
  return stored;
}

/**
 * The stored summary as it is, with no freshness check.
 *
 * `getInsight` answers "is there a usable one"; this answers "when was one last written",
 * which is what a re-read the owner asked for turns on — the cache key has not moved, so
 * the only honest predicate is that the answer is newer than the request (D81).
 */
export function insightWrittenAt(repoKey: string, branch: string, headSha: string): string | null {
  const stored = load()[insightKey(repoKey, branch)];
  return stored && stored.meta.headSha === headSha ? stored.meta.generatedAt : null;
}

export function putInsight(repoKey: string, branch: string, insight: StoredInsight): void {
  ensureDirs();
  const all = load();
  all[insightKey(repoKey, branch)] = insight;
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
}

/** Drops entries for branches that no longer exist, so deleted branches do not accrete. */
export function pruneInsights(liveKeys: Set<string>): number {
  const all = load();
  let removed = 0;
  for (const key of Object.keys(all)) {
    if (!liveKeys.has(key)) {
      delete all[key];
      removed++;
    }
  }
  if (removed > 0) {
    ensureDirs();
    writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  }
  return removed;
}

/** Tests and the debug CLI need to read a fresh file rather than a warm module. */
export function resetInsightCache(): void {
  cache = null;
}
