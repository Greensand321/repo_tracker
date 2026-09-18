/**
 * Raw GitHub payloads → the canonical Snapshot. Pure: no I/O, no clock, no globals.
 * `now` is passed in so relevance is deterministic and testable (CLAUDE.md rule 5).
 */

import type { GhBranch, GhCi, GhCommit, GhCompare, GhPull, GhRepo } from './gh-types.ts';
import type {
  Branch,
  CiState,
  Commit,
  Diffstat,
  PullRequest,
  RateLimit,
  Repo,
  Snapshot,
} from '../shared/types.ts';

/** Everything collected for one repo, ready to transform. */
export type RepoBundle = {
  key: string;
  repo: GhRepo;
  branches: GhBranch[];
  pulls: GhPull[];
  /** Keyed by branch name. A branch may be missing if its detail fetch failed. */
  details: Record<string, BranchDetail>;
};

export type BranchDetail = {
  compare: GhCompare;
  ci: GhCi | null;
};

export type BuildOptions = {
  now: Date;
  quietAfterDays: number;
  commitsPerBranch: number;
};

const DAY_MS = 86_400_000;

export function buildSnapshot(
  bundles: RepoBundle[],
  warnings: string[],
  rateLimit: RateLimit | null,
  opts: BuildOptions,
): Snapshot {
  const repos: Repo[] = [];
  const branches: Branch[] = [];

  for (const bundle of bundles) {
    repos.push({
      key: bundle.key,
      owner: bundle.repo.owner.login,
      name: bundle.repo.name,
      defaultBranch: bundle.repo.default_branch,
      branchCount: bundle.branches.length,
      url: bundle.repo.html_url,
    });
    for (const ghBranch of bundle.branches) {
      branches.push(toBranch(bundle, ghBranch, opts));
    }
  }

  branches.sort(byActivityDesc);

  return {
    generatedAt: opts.now.toISOString(),
    repos,
    branches,
    warnings,
    rateLimit,
    // Both filled at the edge once the snapshot exists: goals by server/goals.ts
    // (free, Plane B), the rest by the advisor (advise/enrich.ts).
    goals: [],
    brief: null,
    work: { jobs: [], workers: 0, finished: [] },
    llm: { enabled: false, pending: 0, errors: [] },
  };
}

function toBranch(bundle: RepoBundle, ghBranch: GhBranch, opts: BuildOptions): Branch {
  const detail = bundle.details[ghBranch.name];
  const pr = pickPull(bundle.pulls, ghBranch.name);
  const commits = detail
    ? // compare returns oldest-first; the newest commit is the headline, so flip it.
      [...detail.compare.commits].reverse().slice(0, opts.commitsPerBranch).map(toCommit)
    : [];

  const lastActivity = commits[0]?.authoredAt ?? pr?.updatedAt ?? null;

  return {
    repoKey: bundle.key,
    name: ghBranch.name,
    headSha: ghBranch.commit.sha,
    url: `${bundle.repo.html_url}/tree/${encodeURIComponent(ghBranch.name)}`,
    commits,
    ahead: detail?.compare.ahead_by ?? 0,
    behind: detail?.compare.behind_by ?? 0,
    lastActivity,
    diff: toDiffstat(detail?.compare),
    activity: activityDates(commits),
    pr: pr?.pr ?? null,
    ci: toCiState(detail?.ci ?? null),
    goalId: null, // Plane B; attached by applyGoals once the snapshot is built.
    vision: null, // Plane B; attached by applyAssist, with its assessment.
    assessment: null,
    relevance: isQuiet(lastActivity, opts) ? 'quiet' : 'active',
    isBase: ghBranch.name === bundle.repo.default_branch,
    title: null,
    summary: null,
    progress: null,
    insight: null,
  };
}

