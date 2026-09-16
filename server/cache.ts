/**
 * The on-disk mirror of what GitHub told us. Plain JSON per repo: inspectable,
 * deletable, and safe to throw away — it is a cache, never a source of truth.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GhBranch, GhCi, GhCompare, GhPull, GhRepo } from './gh-types.ts';
import { CACHE_DIR, ensureDirs, repoFileName } from './paths.ts';

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
  try {
    const raw = readFileSync(join(CACHE_DIR, repoFileName(key)), 'utf8');
    return { ...emptyCache(key), ...(JSON.parse(raw) as RepoCache) };
  } catch {
    return emptyCache(key);
  }
}

export function writeCache(cache: RepoCache): void {
  ensureDirs();
  writeFileSync(join(CACHE_DIR, repoFileName(cache.key)), JSON.stringify(cache), 'utf8');
}
