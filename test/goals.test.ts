/**
 * Goals — Plane B.
 *
 * The invariant worth testing is the one the whole interface leans on: a branch belongs
 * to at most one goal. Everything else here is about not losing the owner's data — a
 * deleted goal must not take branches with it, and a deleted branch must not take its
 * goal with it.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Safe as a static import: types.ts has no side effects and never reads paths.ts.
import { refKey, type Snapshot } from '../shared/types.ts';

// This must be set before goals.ts loads paths.ts, or the real data/ directory is used.
const dir = mkdtempSync(join(tmpdir(), 'bearing-goals-'));
process.env['BEARING_DATA_DIR'] = dir;

const goals = await import('../server/goals.ts');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function fresh(): void {
  for (const g of goals.listGoals()) goals.deleteGoal(g.id);
  goals.resetGoalCache();
}

const ref = (branch: string, repoKey = 'greensand321/repo_tracker') => ({ repoKey, branch });

function snapshotOf(...branchNames: string[]): Snapshot {
  return {
    generatedAt: '2026-09-17T13:42:08Z',
    repos: [],
    warnings: [],
    rateLimit: null,
    goals: [],
    brief: null,
    work: { jobs: [], workers: 2, finished: [] },
    llm: { enabled: false, pending: 0, errors: [] },
    branches: branchNames.map((name) => ({
      repoKey: 'greensand321/repo_tracker',
      name,
      headSha: 'aaaaaaa',
      url: '',
      commits: [],
      ahead: 0,
      behind: 0,
      lastActivity: null,
      diff: { files: 0, additions: 0, deletions: 0 },
      activity: [],
      pr: null,
      ci: { state: 'none', url: null },
      relevance: 'active',
      isBase: false,
      goalId: null,
      vision: null,
      assessment: null,
      title: null,
      summary: null,
      progress: null,
      insight: null,
    })),
  };
}

test('a goal is created with a title and starts empty', () => {
  fresh();
  const goal = goals.createGoal({ title: '  Ship the ledger interface  ' });
  assert.equal(goal.title, 'Ship the ledger interface', 'the title is trimmed');
  assert.deepEqual(goal.branches, []);
  assert.equal(goal.done, false);
  assert.equal(goals.listGoals().length, 1);
});

test('a goal without a title is refused rather than stored as "undefined"', () => {
  fresh();
  assert.throws(() => goals.createGoal({ title: '   ' }), /needs a title/);
  assert.equal(goals.listGoals().length, 0);
});

test('a branch belongs to at most one goal — assigning again moves it', () => {
  fresh();
  const a = goals.createGoal({ title: 'A' });
  const b = goals.createGoal({ title: 'B' });

  goals.assignBranch(ref('claude/kind-meitner-cpis9v'), a.id);
  goals.assignBranch(ref('claude/kind-meitner-cpis9v'), b.id);

  const after = goals.listGoals();
  assert.deepEqual(after.find((g) => g.id === a.id)!.branches, [], 'left the first goal');
  assert.equal(after.find((g) => g.id === b.id)!.branches.length, 1, 'joined the second');
});

test('assigning the same branch to the same goal twice does not duplicate it', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);
  goals.assignBranch(ref('gui-updates'), goal.id);
  assert.equal(goals.listGoals()[0]!.branches.length, 1);
});

test('the same branch name in two repos is two different branches', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('main', 'greensand321/repo_tracker'), goal.id);
  goals.assignBranch(ref('main', 'greensand321/Project_Management'), goal.id);
  assert.equal(goals.listGoals()[0]!.branches.length, 2);
});

test('a null goal unfiles the branch without touching the goals', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);
  goals.assignBranch(ref('gui-updates'), null);
  assert.equal(goals.listGoals().length, 1, 'the goal survives');
  assert.deepEqual(goals.listGoals()[0]!.branches, []);
});

test('deleting a goal unfiles its branches and leaves them alone', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);
  goals.deleteGoal(goal.id);

  const snapshot = snapshotOf('gui-updates');
  goals.applyGoals(snapshot);
  assert.equal(snapshot.branches[0]!.goalId, null);
  assert.deepEqual(snapshot.goals, []);
});

test('assigning to a goal that does not exist is refused', () => {
  fresh();
  assert.throws(() => goals.assignBranch(ref('x'), 'not-a-goal'), /no goal/);
});

test('applyGoals attaches the goal id to each branch, and nothing to the unfiled', () => {
  fresh();
  const goal = goals.createGoal({ title: 'The interface' });
  goals.assignBranch(ref('claude/kind-meitner-cpis9v'), goal.id);

  const snapshot = snapshotOf('claude/kind-meitner-cpis9v', 'gui-updates');
  goals.applyGoals(snapshot);

  assert.equal(snapshot.branches[0]!.goalId, goal.id);
  assert.equal(snapshot.branches[1]!.goalId, null, 'unfiled is normal, not an error');
  assert.equal(snapshot.goals.length, 1, 'the snapshot carries the goals themselves');
});

test('applyGoals is idempotent — re-running clears a stale id', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);

  const snapshot = snapshotOf('gui-updates');
  goals.applyGoals(snapshot);
  assert.equal(snapshot.branches[0]!.goalId, goal.id);

  goals.assignBranch(ref('gui-updates'), null);
  goals.applyGoals(snapshot);
  assert.equal(snapshot.branches[0]!.goalId, null);
});

test('pruning drops assignments for branches that are gone, and keeps the goal', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('still-here'), goal.id);
  goals.assignBranch(ref('deleted-upstream'), goal.id);

  const removed = goals.pruneGoals(new Set([refKey('greensand321/repo_tracker', 'still-here')]));

  assert.equal(removed, 1);
  const after = goals.listGoals();
  assert.equal(after.length, 1, 'the goal is the owner\'s, not GitHub\'s');
  assert.deepEqual(after[0]!.branches.map((b) => b.branch), ['still-here']);
});

test('pruning nothing writes nothing', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('still-here'), goal.id);
  const before = goals.listGoals()[0]!.updatedAt;
  assert.equal(goals.pruneGoals(new Set([refKey('greensand321/repo_tracker', 'still-here')])), 0);
  assert.equal(goals.listGoals()[0]!.updatedAt, before);
});

test('a goal can be renamed, noted, and marked done without losing its branches', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);

  const updated = goals.updateGoal(goal.id, { title: 'B', note: '  the real reason  ', done: true });

  assert.equal(updated.title, 'B');
  assert.equal(updated.note, 'the real reason');
  assert.equal(updated.done, true);
  assert.equal(updated.branches.length, 1);
});

test('renaming to nothing is refused rather than blanking the goal', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  assert.throws(() => goals.updateGoal(goal.id, { title: '  ' }), /needs a title/);
  assert.equal(goals.listGoals()[0]!.title, 'A');
});

test('goals survive a reload from disk', () => {
  fresh();
  const goal = goals.createGoal({ title: 'Ship it', note: 'before Friday' });
  goals.assignBranch(ref('claude/kind-meitner-cpis9v'), goal.id);

  goals.resetGoalCache();

  const [reloaded] = goals.listGoals();
  assert.equal(reloaded!.title, 'Ship it');
  assert.equal(reloaded!.note, 'before Friday');
  assert.deepEqual(reloaded!.branches, [ref('claude/kind-meitner-cpis9v')]);
});

test('listGoals hands out copies — a caller cannot mutate the store by accident', () => {
  fresh();
  const goal = goals.createGoal({ title: 'A' });
  goals.assignBranch(ref('gui-updates'), goal.id);

  goals.listGoals()[0]!.branches.push(ref('smuggled-in'));

  assert.equal(goals.listGoals()[0]!.branches.length, 1);
});
