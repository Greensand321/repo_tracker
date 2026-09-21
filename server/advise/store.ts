/**
 * Where summaries live between runs.
 *
 * The cache key is the branch's head SHA plus the prompt version plus the model. A
 * branch that has not moved is never summarised twice, which is what keeps a hundred
 * branches costing pennies rather than dollars — and it means changing the prompt
 * regenerates everything rather than leaving a quiet mix of old and new.
 */

import { join } from 'node:path';

import { repoOfKey, type InsightMeta, type Progress, type Recap } from '../../shared/types.ts';
import { readJson, writeJson } from '../jsonfile.ts';
import { DATA_DIR } from '../paths.ts';

export type StoredInsight = {
  title: string;
  summary: string;
  /** Absent only in a file written before v2, which the version check retires anyway. */
  recap?: Recap;
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
  cache = readJson<InsightFile>(FILE) ?? {};
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
  const all = load();
  all[insightKey(repoKey, branch)] = insight;
  writeJson(FILE, all);
}

/**
 * Drops entries for branches that no longer exist, so deleted branches do not accrete.
 *
 * Only within repos this read actually reached. A repo that could not be read is missing
 * from the snapshot, not from GitHub — and pruning against that snapshot deleted every
 * summary for it on the strength of one bad connection at startup, then paid to write them
 * all again. A repo taken out of settings keeps its entries too: nothing is ever dropped
 * from the data (rule 10), and adding it back should cost nothing.
 */
export function pruneInsights(liveKeys: Set<string>, reachedRepos: Set<string>): number {
  const all = load();
  let removed = 0;
  for (const key of Object.keys(all)) {
    const repo = repoOfKey(key);
    if (repo !== null && reachedRepos.has(repo) && !liveKeys.has(key)) {
      delete all[key];
      removed++;
    }
  }
  if (removed > 0) writeJson(FILE, all);
  return removed;
}

/** Tests and the debug CLI need to read a fresh file rather than a warm module. */
export function resetInsightCache(): void {
  cache = null;
}
