/**
 * The canonical data structure. Every surface renders this and computes nothing
 * itself — if a view needs a fact, the fact belongs here (CLAUDE.md rule 4).
 */

export type Snapshot = {
  generatedAt: string; // ISO-8601 UTC
  repos: Repo[];
  branches: Branch[];
  /**
   * Plane B. Not read from GitHub — merged in at the edge after collection, so that
   * every surface still renders exactly one structure (rule 4) and no view has to join
   * two sources itself.
   */
  goals: Goal[];
  warnings: string[]; // one unreachable repo must never cost you the others
  rateLimit: RateLimit | null;
  llm: LlmStatus;
};

export type LlmStatus = {
  enabled: boolean;
  /** Branches still waiting on a summary. The page can show progress honestly. */
  pending: number;
  /** Non-fatal: the deterministic snapshot is unaffected. */
  errors: string[];
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

  /** Plane B. The goal this branch belongs to, or null while it is unfiled. */
  goalId: string | null;

  // --- Stage 2. Null until the LLM has read this branch; every view renders without them. ---
  /** LLM-written title, shown ALONGSIDE `name` and marked as generated. Never instead of it. */
  title: string | null;
  summary: string | null;
  progress: Progress | null;
  /** Where the summary came from, so a wrong one is debuggable rather than mysterious. */
  insight: InsightMeta | null;
};

export type Progress = 'progressing' | 'stalled' | 'blocked' | 'done';

// ---------------------------------------------------------------------------
// Goals (Plane B — the tool's own data, never written into a git repo)
// ---------------------------------------------------------------------------

/**
 * One thread of intent, grouping the branches working toward it.
 *
 * A branch has at most one goal (the owner's rule: "one branch has one goal and sub
 * tasks can diverge from that"). Branches with no goal are not an error — most start
 * that way and some never need one.
 *
 * Milestones sit above goals in the eventual model and are deliberately not here yet;
 * `milestone` is a plain string so the idea can be used before the structure exists.
 */
export type Goal = {
  id: string;
  title: string;
  /** Free text, the owner's own words. Shown in full, never summarised. */
  note: string;
  /** A label for now, a foreign key later. Empty means unfiled. */
  milestone: string;
  /** Branches assigned to this goal, oldest assignment first. */
  branches: BranchRef[];
  /** Done goals fold away exactly as quiet branches do — never deleted (rule 10). */
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BranchRef = {
  repoKey: string;
  branch: string;
};

/** Unambiguous even for branch names containing slashes. */
export const refKey = (repoKey: string, branch: string): string =>
  JSON.stringify([repoKey, branch]);

export type InsightMeta = {
  /** Short SHAs the model cited. Validated against the branch's own commits. */
  evidence: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  /** The head SHA this insight describes. Stale the moment the branch moves. */
  headSha: string;
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

  // --- Stage 2: the advisor. Disabled until a key and a model are set. ---
  llmApiKey: string;
  /** OpenAI-compatible endpoint. OpenCode Zen by default (D32). */
  llmBaseUrl: string;
  /** Left empty on purpose — pick one from the provider's own model list. */
  llmModel: string;
  llmEnabled: boolean;
  /** Ceiling on summaries per refresh, so a first run cannot surprise you with a bill. */
  llmMaxPerRun: number;
  /**
   * How many branches a question may put in front of the model. The prompt grows with
   * this, and so does the cost of every question — at a hundred branches the whole
   * register does not need to be in the prompt to answer "what is red".
   */
  askBranchCap: number;
};

/** What the settings screen is allowed to see: never a secret, only whether one is set. */
export type SafeSettings = Omit<Settings, 'token' | 'llmApiKey'> & {
  hasToken: boolean;
  hasLlmKey: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  repos: [],
  refreshSeconds: 60,
  quietAfterDays: 14,
  commitsPerBranch: 50,
  llmApiKey: '',
  llmBaseUrl: 'https://opencode.ai/zen/v1',
  llmModel: '',
  llmEnabled: true,
  llmMaxPerRun: 40,
  askBranchCap: 60,
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
