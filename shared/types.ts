/**
 * The canonical data structure. Every surface renders this and computes nothing
 * itself — if a view needs a fact, the fact belongs here (CLAUDE.md rule 4).
 */

export type Snapshot = {
  generatedAt: string; // ISO-8601 UTC
  repos: Repo[];
  branches: Branch[];
  warnings: string[]; // one unreachable repo must never cost you the others
  rateLimit: RateLimit | null;
};

export type Repo = {
  key: string; // "owner/name"
  owner: string;
  name: string;
  defaultBranch: string;
  branchCount: number;
  url: string;
};

export type Branch = {
  repoKey: string;
  /** The literal git branch name. Always shown, always searchable (CLAUDE.md rule 6). */
  name: string;
  headSha: string;
  url: string;

  /** Only the commits this branch adds to the base. Newest first. The point of Stage 1. */
  commits: Commit[];
  ahead: number;
  behind: number;
  /** null when the branch has no commits of its own and no PR to date it. */
  lastActivity: string | null;
  diff: Diffstat;
  /** Distinct YYYY-MM-DD dates with commits, oldest first — drives the activity strip. */
  activity: string[];

  pr: PullRequest | null;
  ci: CiState;

  /** Quiet branches fold away in the UI. Never deleted, never dropped (CLAUDE.md rule 10). */
  relevance: 'active' | 'quiet';
  /** True when this is the repo's base branch, which is a reference point, not a thread. */
  isBase: boolean;

  // --- Stage 2 fills these. Null until then; every view must render without them. ---
  /** LLM-written title, shown ALONGSIDE `name` and marked as generated. Never instead of it. */
  title: string | null;
  summary: string | null;
  progress: 'progressing' | 'stalled' | 'blocked' | 'done' | null;
};

export type Commit = {
  sha: string;
  /** First line of the commit message — the headline. */
  message: string;
  /** Everything after the first line, trimmed. Empty when there is none. */
  body: string;
  author: string;
  authoredAt: string; // ISO-8601 UTC
  url: string;
};

export type Diffstat = {
  files: number;
  additions: number;
  deletions: number;
};

export type PullRequest = {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  url: string;
};

export type CiState = {
  state: 'passing' | 'failing' | 'pending' | 'none';
  url: string | null;
};

export type RateLimit = {
  limit: number;
  remaining: number;
  /** ISO-8601 UTC. */
  resetsAt: string;
};

// ---------------------------------------------------------------------------
// Settings (Plane B, local only — the token never leaves this machine)
// ---------------------------------------------------------------------------

export type Settings = {
  token: string;
  repos: string[]; // "owner/name"
  /** Background refresh interval in seconds. 0 disables polling. */
  refreshSeconds: number;
  /** A branch untouched for longer than this folds away as 'quiet'. */
  quietAfterDays: number;
  /** Commits kept per branch in the snapshot. */
  commitsPerBranch: number;
};

/** What the settings screen is allowed to see: everything except the token itself. */
export type SafeSettings = Omit<Settings, 'token'> & { hasToken: boolean };

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  repos: [],
  refreshSeconds: 60,
  quietAfterDays: 14,
  commitsPerBranch: 50,
};

// ---------------------------------------------------------------------------
// What the page receives
// ---------------------------------------------------------------------------

export type SnapshotResponse = {
  snapshot: Snapshot | null;
  /** True while a fetch is in flight, so the page can show it without polling. */
  refreshing: boolean;
  /** Set when there is no usable snapshot and the reason is actionable. */
  needs: 'token' | 'repos' | null;
  error: string | null;
};
