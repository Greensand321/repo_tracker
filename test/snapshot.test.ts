import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activityDates,
  buildSnapshot,
  pickPull,
  toCiState,
  toCommit,
  toIsoUtc,
  type RepoBundle,
} from '../server/snapshot.ts';
import type { GhBranch, GhCi, GhCommit, GhPull, GhRepo } from '../server/gh-types.ts';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as T;

const NOW = new Date('2026-09-16T12:00:00Z');

function ghCommit(sha: string, message: string, date: string, name = 'claude'): GhCommit {
  return {
    sha,
    html_url: `https://github.com/o/r/commit/${sha}`,
    commit: { message, author: { name, date }, committer: { name, date } },
    author: { login: 'greensand321' },
  };
}

/** compare() returns commits oldest-first — the fixtures mirror that deliberately. */
function bundle(overrides: Partial<RepoBundle> = {}): RepoBundle {
  return {
    key: 'greensand321/harbor-api',
    repo: fixture<GhRepo>('repo'),
    branches: fixture<GhBranch[]>('branches'),
    pulls: fixture<GhPull[]>('pulls'),
    details: {
      'feat/stripe-webhook-retry': {
        compare: {
          ahead_by: 3,
          behind_by: 2,
          commits: [
            ghCommit('c1', 'Reproduce the duplicate retry', '2026-09-12T13:40:00Z'),
            ghCommit('c2', 'Signature verification landed', '2026-09-14T14:02:00Z'),
            ghCommit('c3', 'Write the failing idempotency test\n\nThe dedupe table comes next.', '2026-09-15T14:32:00Z'),
          ],
          files: [
            { additions: 40, deletions: 3 },
            { additions: 12, deletions: 0 },
          ],
        },
        ci: null,
      },
      'fix/auth-refresh': {
        compare: { ahead_by: 1, behind_by: 0, commits: [ghCommit('d1', 'Rotate the secret', '2026-09-10T11:00:00Z')], files: [] },
        ci: null,
      },
      'chore/old-experiment': {
        compare: { ahead_by: 1, behind_by: 40, commits: [ghCommit('e1', 'Spike', '2026-06-01T09:00:00Z')], files: [] },
        ci: null,
      },
      main: { compare: { ahead_by: 0, behind_by: 0, commits: [], files: [] }, ci: null },
    },
    ...overrides,
  };
}

const build = (b = bundle()) =>
  buildSnapshot([b], [], null, { now: NOW, quietAfterDays: 14, commitsPerBranch: 50 });

// --- the thing Stage 1 exists for --------------------------------------------

test('commits are the branch’s own, newest first, with the message as the headline', () => {
  const snap = build();
  const branch = snap.branches.find((b) => b.name === 'feat/stripe-webhook-retry')!;

  assert.deepEqual(
    branch.commits.map((c) => c.message),
    ['Write the failing idempotency test', 'Signature verification landed', 'Reproduce the duplicate retry'],
  );
  assert.equal(branch.commits[0]!.body, 'The dedupe table comes next.');
  assert.equal(branch.commits[0]!.author, 'claude');
});

test('a commit with no body has an empty body, not the subject repeated', () => {
  const commit = toCommit(ghCommit('x', 'Just a subject', '2026-09-01T00:00:00Z'));
  assert.equal(commit.message, 'Just a subject');
  assert.equal(commit.body, '');
});

test('commits are capped without disturbing the order', () => {
  const b = bundle();
  const snap = buildSnapshot([b], [], null, { now: NOW, quietAfterDays: 14, commitsPerBranch: 2 });
  const branch = snap.branches.find((x) => x.name === 'feat/stripe-webhook-retry')!;
  assert.equal(branch.commits.length, 2);
  assert.equal(branch.commits[0]!.message, 'Write the failing idempotency test');
});

// --- branch state -------------------------------------------------------------

test('ahead, behind and diff totals come through', () => {
  const branch = build().branches.find((b) => b.name === 'feat/stripe-webhook-retry')!;
  assert.equal(branch.ahead, 3);
  assert.equal(branch.behind, 2);
  assert.deepEqual(branch.diff, { files: 2, additions: 52, deletions: 3 });
});

test('last activity is the newest commit, and branches sort newest first', () => {
  const snap = build();
  assert.equal(snap.branches[0]!.name, 'feat/stripe-webhook-retry');
  assert.equal(snap.branches[0]!.lastActivity, '2026-09-15T14:32:00.000Z');
  assert.deepEqual(
    snap.branches.map((b) => b.name),
    [
      'feat/stripe-webhook-retry', // Sep 15
      'fix/auth-refresh', // Sep 10
      'chore/old-experiment', // Jun 1
      'main', // no commits of its own, so no date at all
    ],
  );
});

test('a branch with no date sinks to the bottom rather than floating to the top', () => {
  // `main` has nothing ahead of itself, so it has no activity date. Undated branches
  // must not sort as if they were brand new.
  const snap = build();
  const main = snap.branches.find((b) => b.name === 'main')!;
  assert.equal(main.lastActivity, null);
  assert.equal(snap.branches.at(-1)!.name, 'main');
});

test('a stale branch folds away as quiet but is still present in the data', () => {
  const snap = build();
  const old = snap.branches.find((b) => b.name === 'chore/old-experiment')!;
  assert.equal(old.relevance, 'quiet');
  assert.equal(old.commits.length, 1, 'quiet branches keep their history');
  assert.equal(snap.branches.length, 4, 'nothing is dropped');
});

