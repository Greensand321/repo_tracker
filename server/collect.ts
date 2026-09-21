/**
 * Orchestrates a collection: read the cache, ask GitHub only for what moved, hand the
 * raw payloads to the pure snapshot builder.
 *
 * The cost model this exists to protect (plans/stage-1-plan.md §5):
 *   per repo    — 1 conditional branch list + 1 conditional PR list. A 304 is free.
 *   per branch  — nothing at all unless its head SHA moved, or its CI was unfinished.
 */

import type { Snapshot } from '../shared/types.ts';
import type { Settings } from '../shared/types.ts';
import { readCache, writeCache, type CachedDetail, type RepoCache } from './cache.ts';
import type { GhPull } from './gh-types.ts';
import {
  GitHubError,
  fetchBranches,
  fetchCi,
  fetchCompare,
  fetchPullCommits,
  fetchPulls,
  fetchRepo,
  getRateLimit,
} from './github.ts';
import { buildSnapshot, pickPull, toCiState, type BranchDetail, type RepoBundle } from './snapshot.ts';

/** Repos in parallel, and branches within a repo in parallel, but both bounded. */
const REPO_CONCURRENCY = 3;
const BRANCH_CONCURRENCY = 6;

export async function collect(settings: Settings): Promise<Snapshot> {
  const warnings: string[] = [];
  const bundles: RepoBundle[] = [];

  await mapLimit(settings.repos, REPO_CONCURRENCY, async (key) => {
    try {
      const result = await collectRepo(key, settings);
      bundles.push(result.bundle);
      warnings.push(...result.warnings);
    } catch (err) {
      // One unreachable repo must never cost you the other seven.
      warnings.push(`${key}: ${describe(err)}`);
    }
  });

  // mapLimit finishes out of order; keep the configured order so the UI is stable.
  bundles.sort((a, b) => settings.repos.indexOf(a.key) - settings.repos.indexOf(b.key));

  return buildSnapshot(bundles, warnings, getRateLimit(), {
    now: new Date(),
    quietAfterDays: settings.quietAfterDays,
    commitsPerBranch: settings.commitsPerBranch,
  });
}

async function collectRepo(
  key: string,
  settings: Settings,
): Promise<{ bundle: RepoBundle; warnings: string[] }> {
  const token = settings.token;
  const cache = readCache(key);

  // default_branch effectively never changes, so this is fetched once and then cached.
  const repo = cache.repo ?? (await fetchRepo(key, token));

  const branchesRes = await fetchBranches(key, token, cache.branchesEtag);
  const branches = branchesRes.status === 'unchanged' ? cache.branches : branchesRes.data;
  const branchesEtag = branchesRes.status === 'unchanged' ? cache.branchesEtag : branchesRes.etag;

  const pullsRes = await fetchPulls(key, token, cache.pullsEtag);
  const pulls = pullsRes.status === 'unchanged' ? cache.pulls : pullsRes.data;
  const pullsEtag = pullsRes.status === 'unchanged' ? cache.pullsEtag : pullsRes.etag;

  const details: Record<string, CachedDetail> = {};
  const failures: string[] = [];

  await mapLimit(branches, BRANCH_CONCURRENCY, async (branch) => {
    try {
      const detail = await detailFor(key, token, repo.default_branch, branch.name, branch.commit.sha, cache, pulls);
      if (detail) details[branch.name] = detail;
    } catch (err) {
      // A branch whose detail we could not read still belongs on screen, just bare.
      failures.push(`${branch.name} (${describe(err)})`);
    }
  });

  const next: RepoCache = {
    key,
    fetchedAt: new Date().toISOString(),
    repo,
    branchesEtag,
    branches,
    pullsEtag,
    pulls,
    details,
  };
  writeCache(next);

  return {
    bundle: { key, repo, branches, pulls, details: toBranchDetails(details) },
    warnings:
      failures.length > 0
        ? [`${key}: could not read ${failures.length} branch(es) — ${failures.join(', ')}`]
        : [],
  };
}

/**
 * Decides what actually has to be fetched for one branch.
 *
 * - The head SHA moved, or we have never seen it → fetch the compare.
 * - The compare is empty and the branch has a pull request → the branch was merged with a
 *   merge commit and its work is already in the base. Read its commits from the pull
 *   request instead (D89), once per head like everything else.
 * - CI was still running last time → re-fetch it even though the SHA is the same,
 *   because a build finishing is a change the SHA cannot tell us about.
 * - Otherwise → the cache is still correct and this branch costs nothing.
 */
async function detailFor(
  key: string,
  token: string,
  base: string,
  branchName: string,
  headSha: string,
  cache: RepoCache,
  pulls: GhPull[],
): Promise<CachedDetail | null> {
  const cached = cache.details[branchName];
  const moved = !cached || cached.sha !== headSha;

  // The base branch compared against itself is always empty — skip the round trip.
  if (branchName === base) {
    return { sha: headSha, compare: { ahead_by: 0, behind_by: 0, commits: [], files: [] }, ci: null, viaPull: null };
  }

  let compare = moved ? await fetchCompare(key, token, base, branchName) : cached.compare;
  let viaPull: number | null = moved ? null : (cached.viaPull ?? null);

  // Once per head — but a cache written before this existed holds an empty compare with
  // no record of the pull request ever being asked, and a branch that never moves again
  // would have stayed "nothing of its own" for ever. `undefined` means never asked.
  const neverAsked = !moved && cached.viaPull === undefined;
  if ((moved || neverAsked) && compare.commits.length === 0) {
    // Nothing ahead of the base is what a merged branch looks like — and "nothing of its
    // own" was the verdict on exactly the branches whose history is worth having. The pull
    // request kept it.
    const pull = pickPull(pulls, branchName);
    if (pull) {
      const own = await fetchPullCommits(key, token, pull.pr.number);
      if (own.length > 0) {
        compare = { ...compare, commits: own };
        viaPull = pull.pr.number;
      }
    }
  }

  const ciUnsettled = !cached || toCiState(cached.ci).state === 'pending';
  const ci = moved || ciUnsettled ? await fetchCi(key, token, headSha) : cached.ci;

  return { sha: headSha, compare, ci, viaPull };
}

function toBranchDetails(details: Record<string, CachedDetail>): Record<string, BranchDetail> {
  const out: Record<string, BranchDetail> = {};
  for (const [name, detail] of Object.entries(details)) {
    out[name] = { compare: detail.compare, ci: detail.ci, viaPull: detail.viaPull ?? null };
  }
  return out;
}

function describe(err: unknown): string {
  if (err instanceof GitHubError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Bounded parallelism, so 100 branches do not become 100 simultaneous requests. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
