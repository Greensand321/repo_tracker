/**
 * How the advisor is shown the fleet: every goal, the most recent branches in full, and
 * every other branch as one line.
 *
 * Its own file because two things need it — the prompt, and the `branch` tool that shows
 * any one of the one-liners in full — and a tool importing the advisor would import
 * everything the advisor imports.
 *
 * **No branch is invisible** (audit finding 4). It used to show the sixty most recent and
 * say "thirty older ones omitted", so "organise everything" quietly left a third of the
 * register where it was. Now the cap decides which arrive in full, not which exist.
 */

import type { Branch, Goal, Snapshot } from '../../shared/types.ts';

export function describeGoal(goal: Goal): string {
  const bits = [`  "${goal.title}"`, `id ${goal.id}`, `${goal.branches.length} branches`];
  if (goal.milestone) bits.push(`milestone ${goal.milestone}`);
  if (goal.done) bits.push('marked done');
  if (goal.judgement) bits.push(`looks ${goal.judgement.state}: ${goal.judgement.because}`);
  if (goal.note) bits.push(`the owner's note: "${goal.note}"`);
  return bits.join(' · ');
}

/** One branch in full: what it is for, what it did, how the two compare, its last commits. */
export function describeBranch(branch: Branch, goal: Goal | null): string {
  const bits = [
    `- ${branch.repoKey} ${branch.name}`,
    `${branch.ahead} ahead / ${branch.behind} behind`,
    branch.lastActivity ? `last commit ${branch.lastActivity.slice(0, 10)}` : 'no commits of its own',
  ];
  if (branch.relevance === 'quiet') bits.push('gone quiet');
  if (branch.ci.state !== 'none') bits.push(`CI ${branch.ci.state}`);
  if (branch.pr) bits.push(`PR #${branch.pr.number} ${branch.pr.state}${branch.pr.draft ? ' draft' : ''}`);
  bits.push(goal ? `goal "${goal.title}"` : 'unfiled');

  const out = [bits.join(' · ')];
  // The vision and the verdict are what "does this matter" and "where does this belong"
  // actually turn on — a ranking or a regrouping drawn from commit subjects alone would be
  // the advisor guessing at what the owner has already written down.
  if (branch.vision) {
    const whose = branch.vision.state === 'proposed' ? ' (a guess — not confirmed)' : " (the owner's words)";
    out.push(`    FOR: ${branch.vision.text}${whose}`);
  }
  if (branch.title) out.push(`    TITLE: ${branch.title}`);
  if (branch.recap) {
    out.push(`    LAST: ${branch.recap.last}`);
    if (branch.recap.done) out.push(`    DONE: ${branch.recap.done}`);
    if (branch.recap.next) out.push(`    LEFT: ${branch.recap.next}`);
  } else if (branch.summary) {
    out.push(`    DID: ${branch.summary}`);
  }
  if (branch.assessment) out.push(`    COMPARED: ${branch.assessment.verdict} — ${branch.assessment.because}`);
  // Three messages is enough to tell what a branch is doing without paying for fifty.
  for (const commit of branch.commits.slice(0, 3)) out.push(`    commit: ${commit.message}`);
  return out.join('\n');
}

/**
 * One branch in one line: enough to file it, rank it or ask about it by name. What it is
 * in a few words, where it stands, where it is filed, how old. The `branch` tool gives the
 * rest.
 */
export function indexLine(branch: Branch, goal: Goal | null): string {
  const what = branch.title ?? branch.commits[0]?.message ?? 'nothing of its own';
  const stands =
    branch.assessment?.verdict === 'drifted' ? 'drifted'
    : branch.assessment?.verdict === 'done' || branch.progress === 'done' ? 'done'
    : branch.recap?.next ? `left: ${branch.recap.next}`
    : branch.ci.state === 'failing' ? 'CI red'
    : branch.relevance === 'quiet' ? 'quiet'
    : (branch.progress ?? 'unread');
  const bits = [`- ${branch.repoKey} ${branch.name}`, clip(what, 70), stands, goal ? `goal "${goal.title}"` : 'unfiled'];
  if (branch.pr) bits.push(`PR ${branch.pr.state}`);
  if (branch.lastActivity) bits.push(branch.lastActivity.slice(0, 10));
  return bits.join(' · ');
}

/** The register, newest first: `cap` in full, the rest one line each. */
export function register(snapshot: Snapshot, cap: number): { full: string[]; index: string[]; total: number } {
  const goalOf = new Map(snapshot.goals.map((g) => [g.id, g] as const));
  const threads = snapshot.branches
    .filter((b) => !b.isBase)
    .sort((a, b) => Date.parse(b.lastActivity ?? '') - Date.parse(a.lastActivity ?? ''));
  const goal = (b: Branch): Goal | null => goalOf.get(b.goalId ?? '') ?? null;
  const keep = Math.max(0, cap);
  return {
    full: threads.slice(0, keep).map((b) => describeBranch(b, goal(b))),
    index: threads.slice(keep).map((b) => indexLine(b, goal(b))),
    total: threads.length,
  };
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
