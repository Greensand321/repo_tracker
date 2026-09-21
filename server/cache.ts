/**
 * The on-disk mirror of what GitHub told us. Plain JSON per repo: inspectable,
 * deletable, and safe to throw away — it is a cache, never a source of truth.
 */

import { join } from 'node:path';

import type { GhBranch, GhCi, GhCompare, GhPull, GhRepo } from './gh-types.ts';
import { readJson, writeJson } from './jsonfile.ts';
import { CACHE_DIR, repoFileName } from './paths.ts';

export type CachedDetail = {
  /** The head SHA this detail describes. Stale the moment the branch moves. */
  sha: string;
  compare: GhCompare;
  ci: GhCi | null;
};

export type RepoCache = {
  key: string;
  fetchedAt: string;
  repo: GhRepo | null;
  branchesEtag: string | null;
  branches: GhBranch[];
  pullsEtag: string | null;
  pulls: GhPull[];
  details: Record<string, CachedDetail>;
};

export function emptyCache(key: string): RepoCache {
  return {
    key,
    fetchedAt: '',
    repo: null,
    branchesEtag: null,
    branches: [],
    pullsEtag: null,
    pulls: [],
    details: {},
  };
}

export function readCache(key: string): RepoCache {
  const stored = readJson<Partial<RepoCache>>(join(CACHE_DIR, repoFileName(key)));
  return stored ? { ...emptyCache(key), ...stored } : emptyCache(key);
}

/**
 * Written every read, for every repo, so this is the file most likely to be mid-write when
 * the program is closed — and a torn one meant re-fetching every branch on the next start.
 */
export function writeCache(cache: RepoCache): void {
  writeJson(join(CACHE_DIR, repoFileName(cache.key)), cache, { pretty: false });
}
