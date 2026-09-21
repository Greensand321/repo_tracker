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
  /** The assistant's standing answer. Null until it has been written at least once. */
  brief: Brief | null;
  /**
   * What the assistant is doing and has left to do. Derived every read from this same
   * structure plus what is already on disk — never stored, never queued (D68).
   */
  work: WorkState;
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

  /**
   * Plane B. What this branch is FOR — the yardstick the work is measured against.
   * Null means nobody has said and the assistant has not drafted one. That is a normal
   * state, not an error, and it is stated rather than guessed around.
   */
  vision: Vision | null;
  /** The comparison of that vision against what the branch actually did. */
  assessment: Assessment | null;

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
// Vision — what a branch is FOR (Plane B). See docs/plans/vision-ux.md.
// ---------------------------------------------------------------------------

/**
 * Inference gives the *is*; only the owner gives the *ought*. A model can read a branch
 * and say accurately what it did — it cannot say whether that is what was wanted. The
 * vision is that missing half, said once, after which every assessment is a comparison
 * rather than a guess.
 */
export type Vision = {
  /** One or two sentences. Must be falsifiable or it cannot detect anything. */
  text: string;
  state: VisionState;
  /** What a draft was drawn from, so thin reasoning is visible before it is accepted. */
  from: string;
  /** The head SHA a draft was made at. Null when the owner wrote it. */
  draftedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `proposed` is load-bearing. The assistant may draft — that is the point — but a draft
 * silently treated as the owner's intent makes every assessment downstream inherit a
 * guess nobody saw. So a proposal is used, marked, and never the basis for "done".
 */
export type VisionState = 'yours' | 'confirmed' | 'proposed';

export type Verdict = 'on-track' | 'drifted' | 'done' | 'overtaken' | 'unclear';

export type Assessment = {
  verdict: Verdict;
  /** One sentence. For `drifted` it must name what the branch is doing instead. */
  because: string;
  /** Short SHAs, validated against the branch's own commits. */
  evidence: string[];
  /** For `overtaken`: the branch that satisfied this one's vision first. */
  overtakenBy: BranchRef | null;
  /**
   * What it went and looked at before deciding, by tool name. Empty means it judged from
   * what it was handed — which is a real difference in how much the verdict is worth, and
   * one the owner should be able to see rather than infer.
   */
  looked: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  /** Stale the moment either of these moves, which is what the cache key is built on. */
  headSha: string;
  visionText: string;
};

// ---------------------------------------------------------------------------
// Judgement and the brief
// ---------------------------------------------------------------------------

export type GoalState = 'progressing' | 'at-risk' | 'stalled' | 'looks-done' | 'needs-you';

/**
 * A judgement has no predicate — you cannot write one for "is this goal done". So it is
 * proposed, evidenced, and provisional until accepted. A wrong "done" is the single most
 * damaging thing the assistant can produce, because it is the one never gone back to.
 */
export type GoalJudgement = {
  state: GoalState;
  because: string;
  evidence: BranchRef[];
  model: string;
  promptVersion: string;
  generatedAt: string;
};

/** The standing answer to what is done, what is left, and what is going on. */
export type Brief = {
  text: string;
  generatedAt: string;
  model: string;
  promptVersion: string;
  /**
   * True when the fleet has moved since this was written. Shown rather than hidden: a
   * brief from ten minutes ago, dated, beats a blank space — and a routine rewrite waits
   * for `briefEveryMinutes`, so the space would be blank most of the day.
   */
  stale: boolean;
};

// ---------------------------------------------------------------------------
// The board — what the assistant is working on. See docs/plans/workroom.md.
// ---------------------------------------------------------------------------

export type JobKind = 'summarise' | 'draft-vision' | 'assess' | 'brief';

/**
 * `waiting` is on the board, `working` is claimed, `parked` failed twice and needs you.
 * `done` is kept only for work the owner asked for, and only briefly — see `WorkState`.
 */
export type JobState = 'waiting' | 'working' | 'parked' | 'done';

/** Routine work is derived. Dispatched work exists only because the owner asked for it. */
export type JobOrigin = 'routine' | 'dispatched';

export type JobSubject =
  | { kind: 'branch'; repoKey: string; branch: string }
  | { kind: 'fleet' };

/**
 * One piece of work.
 *
 * The id is **derived, not minted** — `kind:repo:branch:headSha` — so the same job derived
 * on the next read is the same job, and a read landing mid-flight finds it already claimed
 * instead of starting a second one. It also means a branch that moves gets a new id, which
 * is what retries a parked job at exactly the right moment and never before.
 */
export type Job = {
  id: string;
  kind: JobKind;
  /** Plain English, because this goes on screen (rule 3). The kind is supporting metadata. */
  title: string;
  subject: JobSubject;
  origin: JobOrigin;
  state: JobState;
  startedAt: string | null;
  attempts: number;
  /** Lookups this job has made. On screen, so "what is it doing" has a real answer. */
  toolCalls: number;
  /** The tool it is running right now, if any. */
  doing: string | null;
  /** Set when parked: what it tried and what came back. */
  error: string | null;
  /** Set when it finished. Only dispatched work keeps this; routine work just appears. */
  finishedAt?: string;
};

export type WorkState = {
  jobs: Job[];
  /** How many routine jobs may run at once. From settings, so the floor can say so. */
  workers: number;
  /**
   * Work the owner asked for that has just finished, newest first and ageing out.
   *
   * Only dispatched work: you are told when the thing you asked for lands, because the
   * point of asking was to stop watching. Routine work simply appears — forty notices
   * about forty summaries is a reason to stop reading notices (Q71).
   */
  finished: Job[];
};

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
  /** The assistant's read on this goal. Never flips `done` on its own — see GoalJudgement. */
  judgement: GoalJudgement | null;
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

/** The repo half of a `refKey`, or null for a key that was never one. */
export function repoOfKey(key: string): string | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null;
  } catch {
    return null;
  }
}

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
  /**
   * Whether the assistant drafts a vision for a branch nobody has described yet. It only
   * drafts when it can be specific — a vision that cannot be contradicted is worthless as
   * a yardstick, so it declines rather than writing "improve the UI".
   */
  visionAutoDraft: boolean;
  /** How many questions may be waiting at once. A wall of them is a chore list, not help. */
  maxOpenQuestions: number;
  /**
   * How long a routine rewrite of the brief waits after the last one, in minutes.
   *
   * The brief reads the whole fleet and its key moves whenever any branch does. With agents
   * pushing every few minutes that meant the most expensive prompt in the program ran on
   * nearly every read — a call a minute, all day, to change a clause. Asking for it
   * ("write it again") never waits; only the routine rewrite does. 0 means every read.
   */
  briefEveryMinutes: number;
  /**
   * Whether a station may look things up before answering (workroom step 3).
   *
   * Off is a real setting, not a panic button: it costs you evidence and saves you calls,
   * and every answer stays correct either way. Switching it changes what each station can
   * see, so the answers it already wrote are regenerated (D74) — one cheap pass.
   */
  toolsEnabled: boolean;
  /** Lookups one job may make. The ceiling, not the expectation: two tools rarely need 8. */
  toolCallsPerJob: number;
  /** And a clock, because a cheap tool can still be asked for forty times slowly. */
  toolSeconds: number;
  /**
   * How many jobs the owner asked for may run at once, **on top of** the routine workers
   * (D71). Its own lane, because work you asked for and then stopped watching must not
   * queue behind a hundred background summaries. Capped, because "spin up another" without
   * a ceiling is how forty concurrent calls happen.
   */
  dispatchWorkers: number;
  /**
   * How many routine jobs run at once (D71). Small on purpose: the only real burst is the
   * first import, after which the fleet moves every few minutes and this has all night.
   * More workers make a runaway bill arrive faster, not later.
   */
  workers: number;
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
  visionAutoDraft: true,
  maxOpenQuestions: 3,
  briefEveryMinutes: 15,
  toolsEnabled: true,
  toolCallsPerJob: 8,
  toolSeconds: 60,
  workers: 2,
  dispatchWorkers: 2,
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
