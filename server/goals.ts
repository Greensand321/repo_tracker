/**
 * Goals — Plane B.
 *
 * A goal is one thread of intent, grouping the branches working toward it. This is the
 * tool's own data: it is written freely, it lives in `data/goals.json`, and it is never
 * written into a git repo (CLAUDE.md rule 1).
 *
 * The store is deliberately dumb — read the file, mutate, write the file. There are
 * dozens of goals, not thousands, and a single-user local tool that loses data to a
 * clever caching scheme would be a poor trade. The one thing it does carefully is
 * enforce the invariant the UI depends on: **a branch belongs to at most one goal**.
 * Assigning a branch that already has a goal moves it rather than duplicating it.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { refKey, type BranchRef, type Goal, type Snapshot } from '../shared/types.ts';
import { DATA_DIR, ensureDirs } from './paths.ts';

const FILE = join(DATA_DIR, 'goals.json');

type GoalFile = { goals: Goal[] };

let cache: Goal[] | null = null;

function load(): Goal[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as GoalFile;
    cache = Array.isArray(parsed.goals) ? parsed.goals.map(normalise) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** A hand-edited or older file must not be able to crash the page. */
function normalise(raw: Partial<Goal>): Goal {
  const now = new Date().toISOString();
  return {
    id: String(raw.id ?? randomUUID()),
    title: String(raw.title ?? 'Untitled goal'),
    note: String(raw.note ?? ''),
    milestone: String(raw.milestone ?? ''),
    branches: Array.isArray(raw.branches)
      ? raw.branches
          .filter((b): b is BranchRef => !!b && typeof b.repoKey === 'string' && typeof b.branch === 'string')
          .map((b) => ({ repoKey: b.repoKey, branch: b.branch }))
      : [],
    done: raw.done === true,
    // Written by the assistant's fleet pass, not stored here — see advise/assist.ts.
    judgement: null,
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  };
}

function persist(goals: Goal[]): Goal[] {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify({ goals }, null, 2), 'utf8');
  cache = goals;
  return goals;
}

export function listGoals(): Goal[] {
  return load().map((g) => ({ ...g, branches: [...g.branches] }));
}

export function createGoal(input: { title: string; note?: string; milestone?: string }): Goal {
  const title = input.title.trim();
  if (!title) throw new GoalError('a goal needs a title');
  const now = new Date().toISOString();
  const goal: Goal = {
    id: randomUUID(),
    title,
    note: (input.note ?? '').trim(),
    milestone: (input.milestone ?? '').trim(),
    branches: [],
    done: false,
    judgement: null,
    createdAt: now,
    updatedAt: now,
  };
  persist([...load(), goal]);
  return goal;
}

export function updateGoal(
  id: string,
  patch: { title?: string; note?: string; milestone?: string; done?: boolean },
): Goal {
  const goals = load();
  const goal = goals.find((g) => g.id === id);
  if (!goal) throw new GoalError(`no goal ${id}`);

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new GoalError('a goal needs a title');
    goal.title = title;
  }
  if (patch.note !== undefined) goal.note = patch.note.trim();
  if (patch.milestone !== undefined) goal.milestone = patch.milestone.trim();
  if (patch.done !== undefined) goal.done = patch.done;
  goal.updatedAt = new Date().toISOString();

  persist(goals);
  return goal;
}

/**
 * Deleting a goal never touches the branches it held — they simply become unfiled
 * again. Branches are Plane A and are not ours to lose.
 */
export function deleteGoal(id: string): void {
  const goals = load();
  if (!goals.some((g) => g.id === id)) throw new GoalError(`no goal ${id}`);
  persist(goals.filter((g) => g.id !== id));
}

/**
 * Puts a branch in a goal, removing it from whichever goal held it before. Passing a
 * null goal unfiles it. Idempotent: assigning where it already is changes nothing.
 */
export function assignBranch(ref: BranchRef, goalId: string | null): Goal[] {
  const goals = load();
  if (goalId !== null && !goals.some((g) => g.id === goalId)) throw new GoalError(`no goal ${goalId}`);

  const key = refKey(ref.repoKey, ref.branch);
  const now = new Date().toISOString();
  let changed = false;

  for (const goal of goals) {
    const before = goal.branches.length;
    goal.branches = goal.branches.filter((b) => refKey(b.repoKey, b.branch) !== key);
    if (goal.branches.length !== before) {
      goal.updatedAt = now;
      changed = true;
    }
  }

  if (goalId !== null) {
    const target = goals.find((g) => g.id === goalId)!;
    target.branches.push({ repoKey: ref.repoKey, branch: ref.branch });
    target.updatedAt = now;
    changed = true;
  }

  if (changed) persist(goals);
  return goals;
}

// ---------------------------------------------------------------------------
// Merging Plane B into the snapshot
// ---------------------------------------------------------------------------

/**
 * Attaches goals to a freshly collected snapshot. Called at the edge, beside
 * `applyCached`, so `buildSnapshot` stays a pure transform of GitHub data and no view
 * ever has to join two sources itself (rule 4, rule 5).
 *
 * Mutates in place, like the rest of the edge does, and is free: no network, no model.
 */
export function applyGoals(snapshot: Snapshot, goals: Goal[] = listGoals()): void {
  const owner = new Map<string, string>();
  for (const goal of goals) {
    for (const ref of goal.branches) owner.set(refKey(ref.repoKey, ref.branch), goal.id);
  }
  for (const branch of snapshot.branches) {
    branch.goalId = owner.get(refKey(branch.repoKey, branch.name)) ?? null;
  }
  snapshot.goals = goals;
}

/**
 * Drops assignments for branches that no longer exist, so a deleted branch does not sit
 * in a goal forever counting toward its progress. The goal itself is kept — it is the
 * owner's, not GitHub's.
 */
export function pruneGoals(liveKeys: Set<string>): number {
  const goals = load();
  let removed = 0;
  for (const goal of goals) {
    const before = goal.branches.length;
    goal.branches = goal.branches.filter((b) => liveKeys.has(refKey(b.repoKey, b.branch)));
    removed += before - goal.branches.length;
  }
  if (removed > 0) persist(goals);
  return removed;
}

/** Tests and the debug CLI need a fresh file rather than a warm module. */
export function resetGoalCache(): void {
  cache = null;
}

export class GoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalError';
  }
}
