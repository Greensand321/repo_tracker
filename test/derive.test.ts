/**
 * The projections every surface shares (web/derive.ts).
 *
 * These are the only place a view is allowed to reshape the Snapshot, so the orderings
 * they promise are worth pinning down — particularly that an empty goal survives, and
 * that unfiled branches are treated as normal rather than as a backlog at the top.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Branch, Goal, Snapshot } from '../shared/types.ts';
import { dotClass, glyph, groupByGoal, headline, matches, nowThread, tallies, threads } from '../web/derive.ts';

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'greensand321/repo_tracker',
    name,
    headSha: 'aaaaaaa',
    url: '',
    commits: [],
    ahead: 1,
    behind: 0,
    lastActivity: '2026-09-17T10:00:00Z',
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
    ...over,
  };
}

function goal(id: string, over: Partial<Goal> = {}): Goal {
  return {
    id,
    title: id,
    note: '',
    milestone: '',
    branches: [],
    done: false,
    judgement: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function snap(branches: Branch[], goals: Goal[] = [], over: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: '2026-09-17T13:42:08Z',
    repos: [
      { key: 'greensand321/repo_tracker', owner: 'greensand321', name: 'repo_tracker', defaultBranch: 'main', branchCount: 20, url: '' },
    ],
    branches,
    goals,
    warnings: [],
    rateLimit: null,
    brief: null,
    llm: { enabled: false, pending: 0, errors: [] },
    ...over,
  };
}

test('the base branch is a reference point, not a thread', () => {
  const s = snap([branch('main', { isBase: true }), branch('feature')]);
  assert.deepEqual(threads(s).map((b) => b.name), ['feature']);
});

test('the now thread is the most recently touched branch that is still moving', () => {
  const s = snap([
    branch('older', { lastActivity: '2026-09-17T09:00:00Z' }),
    branch('newest', { lastActivity: '2026-09-17T12:00:00Z' }),
    branch('newest-but-quiet', { lastActivity: '2026-09-17T13:00:00Z', relevance: 'quiet' }),
  ]);
  assert.equal(nowThread(s)?.name, 'newest');
});

test('everything quiet is a real state, not an error', () => {
  const s = snap([branch('a', { relevance: 'quiet' })]);
  assert.equal(nowThread(s), null);
});

test('the base branch never becomes the now thread', () => {
  const s = snap([branch('main', { isBase: true, lastActivity: '2026-09-17T13:00:00Z' })]);
  assert.equal(nowThread(s), null);
});

test('branches group under their goal, with the unfiled last', () => {
  const s = snap(
    [branch('filed', { goalId: 'g1' }), branch('loose')],
    [goal('g1', { title: 'Ship it' })],
  );
  const groups = groupByGoal(s);
  assert.deepEqual(groups.map((g) => g.goal?.title ?? null), ['Ship it', null]);
  assert.deepEqual(groups[0]!.branches.map((b) => b.name), ['filed']);
  assert.deepEqual(groups[1]!.branches.map((b) => b.name), ['loose']);
});

test('an empty goal survives — you file a goal before the work exists', () => {
  const s = snap([branch('loose')], [goal('g1', { title: 'Not started' })]);
  const groups = groupByGoal(s);
  assert.equal(groups[0]!.goal?.title, 'Not started');
  assert.deepEqual(groups[0]!.branches, []);
});

test('a goal id pointing at a goal that is gone falls back to unfiled, not to nothing', () => {
  const s = snap([branch('orphan', { goalId: 'deleted' })], []);
  const groups = groupByGoal(s);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.goal, null);
  assert.deepEqual(groups[0]!.branches.map((b) => b.name), ['orphan']);
});

test('live goals sort by their most recent branch; done goals sink', () => {
  const s = snap(
    [
      branch('a', { goalId: 'old', lastActivity: '2026-09-10T00:00:00Z' }),
      branch('b', { goalId: 'fresh', lastActivity: '2026-09-17T00:00:00Z' }),
      branch('c', { goalId: 'finished', lastActivity: '2026-09-17T12:00:00Z' }),
    ],
    [goal('old'), goal('fresh'), goal('finished', { done: true })],
  );
  assert.deepEqual(groupByGoal(s).map((g) => g.goal?.id), ['fresh', 'old', 'finished']);
});

test('a goal with no branches sorts after goals that have them', () => {
  const s = snap([branch('a', { goalId: 'busy' })], [goal('empty'), goal('busy')]);
  assert.deepEqual(groupByGoal(s).map((g) => g.goal?.id), ['busy', 'empty']);
});

test('grouping respects a filtered list rather than re-reading every branch', () => {
  const s = snap([branch('keep', { goalId: 'g1' }), branch('drop', { goalId: 'g1' })], [goal('g1')]);
  const groups = groupByGoal(s, [s.branches[0]!]);
  assert.deepEqual(groups[0]!.branches.map((b) => b.name), ['keep']);
});

test('red CI wins the glyph, whatever the advisor thinks the progress is', () => {
  assert.equal(glyph(branch('a', { progress: 'progressing', ci: { state: 'failing', url: null } })), '⚑');
  assert.equal(glyph(branch('a', { progress: 'done' })), '✦');
  assert.equal(glyph(branch('a', { progress: 'stalled' })), '⚓');
  assert.equal(glyph(branch('a', { relevance: 'quiet' })), '⚓');
  assert.equal(glyph(branch('a')), '·');
});

test('the register dot agrees with the glyph about what is wrong', () => {
  assert.equal(dotClass(branch('a', { ci: { state: 'failing', url: null } })), 'blocked');
  assert.equal(dotClass(branch('a', { progress: 'done' })), 'done');
  assert.equal(dotClass(branch('a', { relevance: 'quiet' })), 'quiet');
  assert.equal(dotClass(branch('a')), 'active');
});

test('the headline is the advisor title when there is one, and says so', () => {
  const withTitle = headline(branch('a', { title: 'The token refresh thing' }));
  assert.deepEqual(withTitle, { text: 'The token refresh thing', generated: true });
});

test('with no title the headline is the newest commit, marked as not generated', () => {
  const b = branch('a', {
    commits: [
      { sha: 'x', message: 'fix the verifier', body: '', author: 'claude', authoredAt: '', url: '' },
      { sha: 'y', message: 'older', body: '', author: 'claude', authoredAt: '', url: '' },
    ],
  });
  assert.deepEqual(headline(b), { text: 'fix the verifier', generated: false });
});

test('a branch with nothing of its own still gets a headline rather than a blank', () => {
  assert.equal(headline(branch('a')).text, 'Nothing of its own yet');
});

test('search matches the literal branch name, which is the promise rule 6 makes', () => {
  const b = branch('claude/kind-meitner-cpis9v', { title: 'Something else entirely' });
  assert.equal(matches(b, 'meitner'), true);
  assert.equal(matches(b, 'CLAUDE/KIND'), true, 'case does not matter');
  assert.equal(matches(b, 'nothing like it'), false);
});

test('search also reaches the title, the summary, the PR and the commit messages', () => {
  const b = branch('x', {
    title: 'The advisor engine',
    summary: 'stuck on a provider gate',
    pr: { number: 7, title: 'Stage 2', state: 'open', draft: false, url: '' },
    commits: [{ sha: 'a', message: 'send the session header', body: '', author: 'c', authoredAt: '', url: '' }],
  });
  for (const needle of ['advisor', 'provider gate', 'Stage 2', 'session header']) {
    assert.equal(matches(b, needle), true, needle);
  }
});

test('an empty search matches everything', () => {
  assert.equal(matches(branch('a'), '   '), true);
});

test('tallies count what the conditions panel claims', () => {
  const s = snap(
    [
      branch('main', { isBase: true }),
      branch('a', { ci: { state: 'failing', url: null }, goalId: 'g1' }),
      branch('b', { pr: { number: 1, title: '', state: 'open', draft: false, url: '' } }),
      branch('c', { relevance: 'quiet' }),
    ],
    [goal('g1'), goal('g2', { done: true })],
  );
  const t = tallies(s);
  assert.equal(t.branches, 3, 'the base branch is not a thread');
  assert.equal(t.active, 2);
  assert.equal(t.quiet, 1);
  assert.equal(t.failing, 1);
  assert.equal(t.openPrs, 1);
  assert.equal(t.unfiled, 2);
  assert.equal(t.goals, 1, 'goals marked done are not "in play"');
});

test('folded counts the branches GitHub has that this read is not carrying', () => {
  // The repo reports 20 branches; the snapshot carries 2.
  const t = tallies(snap([branch('a'), branch('b')]));
  assert.equal(t.folded, 18);
});

test('folded never goes negative when a repo shrinks between reads', () => {
  const s = snap([branch('a'), branch('b'), branch('c')]);
  s.repos[0]!.branchCount = 1;
  assert.equal(tallies(s).folded, 0);
});

test('nothing is awaiting a summary when the advisor is off', () => {
  const s = snap([branch('a')], [], { llm: { enabled: false, pending: 7, errors: [] } });
  assert.equal(tallies(s).awaitingSummary, 0);
});
