/**
 * The board and the dispatcher.
 *
 * What is being protected here is not "does the summariser work" — it is the three things
 * the workroom rests on (docs/plans/workroom.md):
 *
 *   done is *checked* against the snapshot, never taken on the worker's word (D69);
 *   a job that fails twice parks instead of repeating forever (D69);
 *   a job whose predicate can never become true is a job that runs forever (D70).
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

// The stores write to disk, so point them somewhere disposable before anything imports them.
const TEMP = mkdtempSync(join(tmpdir(), 'bearing-test-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let enrich: typeof import('../server/advise/enrich.ts');
let store: typeof import('../server/advise/store.ts');
let vision: typeof import('../server/vision.ts');
let assist: typeof import('../server/advise/assist.ts');
let work: typeof import('../server/work/run.ts');
let board: typeof import('../server/work/board.ts');

before(async () => {
  enrich = await import('../server/advise/enrich.ts');
  store = await import('../server/advise/store.ts');
  vision = await import('../server/vision.ts');
  assist = await import('../server/advise/assist.ts');
  work = await import('../server/work/run.ts');
  board = await import('../server/work/board.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const file of ['insights.json', 'visions.json', 'assist.json']) {
    rmSync(join(TEMP, file), { force: true });
  }
  store.resetInsightCache();
  vision.resetVisionCache();
  assist.resetAssistCache();
  work.resetBoardState();
});

/** Only the summarise station unless a test says otherwise; each is tested on its own. */
const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh',
  repos: ['o/r'],
  llmApiKey: 'key',
  llmModel: 'test-model',
  visionAutoDraft: false,
  ...over,
});

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'claude', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    ahead: 3, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null, vision: null, assessment: null,
    title: null, summary: null, progress: null, insight: null, ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-16T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [], brief: null,
  work: { jobs: [], workers: 2 },
  llm: { enabled: false, pending: 0, errors: [] },
});

/**
 * A provider that answers every call the same way, and remembers what it was asked.
 *
 * `summarised` counts only the summarise station: an empty board derives the brief as
 * well, which is correct behaviour and would otherwise make every count here ambiguous.
 */
function stubProvider(reply: unknown, status = 200): { calls: number; bodies: string[]; summarised: () => number } {
  const state = {
    calls: 0,
    bodies: [] as string[],
    summarised: () => state.bodies.filter((b) => !b.includes('You are a personal assistant')).length,
  };
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    state.calls++;
    state.bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return state;
}

const insight = (over: Record<string, unknown> = {}) => ({
  choices: [{ message: { content: JSON.stringify({
    title: 'A real title', summary: 'It does a thing.', progress: 'progressing', evidence: ['abc1234'], ...over,
  }) } }],
});

// ---------------------------------------------------------------------------
// The summarise station, which is also the dispatcher's happy path
// ---------------------------------------------------------------------------

test('summaries land on the branches and are cached for next time', async () => {
  const snap = snapshot([branch('a'), branch('b')]);
  const calls = stubProvider(insight());

  enrich.applyCached(snap, settings());
  assert.equal(snap.llm.pending, 2);

  const result = await work.runBoard(snap, settings());
  assert.equal(result.byKind.summarise, 2);
  assert.equal(calls.summarised(), 2);
  assert.equal(snap.branches[0]!.title, 'A real title');
  assert.equal(snap.branches[0]!.progress, 'progressing');

  // A second snapshot at the same head SHAs must cost nothing.
  const again = snapshot([branch('a'), branch('b')]);
  enrich.applyCached(again, settings());
  assert.equal(again.llm.pending, 0, 'cached summaries should apply for free');
  assert.equal(again.branches[0]!.summary, 'It does a thing.');
  const after = await work.runBoard(again, settings());
  assert.equal(after.byKind.summarise, undefined, 'nothing to summarise');
  assert.equal(calls.summarised(), 2, 'no further summarise calls');
});

test('a branch that moved is re-summarised', async () => {
  const first = snapshot([branch('a')]);
  const calls = stubProvider(insight());
  enrich.applyCached(first, settings());
  await work.runBoard(first, settings());

  const moved = snapshot([branch('a', { headSha: 'sha-a-moved' })]);
  enrich.applyCached(moved, settings());
  assert.equal(moved.llm.pending, 1, 'the cached summary describes the old head');
  await work.runBoard(moved, settings());
  assert.equal(calls.summarised(), 2);
});

