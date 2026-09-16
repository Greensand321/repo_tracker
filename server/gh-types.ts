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

export type GhCheckRuns = {
  check_runs: {
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
    html_url: string | null;
  }[];
};

export type GhRepo = {
  name: string;
  owner: { login: string };
  default_branch: string;
  html_url: string;
};