test('the base branch is flagged rather than hidden', () => {
  const main = build().branches.find((b) => b.name === 'main')!;
  assert.equal(main.isBase, true);
});

test('a branch whose detail fetch failed still renders, just empty', () => {
  const b = bundle({ details: {} });
  const branch = build(b).branches.find((x) => x.name === 'fix/auth-refresh')!;
  assert.deepEqual(branch.commits, []);
  assert.equal(branch.ahead, 0);
  // It still has its PR, so it is still dateable.
  assert.equal(branch.lastActivity, '2026-09-10T12:00:00.000Z');
});

test('Stage 2 fields are null, so the UI must cope without them', () => {
  for (const branch of build().branches) {
    assert.equal(branch.title, null);
    assert.equal(branch.summary, null);
    assert.equal(branch.progress, null);
  }
});

// --- pull requests ------------------------------------------------------------

test('an open PR wins over an older closed one on the same branch', () => {
  const pr = pickPull(fixture<GhPull[]>('pulls'), 'feat/stripe-webhook-retry')!;
  assert.equal(pr.pr.number, 52);
  assert.equal(pr.pr.state, 'open');
});

test('a merged PR reports "merged", not "closed"', () => {
  const pr = pickPull(fixture<GhPull[]>('pulls'), 'fix/auth-refresh')!;
  assert.equal(pr.pr.state, 'merged');
});

test('a branch with no PR is not a failure', () => {
  assert.equal(pickPull(fixture<GhPull[]>('pulls'), 'chore/old-experiment'), null);
});

// --- CI ---------------------------------------------------------------------

/**
 * Fine-grained tokens cannot read check runs at all — GitHub withdrew that permission
 * and it is GitHub-App-only. These cover the two sources such a token CAN see.
 */
const actions = (...rs: NonNullable<GhCi['runs']>['workflow_runs']): GhCi => ({
  runs: { workflow_runs: rs },
  status: null,
});
const done = (conclusion: string) => ({ status: 'completed', conclusion, html_url: 'u' });

test('one failing Actions run makes the branch red, whatever else passed', () => {
  assert.equal(toCiState(actions(done('success'), done('failure'))).state, 'failing');
});

test('neutral and skipped runs do not turn a green branch red', () => {
  assert.equal(toCiState(actions(done('success'), done('neutral'), done('skipped'))).state, 'passing');
});

test('an unfinished Actions run reads as pending', () => {
  assert.equal(
    toCiState(actions(done('success'), { status: 'in_progress', conclusion: null, html_url: 'u' })).state,
    'pending',
  );
});

test('with no Actions runs it falls back to the commit-status API', () => {
  const viaStatus = (state: string): GhCi => ({
    runs: { workflow_runs: [] },
    status: { state, total_count: 1, statuses: [{ state, target_url: 'https://ci.example/1' }] },
  });
  assert.equal(toCiState(viaStatus('failure')).state, 'failing');
  assert.equal(toCiState(viaStatus('error')).state, 'failing');
  assert.equal(toCiState(viaStatus('pending')).state, 'pending');
  assert.equal(toCiState(viaStatus('success')).state, 'passing');
  assert.equal(toCiState(viaStatus('success')).url, 'https://ci.example/1');
});

test('no CI at all is "none", not a failure', () => {
  assert.equal(toCiState(null).state, 'none');
  assert.equal(toCiState({ runs: null, status: null }).state, 'none');
  assert.equal(toCiState({ runs: { workflow_runs: [] }, status: { state: 'pending', total_count: 0, statuses: [] } }).state, 'none');
});

test('a token without Actions or Commit statuses permission degrades to "none"', () => {
  // fetchCi returns nulls on 403 rather than throwing, so a missing permission costs
  // you the CI column and nothing else.
  assert.equal(toCiState({ runs: null, status: null }).state, 'none');
});

// --- normalisation -------------------------------------------------------------

test('timestamps from different offsets are comparable as UTC', () => {
  assert.equal(toIsoUtc('2026-09-13T11:42:07+02:00'), '2026-09-13T09:42:07.000Z');
  assert.equal(toIsoUtc('2026-09-13T02:42:07-07:00'), '2026-09-13T09:42:07.000Z');
});

test('a missing or unparseable date is empty, never NaN or a crash', () => {
  assert.equal(toIsoUtc(null), '');
  assert.equal(toIsoUtc('not a date'), '');
});

test('the activity strip lists distinct days, oldest first', () => {
  const commits = [
    { authoredAt: '2026-09-15T14:32:00.000Z' },
    { authoredAt: '2026-09-15T09:00:00.000Z' },
    { authoredAt: '2026-09-12T13:40:00.000Z' },
  ];
  assert.deepEqual(activityDates(commits as never), ['2026-09-12', '2026-09-15']);
});

// --- the snapshot as a whole ----------------------------------------------------

test('warnings survive into the snapshot instead of throwing', () => {
  const snap = buildSnapshot([bundle()], ['greensand321/gone: not found'], null, {
    now: NOW,
    quietAfterDays: 14,
    commitsPerBranch: 50,
  });
  assert.deepEqual(snap.warnings, ['greensand321/gone: not found']);
  assert.equal(snap.repos.length, 1);
  assert.equal(snap.repos[0]!.branchCount, 4);
});