test('the base branch and empty branches are never sent to the model', async () => {
  const snap = snapshot([
    branch('main', { isBase: true }),
    branch('empty', { commits: [] }),
    branch('real'),
  ]);
  const calls = stubProvider(insight());

  enrich.applyCached(snap, settings());
  assert.equal(snap.llm.pending, 1);
  await work.runBoard(snap, settings());
  assert.equal(calls.summarised(), 1, 'only the branch with commits of its own');
});

test('llmMaxPerRun caps the whole read, across every station', async () => {
  const snap = snapshot(Array.from({ length: 10 }, (_, i) => branch(`b${i}`)));
  const calls = stubProvider(insight());

  enrich.applyCached(snap, settings());
  const result = await work.runBoard(snap, settings({ llmMaxPerRun: 3 }));
  assert.equal(calls.calls, 3);
  assert.equal(result.budgetSpent, true);
});

test('with no key or no model the board is empty rather than broken', async () => {
  for (const missing of [{ llmApiKey: '' }, { llmModel: '' }, { llmEnabled: false }]) {
    const snap = snapshot([branch('a')]);
    const calls = stubProvider(insight());
    const config = settings(missing);

    assert.equal(enrich.llmReady(config), false);
    enrich.applyCached(snap, config);
    assert.equal(snap.llm.enabled, false);
    assert.equal(board.deriveBoard(snap, config).length, 0);

    const result = await work.runBoard(snap, config);
    assert.equal(result.done, 0);
    assert.equal(calls.calls, 0, 'no provider call without full configuration');
  }
});

// ---------------------------------------------------------------------------
// Failure, and the two things that must never happen: silence, and forever
// ---------------------------------------------------------------------------

test('a rejected API key stops the run instead of failing 50 times', async () => {
  const snap = snapshot(Array.from({ length: 50 }, (_, i) => branch(`b${i}`)));
  const calls = stubProvider({ error: { message: 'bad key' } }, 401);

  enrich.applyCached(snap, settings());
  const result = await work.runBoard(snap, settings());

  assert.ok(calls.calls < 5, `should have stopped early, made ${calls.calls} calls`);
  assert.equal(result.done, 0);
  assert.ok(result.errors.some((e: string) => /will repeat/.test(e)));
});

test('a job that fails twice parks; it is not tried a third time', async () => {
  // Unparseable every time — a model that will not answer in the agreed shape.
  const calls = stubProvider({ choices: [{ message: { content: 'I cannot help with that' } }] });

  // One attempt per read: a provider that just failed will fail again this second, and a
  // minute is a better wait than none. The second read is the retry.
  const first = snapshot([branch('a')]);
  enrich.applyCached(first, settings());
  const one = await work.runBoard(first, settings());
  assert.equal(calls.calls, 1);
  assert.equal(one.parked, 0, 'once is not a verdict');

  const second = snapshot([branch('a')]);
  enrich.applyCached(second, settings());
  const two = await work.runBoard(second, settings());
  assert.equal(calls.calls, 2, 'tried once, retried once');
  assert.equal(two.parked, 1);
  assert.equal(second.work.jobs.filter((j) => j.state === 'parked').length, 1);
  assert.ok(second.work.jobs[0]!.error, 'the parked job carries what went wrong');

  // And no later read quietly starts it over while the branch sits at the same head.
  const third = snapshot([branch('a')]);
  enrich.applyCached(third, settings());
  await work.runBoard(third, settings());
  assert.equal(calls.calls, 2, 'still parked at the same head');
});

