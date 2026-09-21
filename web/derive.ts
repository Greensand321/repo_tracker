/**
 * Pure projections of the one Snapshot.
 *
 * Rule 4 says a view must never compute a fact for itself. These are not new facts —
 * they are groupings and orderings of facts the Snapshot already carries — but they live
 * here rather than inside a view so that every surface shares exactly one answer to
 * "which branches are in this goal" and "which one is happening now". No view imports
 * anything but these.
 *
 * Everything here is pure and takes its clock as an argument, so it is testable without
 * a browser (rule 5).
 */

import type { Branch, Goal, Job, JobKind, Snapshot, Verdict } from '../shared/types.ts';

/** A branch thread of work. The base branch is a reference point, not a thread. */
export const threads = (snapshot: Snapshot): Branch[] => snapshot.branches.filter((b) => !b.isBase);

export const byRecency = (a: Branch, b: Branch): number =>
  Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0');

/**
 * The single branch that gets the teal. Most recently touched among those still moving;
 * null when everything has gone quiet, which is a real state and not an error.
 */
export function nowThread(snapshot: Snapshot): Branch | null {
  const live = threads(snapshot).filter((b) => b.relevance === 'active');
  return [...live].sort(byRecency)[0] ?? null;
}

export type GoalGroup = {
  /** null is the unfiled group — normal, not an error. Most branches start here. */
  goal: Goal | null;
  branches: Branch[];
};

/**
 * Branches grouped under their goal.
 *
 * Order: live goals by their most recently touched branch, then goals marked done, then
 * the unfiled. An empty goal is kept — you file a goal before the work exists, and a
 * goal that vanished the moment its last branch merged would be worse than useless.
 */
export function groupByGoal(snapshot: Snapshot, list = threads(snapshot)): GoalGroup[] {
  const byId = new Map<string, Branch[]>();
  const unfiled: Branch[] = [];

  for (const branch of list) {
    if (branch.goalId && snapshot.goals.some((g) => g.id === branch.goalId)) {
      const bucket = byId.get(branch.goalId) ?? [];
      bucket.push(branch);
      byId.set(branch.goalId, bucket);
    } else {
      unfiled.push(branch);
    }
  }

  const groups: GoalGroup[] = snapshot.goals.map((goal) => ({
    goal,
    branches: (byId.get(goal.id) ?? []).sort(byRecency),
  }));

  groups.sort((a, b) => {
    if (a.goal!.done !== b.goal!.done) return a.goal!.done ? 1 : -1;
    const at = a.branches[0]?.lastActivity ?? null;
    const bt = b.branches[0]?.lastActivity ?? null;
    if (at === null && bt === null) return a.goal!.title.localeCompare(b.goal!.title);
    if (at === null) return 1;
    if (bt === null) return -1;
    return Date.parse(bt) - Date.parse(at);
  });

  if (unfiled.length > 0) groups.push({ goal: null, branches: unfiled.sort(byRecency) });
  return groups;
}

/**
 * The glyph gutter. One character says what a branch is doing before you read a word of
 * it — and it is the only place progress appears, so the chips can stay quiet.
 */
export function glyph(branch: Branch): string {
  if (branch.ci.state === 'failing') return '⚑';
  switch (branch.progress) {
    case 'done': return '✦';
    case 'blocked': return '⚑';
    case 'stalled': return '⚓';
    case 'progressing': return '●';
    default: return branch.relevance === 'quiet' ? '⚓' : '·';
  }
}

/** The dot class used in the register, which has no room for a glyph. */
export function dotClass(branch: Branch): string {
  if (branch.ci.state === 'failing' || branch.progress === 'blocked') return 'blocked';
  if (branch.progress === 'done') return 'done';
  if (branch.relevance === 'quiet') return 'quiet';
  if (branch.progress === 'stalled') return 'stalled';
  return 'active';
}

export type Tallies = {
  repos: number;
  branches: number;
  active: number;
  quiet: number;
  failing: number;
  openPrs: number;
  commits: number;
  goals: number;
  unfiled: number;
  /** Branches GitHub reports that this snapshot is not carrying — folded, never deleted. */
  folded: number;
  awaitingSummary: number;
};

