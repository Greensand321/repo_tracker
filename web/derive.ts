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

import type { Branch, Goal, Snapshot } from '../shared/types.ts';

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