test('one failing branch does not stop the others', async () => {
  const snap = snapshot([branch('a'), branch('b')]);
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const bad = String(init.body).includes('work on a');
    const content = bad ? 'nope' : JSON.stringify({ title: 'Fine', summary: 'Fine.', progress: 'done', evidence: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  enrich.applyCached(snap, settings());
  const result = await work.runBoard(snap, settings());
  assert.equal(result.done, 1);
  assert.equal(result.parked, 1);
});

test('done is checked against the snapshot, not taken on the worker\'s word', async () => {
  const snap = snapshot([branch('a')]);
  const calls = stubProvider(insight());
  let ran = 0;

  // A job that returns happily and writes nothing. The dispatcher must not believe it.
  const liar = () => [{
    id: 'liar:1', kind: 'summarise' as const, title: 'Pretending to work',
    subject: { kind: 'branch' as const, repoKey: 'o/r', branch: 'a' },
    origin: 'routine' as const, state: 'waiting' as const, startedAt: null, attempts: 0, error: null,
    run: async () => { ran++; },
    doneWhen: () => false,
  }];

  const first = await work.runBoard(snap, settings(), undefined, liar);
  assert.equal(first.done, 0, 'it claimed done and produced nothing');
  assert.equal(first.claimedButNotDone, 1, 'counted, every time it happens');

  const second = await work.runBoard(snap, settings(), undefined, liar);
  assert.equal(second.claimedButNotDone, 1);
  assert.equal(second.parked, 1);
  assert.equal(ran, 2, 'tried twice, then parked — never forever');

  const third = await work.runBoard(snap, settings(), undefined, liar);
  assert.equal(ran, 2, 'and not a third time');
  assert.equal(third.claimedButNotDone, 0);
  assert.equal(calls.calls, 0);
});

// ---------------------------------------------------------------------------
// D70 — the job that would have run forever
// ---------------------------------------------------------------------------

test('a declined vision is recorded, so the question is not asked again every read', async () => {
  const snap = snapshot([branch('a')]);
  const config = settings({ visionAutoDraft: true });

  // Summary first, then a draft the model declines to write.
  let call = 0;
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    call++;
    const content = call === 1
      ? JSON.stringify({ title: 'T', summary: 'It does a thing.', progress: 'progressing', evidence: [] })
      : JSON.stringify({ vision: null, why: 'the commits say nothing specific' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  enrich.applyCached(snap, config);
  await work.runBoard(snap, config);
  const afterFirst = call;
  assert.ok(afterFirst >= 2, 'it summarised, then tried to say what the branch is for');
  assert.equal(snap.branches[0]!.vision, null, 'declining writes no vision — that is correct');

  // The next read must not ask again. Before D70 this cost a call every minute, forever.
  const again = snapshot([branch('a')]);
  enrich.applyCached(again, config);
  assist.applyAssist(again, config);
  assert.equal(
    board.deriveBoard(again, config).filter((j) => j.kind === 'draft-vision').length,
    0,
    'no vision job is derived for a branch already declined at this head',
  );

  // Until the branch moves, which is exactly when it is worth asking again.
  const moved = snapshot([branch('a', { headSha: 'sha-a-moved' })]);
  enrich.applyCached(moved, config);
  assist.applyAssist(moved, config);
  moved.branches[0]!.summary = 'It does a thing.';
  assert.equal(
    board.deriveBoard(moved, config).filter((j) => j.kind === 'draft-vision').length,
    1,
    'a moved branch is worth asking about again',
  );
});

// ---------------------------------------------------------------------------
// The board itself
// ---------------------------------------------------------------------------

test('the same job derived twice has the same id, and a moved branch a new one', () => {
  const config = settings();
  const a = snapshot([branch('a')]);
  const b = snapshot([branch('a')]);
  enrich.applyCached(a, config);
  enrich.applyCached(b, config);

  const one = board.deriveBoard(a, config)[0]!;
  const two = board.deriveBoard(b, config)[0]!;
  assert.equal(one.id, two.id, 'a read landing mid-flight finds the job already claimed');

  const moved = snapshot([branch('a', { headSha: 'different' })]);
  enrich.applyCached(moved, config);
  assert.notEqual(board.deriveBoard(moved, config)[0]!.id, one.id);
});

test('jobs say in plain English what they are doing, and the page never sees a closure', () => {
  const snap = snapshot([branch('claude/kind-meitner')]);
  const config = settings();
  enrich.applyCached(snap, config);

  const spec = board.deriveBoard(snap, config)[0]!;
  assert.match(spec.title, /^Reading what claude\/kind-meitner is doing$/);

  const job = board.toJob(spec) as Record<string, unknown>;
  assert.equal(job['run'], undefined);
  assert.equal(job['doneWhen'], undefined);
  assert.equal(job['kind'], 'summarise');
});

test('the free pass fills the board before anything is spent', () => {
  const snap = snapshot([branch('a'), branch('b')]);
  const config = settings({ workers: 3 });
  enrich.applyCached(snap, config);
  work.applyWork(snap, config);

  assert.equal(snap.work.jobs.length, 2);
  assert.equal(snap.work.workers, 3);
  assert.ok(snap.work.jobs.every((j) => j.state === 'waiting'));
});