export function tallies(snapshot: Snapshot): Tallies {
  const list = threads(snapshot);
  const known = snapshot.repos.reduce((n, r) => n + r.branchCount, 0);
  return {
    repos: snapshot.repos.length,
    branches: list.length,
    active: list.filter((b) => b.relevance === 'active').length,
    quiet: list.filter((b) => b.relevance === 'quiet').length,
    failing: list.filter((b) => b.ci.state === 'failing').length,
    openPrs: list.filter((b) => b.pr?.state === 'open').length,
    commits: list.reduce((n, b) => n + b.commits.length, 0),
    goals: snapshot.goals.filter((g) => !g.done).length,
    unfiled: list.filter((b) => !b.goalId).length,
    folded: Math.max(0, known - snapshot.branches.length),
    awaitingSummary: snapshot.llm.enabled ? snapshot.llm.pending : 0,
  };
}

/** Matches the literal branch name first, because that is what rule 6 promises. */
export function matches(branch: Branch, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return (
    branch.name.toLowerCase().includes(q) ||
    branch.repoKey.toLowerCase().includes(q) ||
    (branch.title ?? '').toLowerCase().includes(q) ||
    (branch.summary ?? '').toLowerCase().includes(q) ||
    (branch.recap?.done ?? '').toLowerCase().includes(q) ||
    (branch.pr?.title ?? '').toLowerCase().includes(q) ||
    branch.commits.some((c) => c.message.toLowerCase().includes(q))
  );
}

/** The headline for a branch: the advisor's title if it has one, else the truest thing available. */
export function headline(branch: Branch): { text: string; generated: boolean } {
  if (branch.title) return { text: branch.title, generated: true };
  const newest = branch.commits[0]?.message;
  if (newest) return { text: newest, generated: false };
  return { text: 'Nothing of its own yet', generated: false };
}

// ---------------------------------------------------------------------------
// Vision, and the questions it raises
// ---------------------------------------------------------------------------

/**
 * What is waiting on the owner.
 *
 * Derived, never stored — so it cannot go stale, and answering one makes it disappear
 * because the underlying state changed rather than because a flag was set.
 *
 * Ordered by what it costs to leave alone: work going wrong first (drift, a branch made
 * pointless, a goal that looks finished), then the setup questions. Capped, because a
 * hundred branches could raise a hundred questions and a wall of them is a chore list,
 * not help. An unasked question is not a failure.
 */
// ---------------------------------------------------------------------------
// The floor — what the assistant is doing, and what it has left
// ---------------------------------------------------------------------------

export type Floor = {
  working: Job[];
  waiting: Job[];
  parked: Job[];
  /** Work the owner asked for that has just landed. Ages out on its own. */
  finished: Job[];
  /** What is queued, by kind, so a long tail reads as one line rather than forty. */
  queued: { kind: JobKind; count: number }[];
};

export function floor(snapshot: Snapshot): Floor {
  const jobs = snapshot.work?.jobs ?? [];
  const waiting = jobs.filter((j) => j.state === 'waiting');

  const queued = new Map<JobKind, number>();
  for (const job of waiting) queued.set(job.kind, (queued.get(job.kind) ?? 0) + 1);

  return {
    working: jobs.filter((j) => j.state === 'working'),
    waiting,
    parked: jobs.filter((j) => j.state === 'parked'),
    finished: snapshot.work?.finished ?? [],
    queued: [...queued].map(([kind, count]) => ({ kind, count })),
  };
}

/**
 * What a worker is doing this second, in the owner's language.
 *
 * Tool names are for the model; this line is for you. An unknown name falls back to
 * itself rather than to nothing — a new tool should look odd on screen, not invisible.
 */
export const toolLabel = (name: string): string =>
  ({
    sibling_branches: 'reading the branches next to it',
    what_changed: 'reading what changed lately',
    repo_readme: 'reading what the repo is for',
    commit_files: 'reading what a commit touched',
    dispatch: 'starting work',
  })[name] ?? `using ${name}`;

