/**
 * Work the owner asked for.
 *
 * Three things have to hold, and each was a decision rather than a detail:
 *
 *   it can ask for something already done (D81) — the branch has not moved, so the routine
 *   board can never produce "read it again" and the predicate has to be about freshness;
 *
 *   it survives the program closing (D72), because nothing in the fleet implies it;
 *
 *   it never queues behind the background work (D71), which is the whole point of asking.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-dispatch-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let enrich: typeof import('../server/advise/enrich.ts');
let assist: typeof import('../server/advise/assist.ts');
let store: typeof import('../server/advise/store.ts');
let vision: typeof import('../server/vision.ts');
let work: typeof import('../server/work/run.ts');
let board: typeof import('../server/work/board.ts');
let queue: typeof import('../server/work/dispatched.ts');

before(async () => {
  enrich = await import('../server/advise/enrich.ts');
  assist = await import('../server/advise/assist.ts');
  store = await import('../server/advise/store.ts');
  vision = await import('../server/vision.ts');
  work = await import('../server/work/run.ts');
  board = await import('../server/work/board.ts');
  queue = await import('../server/work/dispatched.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const file of ['insights.json', 'visions.json', 'assist.json', 'dispatched.json']) {
    rmSync(join(TEMP, file), { force: true });
  }
  store.resetInsightCache();
  vision.resetVisionCache();
  assist.resetAssistCache();
  queue.resetDispatchedCache();
  work.resetBoardState();
  work.forgetResume();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh', repos: ['o/r'], llmApiKey: 'key', llmModel: 'test-model',
  visionAutoDraft: false, toolsEnabled: false,
  ...over,
});

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'c', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    ahead: 2, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null,
    vision: null, assessment: null, title: null, summary: null, progress: null, insight: null, recap: null, commitsFrom: 'ahead', ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-18T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: false, pending: 0, errors: [] },
});

function stubProvider(reply: unknown): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return state;
}

const insight = (summary = 'It does a thing.') => ({
  choices: [{ message: { content: JSON.stringify({ title: 'T', summary, progress: 'progressing', evidence: [] }) } }],
});

const ref = { kind: 'branch' as const, repoKey: 'o/r', branch: 'a' };

// ---------------------------------------------------------------------------

test('you can ask for a second opinion on something already answered', async () => {
  // The routine board can never produce this: the summary is there, the branch has not
  // moved, and its predicate is already satisfied. So the predicate becomes freshness.
  const config = settings();
  const calls = stubProvider(insight('First answer.'));

  const first = snapshot([branch('a')]);
  enrich.applyCached(first, config);
  await work.runBoard(first, config, {
    derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'summarise'),
  });
  assert.equal(calls.calls, 1);
  assert.equal(first.branches[0]!.summary, 'First answer.');

  // Nothing has changed, so the routine board has nothing to say about this branch.
  const again = snapshot([branch('a')]);
  enrich.applyCached(again, config);
  assert.equal(board.deriveBoard(again, config).filter((j) => j.kind === 'summarise').length, 0);

  // But asked for, it runs — and the answer is replaced.
  queue.dispatch('summarise', ref);
  stubProvider(insight('Second answer.'));
  const asked = board.deriveDispatched(again, config);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.origin, 'dispatched');
  assert.match(asked[0]!.title, /again/);

  const result = await work.runBoard(again, config, { lane: 'dispatched' });
  assert.equal(result.done, 1);

  const third = snapshot([branch('a')]);
  enrich.applyCached(third, config);
  assert.equal(third.branches[0]!.summary, 'Second answer.');
});

test('asking twice for the same thing is one job, not two', async () => {
  queue.dispatch('summarise', ref);
  queue.dispatch('summarise', ref);
  assert.equal(queue.listDispatched().length, 1);

  queue.dispatch('assess', ref);
  assert.equal(queue.listDispatched().length, 2, 'a different question is a different job');
});

test('a request is cleared once it lands, so it does not come back', async () => {
  const config = settings();
  stubProvider(insight());
  queue.dispatch('summarise', ref);

  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, config);
  await work.runBoard(snap, config, { lane: 'dispatched' });

  assert.deepEqual(queue.listDispatched(), []);
  assert.equal(snap.work.finished.length, 1, 'and you are told it landed');
  assert.equal(snap.work.finished[0]!.state, 'done');
  assert.equal(snap.work.finished[0]!.origin, 'dispatched');
});

test('a request survives the program closing, and is picked up on the next start', async () => {
  queue.dispatch('summarise', ref);

  // A restart: the store is re-read from disk exactly as it would be.
  queue.resetDispatchedCache();
  work.forgetResume();
  const first = work.resumeDispatched();
  assert.equal(first.resumed, 1);
  assert.equal(first.gaveUp, 0);
  assert.equal(queue.listDispatched()[0]!.reboots, 1);

  queue.resetDispatchedCache();
  work.forgetResume();
  assert.equal(work.resumeDispatched().resumed, 1, 'a second start still tries');

  // A third start is a loop rather than a retry: it parks, where it is visible.
  queue.resetDispatchedCache();
  work.forgetResume();
  const third = work.resumeDispatched();
  assert.equal(third.resumed, 0);
  assert.equal(third.gaveUp, 1);
  assert.deepEqual(queue.listDispatched(), [], 'and it is off the disk for good');

  const snap = snapshot([branch('a')]);
  work.applyWork(snap, settings());
  const parked = snap.work.jobs.filter((j) => j.state === 'parked');
  assert.equal(parked.length, 1);
  assert.match(parked[0]!.error ?? '', /two restarts/);
});

test('asking for something supersedes the routine job for the same thing', async () => {
  // Otherwise both run, both write, and the second silently wins — having paid twice.
  const config = settings();
  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, config);
  work.applyWork(snap, config);
  assert.equal(snap.work.jobs.filter((j) => j.kind === 'summarise').length, 1);

  queue.dispatch('summarise', ref);
  work.applyWork(snap, config);

  const summarising = snap.work.jobs.filter((j) => j.kind === 'summarise');
  assert.equal(summarising.length, 1, 'one, not two');
  assert.equal(summarising[0]!.origin, 'dispatched', 'and it is the one you asked for');
});

test('the dispatched lane has its own workers and its own purse', async () => {
  // A read that has just spent its budget on summaries must still be able to do the one
  // thing the owner actually asked for.
  const config = settings({ llmMaxPerRun: 2, dispatchWorkers: 3 });
  for (const name of ['a', 'b', 'c']) queue.dispatch('summarise', { kind: 'branch', repoKey: 'o/r', branch: name });

  let peak = 0;
  let live = 0;
  globalThis.fetch = (async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return new Response(JSON.stringify(insight()), { status: 200 });
  }) as typeof fetch;

  const snap = snapshot([branch('a'), branch('b'), branch('c')]);
  enrich.applyCached(snap, config);
  const result = await work.runBoard(snap, config, { lane: 'dispatched' });

  assert.equal(peak, 2, `dispatchWorkers is 3 but the purse only allows 2 at a time: saw ${peak}`);
  assert.equal(result.done, 2, 'two of the three, and the third waits for the next go');
});

test('a request against a branch that is gone is dropped, not kept for ever', () => {
  queue.dispatch('summarise', { kind: 'branch', repoKey: 'o/r', branch: 'deleted' });
  const snap = snapshot([branch('a')]);
  assert.deepEqual(board.deriveDispatched(snap, settings()), []);
});

test('a request to check a branch with no vision does not apply', () => {
  queue.dispatch('assess', ref);
  const snap = snapshot([branch('a')]);
  assert.deepEqual(board.deriveDispatched(snap, settings()), [], 'nothing to compare against');
});

test('the brief can be asked for even though nothing moved', async () => {
  const config = settings();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ brief: 'Here it is.', goals: [], overtaken: [] }) } }] }),
      { status: 200 },
    )) as typeof fetch;

  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, config);
  await work.runBoard(snap, config, { derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'brief') });
  assist.applyAssist(snap, config);
  assert.equal(snap.brief?.text, 'Here it is.');

  // The fleet has not moved, so nothing routine would ever rewrite it.
  assert.equal(board.deriveBoard(snap, config).filter((j) => j.kind === 'brief').length, 0);

  queue.dispatch('brief', { kind: 'fleet' });
  assert.equal(board.deriveDispatched(snap, config).length, 1);
});

test('a settings save is not a restart', async () => {
  // startPolling runs on every settings save. Counting a reboot each time would park
  // everything the owner asked for after three visits to the settings screen.
  queue.dispatch('summarise', ref);
  work.forgetResume();
  assert.equal(work.resumeDispatched().resumed, 1);
  assert.equal(work.resumeDispatched().resumed, 0, 'the second call in one process does nothing');
  assert.equal(work.resumeDispatched().resumed, 0);
  assert.equal(queue.listDispatched()[0]!.reboots, 1, 'counted once');
});

test('the dispatched lane does not wipe the routine board off the floor', async () => {
  // A lane decides what is claimed, never what is shown. Publishing only its own slice had
  // the dispatched run hide every routine job for as long as it took.
  const config = settings();
  queue.dispatch('summarise', { kind: 'branch', repoKey: 'o/r', branch: 'a' });

  const snap = snapshot([branch('a'), branch('b'), branch('c')]);
  enrich.applyCached(snap, config);

  const seen: number[] = [];
  globalThis.fetch = (async () => {
    seen.push(snap.work.jobs.length);
    return new Response(JSON.stringify(insight()), { status: 200 });
  }) as typeof fetch;

  await work.runBoard(snap, config, { lane: 'dispatched' });

  // b and c still need summarising, and the brief is on the board too — all still visible.
  assert.ok(seen.every((n) => n >= 3), `the floor went quiet mid-run: ${seen.join(', ')}`);
});

test('the two lanes cannot both claim the same job', async () => {
  // They run side by side, and a job at the back of one lane's list can be claimed by the
  // other while the first is still working through the front of it.
  const config = settings({ workers: 1, dispatchWorkers: 1, llmMaxPerRun: 20 });
  const names = ['a', 'b', 'c', 'd'];
  for (const name of names) queue.dispatch('summarise', { kind: 'branch', repoKey: 'o/r', branch: name });

  const asked: string[] = [];
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    const body = String(init?.body ?? '');
    asked.push(names.find((n) => body.includes(`work on ${n}`)) ?? 'brief');
    await new Promise((r) => setTimeout(r, 4));
    return new Response(JSON.stringify(insight()), { status: 200 });
  }) as typeof fetch;

  const snap = snapshot(names.map((n) => branch(n)));
  enrich.applyCached(snap, config);

  await Promise.all([
    work.runBoard(snap, config, { lane: 'dispatched' }),
    work.runBoard(snap, config),
  ]);

  const summaries = asked.filter((n) => n !== 'brief');
  assert.equal(new Set(summaries).size, summaries.length, `paid twice for something: ${summaries.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Found in review: what the second lane and the retry button were getting wrong
// ---------------------------------------------------------------------------

test('the dispatched lane leaves a parked routine job parked', async () => {
  // Judged by its own slice of the board, the dispatched lane used to forget every routine
  // failure at the end of its run — and each was tried twice more on the next read.
  const config = settings();
  let summaries = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const content = body.includes('You are a personal assistant')
      ? JSON.stringify({ brief: 'Fine.', goals: [], overtaken: [] })
      : (summaries++, 'not json');
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  for (let read = 0; read < 2; read++) {
    const snap = snapshot([branch('a')]);
    enrich.applyCached(snap, config);
    await work.runBoard(snap, config);
  }
  assert.equal(summaries, 2, 'tried on two reads, then parked');

  queue.dispatch('brief', { kind: 'fleet' });
  const during = snapshot([branch('a')]);
  enrich.applyCached(during, config);
  await work.runBoard(during, config, { lane: 'dispatched' });

  const after = snapshot([branch('a')]);
  enrich.applyCached(after, config);
  work.applyWork(after, config);
  assert.equal(after.work.jobs.filter((j) => j.state === 'parked').length, 1, 'still parked');
  await work.runBoard(after, config);
  assert.equal(summaries, 2, 'and not tried again');
});

test('a draft never overwrites what the owner said a branch is for', () => {
  // The station writes over whatever vision is there, so a request to draft is refused
  // wherever the words are the owner's — and cleared, rather than kept for ever.
  vision.setVision({ repoKey: 'o/r', branch: 'a' }, 'My own words', 'yours');
  queue.dispatch('draft-vision', ref);
  const snap = snapshot([branch('a')]);
  assist.applyAssist(snap, settings());
  assert.deepEqual(board.deriveDispatched(snap, settings()), []);
  assert.deepEqual(queue.listDispatched(), [], 'off the disk');
  assert.equal(vision.getVision({ repoKey: 'o/r', branch: 'a' })?.text, 'My own words');

  // Its own earlier guess is fair game.
  vision.setVision({ repoKey: 'o/r', branch: 'a' }, 'A guess', 'proposed');
  queue.dispatch('draft-vision', ref);
  const again = snapshot([branch('a')]);
  assist.applyAssist(again, settings());
  assert.equal(board.deriveDispatched(again, settings()).length, 1);
});

test('a request that cannot apply is cleared, not rebooted until it gives up', () => {
  queue.dispatch('assess', ref);
  board.deriveDispatched(snapshot([branch('a')]), settings());
  assert.deepEqual(queue.listDispatched(), [], 'nothing to compare against, so nothing to keep');
});

test('a request against a deleted branch is dropped; one against a repo that could not be read stands', () => {
  const gone = { kind: 'branch' as const, repoKey: 'o/r', branch: 'deleted' };
  const repo = { key: 'o/r', owner: 'o', name: 'r', defaultBranch: 'main', branchCount: 1, url: 'u' };

  queue.dispatch('summarise', gone);
  // The read did not reach o/r at all: a bad connection, not a deletion.
  board.deriveDispatched({ ...snapshot([]), repos: [] }, settings());
  assert.equal(queue.listDispatched().length, 1, 'kept');

  // The read reached o/r and the branch is not in it: deleted.
  board.deriveDispatched({ ...snapshot([branch('a')]), repos: [repo] }, settings());
  assert.deepEqual(queue.listDispatched(), [], 'dropped');
});

test('a parked request hands itself back on retry, so "try again" can ask again', () => {
  // Parking took it off disk. Forgetting the failure alone left nothing to derive, and the
  // button did nothing at all.
  queue.dispatch('summarise', ref);
  for (let start = 0; start < 3; start++) {
    queue.resetDispatchedCache();
    work.forgetResume();
    work.resumeDispatched();
  }
  const snap = snapshot([branch('a')]);
  work.applyWork(snap, settings());
  const stuck = snap.work.jobs.find((j) => j.state === 'parked')!;
  assert.equal(stuck.origin, 'dispatched');

  const job = work.unpark(stuck.id);
  assert.equal(job?.kind, 'summarise');
  assert.deepEqual(job?.subject, ref);
  assert.equal(work.unpark(stuck.id), null, 'once');
});

test('the door refuses what the board would only drop', () => {
  const base = branch('main', { isBase: true });
  assert.match(board.cannotAsk('summarise', base) ?? '', /base branch/);
  assert.match(board.cannotAsk('summarise', branch('empty', { commits: [] })) ?? '', /no commits/);
  assert.match(board.cannotAsk('assess', branch('a')) ?? '', /nobody has said/);
  const mine = { text: 'Mine', state: 'yours' as const, from: '', draftedAt: null, createdAt: 'x', updatedAt: 'x' };
  assert.match(board.cannotAsk('draft-vision', branch('a', { vision: mine })) ?? '', /already said/);
  assert.equal(board.cannotAsk('draft-vision', branch('a', { vision: { ...mine, state: 'proposed' } })), null);
  assert.equal(board.cannotAsk('assess', branch('a', { vision: mine })), null);
  assert.equal(board.cannotAsk('brief', base), null);
});

test('a branch with nothing to compare is never assessed, routine or asked for', () => {
  // "drifted" on a merged branch with an empty compare was a guess dressed as a finding.
  const mine = { text: 'Ship X', state: 'yours' as const, from: '', draftedAt: null, createdAt: 'x', updatedAt: 'x' };
  const empty = branch('a', { commits: [], vision: mine });
  assert.equal(board.deriveBoard(snapshot([empty]), settings()).filter((j) => j.kind === 'assess').length, 0);
  queue.dispatch('assess', ref);
  assert.deepEqual(board.deriveDispatched(snapshot([empty]), settings()), []);
  assert.deepEqual(queue.listDispatched(), [], 'and the request is cleared');
  assert.match(board.cannotAsk('assess', empty) ?? '', /no commits/);
});
