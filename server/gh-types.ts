/**
 * The shapes we consume from the GitHub REST API. Types only, no I/O — so the pure
 * snapshot layer can import them without depending on the fetching code.
 * Every field we actually read is listed; the API returns far more.
 */

export type GhBranch = {
  name: string;
  commit: { sha: string };
  protected?: boolean;
};

export type GhUser = { login: string } | null;

export type GhCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer: { name?: string; date?: string } | null;
  };
  author: GhUser;
};

export type GhCompare = {
  ahead_by: number;
  behind_by: number;
  commits: GhCommit[];
  files?: { additions: number; deletions: number }[];
};

export type GhPull = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged_at: string | null;
  html_url: string;
  head: { ref: string };
  updated_at: string;
};

/**
 * CI state, from the two sources a fine-grained personal access token can actually read.
 *
 * NOT check runs: GitHub does not offer the `Checks` permission to fine-grained PATs at
 * all — only GitHub Apps can call that API. Asking for it produces a token that silently
 * reports "no CI" on every branch.
 */
export type GhCi = {
  /** GitHub Actions, via `Actions: Read`. The primary source. */
  runs: GhWorkflowRuns | null;
  /** The older commit-status API, via `Commit statuses: Read`. Catches non-Actions CI. */
  status: GhCombinedStatus | null;
};

export type GhWorkflowRuns = {
  workflow_runs: {
    /** queued | in_progress | completed | waiting | requested | pending */
    status: string | null;
    /** success | failure | cancelled | skipped | neutral | timed_out | action_required */
    conclusion: string | null;
    html_url: string | null;
    name?: string;
  }[];
};

export type GhCombinedStatus = {
  /** success | pending | failure | error */
  state: string;
  total_count: number;
  statuses: { state: string; target_url: string | null }[];
};

export type GhRepo = {
  name: string;
  owner: { login: string };
  default_branch: string;
  html_url: string;
};