/**
 * The job kind in the owner's language, for the small grey line under the title.
 *
 * The headline is the job's own `title` — "Reading what claude/foo is doing" — because
 * plain English is the headline and the machinery is the supporting metadata (rule 3).
 */
export const jobKindLabel = (kind: JobKind): string =>
  ({
    summarise: 'summary',
    'draft-vision': 'what it is for',
    assess: 'against its vision',
    brief: 'the brief',
  })[kind];

export type Question =
  /** A job that failed twice. It is not an error message; it is something waiting on you. */
  | { kind: 'stuck'; job: Job }
  | { kind: 'drift'; branch: Branch }
  | { kind: 'overtaken'; branch: Branch }
  | { kind: 'goal-done'; goal: Goal }
  | { kind: 'confirm-vision'; branch: Branch }
  | { kind: 'no-vision'; branch: Branch };

const QUESTION_ORDER: Question['kind'][] = [
  'stuck',
  'drift',
  'overtaken',
  'goal-done',
  'confirm-vision',
  'no-vision',
];

export function questions(snapshot: Snapshot, cap: number): Question[] {
  const found: Question[] = [];

  // Work that gave up comes first: everything else here is the assistant asking for
  // context, and this is the assistant admitting it could not do its job.
  for (const job of floor(snapshot).parked) found.push({ kind: 'stuck', job });

  for (const branch of threads(snapshot)) {
    // Quiet branches are not worth asking about. Most of a hundred branches are quiet,
    // and that is exactly the noise this cap exists to prevent.
    if (branch.relevance !== 'active') continue;

    if (branch.assessment?.verdict === 'overtaken') found.push({ kind: 'overtaken', branch });
    else if (branch.assessment?.verdict === 'drifted') found.push({ kind: 'drift', branch });

    if (branch.vision?.state === 'proposed') found.push({ kind: 'confirm-vision', branch });
    else if (!branch.vision && branch.commits.length > 0) found.push({ kind: 'no-vision', branch });
  }

  for (const goal of snapshot.goals) {
    if (!goal.done && goal.judgement?.state === 'looks-done') found.push({ kind: 'goal-done', goal });
  }

  found.sort((a, b) => QUESTION_ORDER.indexOf(a.kind) - QUESTION_ORDER.indexOf(b.kind));
  return cap > 0 ? found.slice(0, cap) : [];
}

/**
 * How a verdict reads on screen. `done` is deliberately never the word "merged" — a
 * branch can be done and unmerged, or merged and not done, and conflating them is how a
 * board starts lying.
 */
export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'on-track': return 'on track';
    case 'drifted': return 'drifted';
    case 'done': return 'done — vision met';
    case 'overtaken': return 'overtaken';
    default: return 'unclear';
  }
}

/** The same verdict where there is only room for a chip. Never truncated into nonsense. */
export function verdictChip(verdict: Verdict): string {
  return verdict === 'done' ? 'vision met' : verdictLabel(verdict);
}

/** The one line that says what a branch is for, however much is known. */
export function visionLine(branch: Branch): { text: string; proposed: boolean; known: boolean } {
  if (!branch.vision) return { text: 'nobody has said what this is for', proposed: false, known: false };
  return { text: branch.vision.text, proposed: branch.vision.state === 'proposed', known: true };
}

// ---------------------------------------------------------------------------
// The line — what "happening now" says (D91)
// ---------------------------------------------------------------------------

/**
 * One line, and as few words as are true.
 *
 * `Done.` on its own when it is done. Where something is left, or where the branch is one
 * piece of a larger job, that is said too — and nothing else ever is. The headline above
 * already says what the work IS, so this only says where it stands; saying both was the
 * bug the five labelled rows had.
 *
 * Derived rather than stored, because every part of it already exists: the verdict, the
 * recap's `next`, the branch's own quietness, and — for "3 left" — the goal it is filed
 * under. Nothing here is a fact the model was asked for twice.
 */