export function toCommit(gh: GhCommit): Commit {
  const full = gh.commit.message ?? '';
  const newline = full.indexOf('\n');
  const message = (newline === -1 ? full : full.slice(0, newline)).trim();
  const body = newline === -1 ? '' : full.slice(newline + 1).trim();
  // The git author name is what the agent actually recorded; the GitHub login is a
  // fallback for commits with no author block.
  const author = gh.commit.author?.name ?? gh.author?.login ?? 'unknown';
  const rawDate = gh.commit.author?.date ?? gh.commit.committer?.date ?? null;

  return {
    sha: gh.sha,
    message,
    body,
    author,
    authoredAt: toIsoUtc(rawDate),
    url: gh.html_url,
  };
}

/** GitHub sends ISO-8601; normalise to UTC so repos are comparable (CLAUDE.md rule 8). */
export function toIsoUtc(raw: string | null | undefined): string {
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function toDiffstat(compare: GhCompare | undefined): Diffstat {
  if (!compare?.files) return { files: 0, additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const file of compare.files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  return { files: compare.files.length, additions, deletions };
}

/** Distinct YYYY-MM-DD dates that have commits, oldest first. Drives the activity strip. */
export function activityDates(commits: Commit[]): string[] {
  const days = new Set<string>();
  for (const commit of commits) {
    if (commit.authoredAt) days.add(commit.authoredAt.slice(0, 10));
  }
  return [...days].sort();
}

/**
 * The PR for a branch: an open one wins, otherwise the most recently updated. A branch
 * can accumulate several closed PRs over a long-running session.
 */
export function pickPull(
  pulls: GhPull[],
  branchName: string,
): { pr: PullRequest; updatedAt: string } | null {
  const mine = pulls.filter((p) => p.head?.ref === branchName);
  if (mine.length === 0) return null;

  mine.sort((a, b) => {
    const openDiff = Number(b.state === 'open') - Number(a.state === 'open');
    if (openDiff !== 0) return openDiff;
    return b.updated_at.localeCompare(a.updated_at);
  });

  const best = mine[0]!;
  return {
    pr: {
      number: best.number,
      title: best.title,
      state: best.merged_at ? 'merged' : best.state,
      draft: Boolean(best.draft),
      url: best.html_url,
    },
    updatedAt: toIsoUtc(best.updated_at),
  };
}

/**
 * Worst-wins: one failure makes the branch red regardless of what else passed.
 * `neutral` and `skipped` are not failures and must not turn a green branch red.
 *
 * Reads GitHub Actions runs first, then the older commit-status API — the two sources a
 * fine-grained token can actually see (see github.ts `fetchCi`).
 */
export function toCiState(ci: GhCi | null): CiState {
  const runs = ci?.runs?.workflow_runs ?? [];

  if (runs.length > 0) {
    let pending = false;
    let url: string | null = null;

    for (const run of runs) {
      if (run.status !== 'completed') {
        pending = true;
        url ??= run.html_url;
        continue;
      }
      if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'cancelled') {
        return { state: 'failing', url: run.html_url ?? url };
      }
      if (run.conclusion === 'action_required') {
        pending = true;
        url ??= run.html_url;
      }
    }
    if (pending) return { state: 'pending', url };
    return { state: 'passing', url: runs[0]?.html_url ?? null };
  }

  const combined = ci?.status;
  if (!combined || combined.total_count === 0) return { state: 'none', url: null };

  const url = combined.statuses.find((s) => s.target_url)?.target_url ?? null;
  if (combined.state === 'failure' || combined.state === 'error') return { state: 'failing', url };
  if (combined.state === 'pending') return { state: 'pending', url };
  if (combined.state === 'success') return { state: 'passing', url };
  return { state: 'none', url: null };
}

function isQuiet(lastActivity: string | null, opts: BuildOptions): boolean {
  if (!lastActivity) return true;
  const age = opts.now.getTime() - new Date(lastActivity).getTime();
  return age > opts.quietAfterDays * DAY_MS;
}

/** Newest first. Branches with no date at all sink to the bottom rather than jumping around. */
function byActivityDesc(a: Branch, b: Branch): number {
  if (!a.lastActivity && !b.lastActivity) return a.name.localeCompare(b.name);
  if (!a.lastActivity) return 1;
  if (!b.lastActivity) return -1;
  return b.lastActivity.localeCompare(a.lastActivity);
}