export type NowLine = {
  /** The first words, and the only coloured thing in the band. */
  lead: string;
  tone: 'done' | 'going' | 'left' | 'adrift' | 'quiet';
  /** What follows the lead, or '' when the lead is the whole truth. */
  rest: string;
  /** True when `rest` is the thing standing in the way, and should read as such. */
  restIsOpen: boolean;
  /** Set when nobody has said what the branch is for, so the band can offer to ask. */
  ask: boolean;
  /** True when `rest` names the goal, so the byline does not name it a second time. */
  namesGoal: boolean;
};

const isDone = (branch: Branch): boolean =>
  branch.assessment?.verdict === 'done' || branch.progress === 'done';

/**
 * Branches under the same goal that are still going. The count is COUNTED, never written:
 * a model asked "is this part of something bigger" will always find a way to say yes.
 */
export function siblingsLeft(snapshot: Snapshot, branch: Branch): number {
  if (!branch.goalId) return 0;
  return threads(snapshot).filter(
    (b) => b.goalId === branch.goalId && b !== branch && b.relevance === 'active' && !isDone(b),
  ).length;
}

export function nowLine(snapshot: Snapshot, branch: Branch, now = new Date()): NowLine {
  const next = branch.recap?.next ?? '';
  const ask = !branch.vision;

  // Drift first: a branch doing the wrong thing well is the most expensive thing on the
  // page, and it is only legible against what it was for.
  if (branch.assessment?.verdict === 'drifted') {
    return { lead: 'Not what it was for:', tone: 'adrift', rest: next, restIsOpen: true, ask: false, namesGoal: false };
  }

  if (isDone(branch)) {
    // "Done" keeps its meaning by naming the exception in the same breath.
    if (next) return { lead: 'Done,', tone: 'done', rest: `except ${next}`, restIsOpen: true, ask: false, namesGoal: false };
    const left = siblingsLeft(snapshot, branch);
    const goal = snapshot.goals.find((g) => g.id === branch.goalId);
    return left > 0 && goal
      ? { lead: 'Done.', tone: 'done', rest: `${left} left in ${goal.title}`, restIsOpen: false, ask: false, namesGoal: true }
      : { lead: 'Done.', tone: 'done', rest: '', restIsOpen: false, ask: false, namesGoal: false };
  }

  if (branch.relevance === 'quiet') {
    const days = daysSince(branch.lastActivity, now);
    const lead = days === null ? 'Quiet.' : `Quiet ${days} ${days === 1 ? 'day' : 'days'}.`;
    return { lead, tone: 'quiet', rest: next, restIsOpen: Boolean(next), ask, namesGoal: false };
  }

  if (next) return { lead: 'Left:', tone: 'left', rest: next, restIsOpen: true, ask: false, namesGoal: false };
  // Moving, with nothing identifiably open. One word — "still going" is not worth saying,
  // since a branch that is not done is of course going.
  return {
    lead: branch.progress === 'blocked' ? 'Blocked.' : 'Going.',
    tone: 'going', rest: '', restIsOpen: false, ask, namesGoal: false,
  };
}

const daysSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const ms = now.getTime() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
};

/**
 * The line trimmed to the owner's word budget (rule 7 — the number is a setting).
 *
 * Only `rest` is ever cut, and only at a word boundary: the lead is the part that carries
 * the state, so a line clipped to "Done," would be worse than one clipped to nothing. The
 * full text goes to the caller for the title attribute, so nothing is lost, only folded.
 */
export function trimTo(line: NowLine, words: number): { rest: string; clipped: boolean } {
  if (!line.rest) return { rest: '', clipped: false };
  const budget = words - countWords(line.lead);
  if (budget <= 0) return { rest: '', clipped: true };
  const parts = line.rest.split(/\s+/);
  if (parts.length <= budget) return { rest: line.rest, clipped: false };
  return { rest: `${parts.slice(0, budget).join(' ')}…`, clipped: true };
}

const countWords = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);
