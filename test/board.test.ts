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
  work: { jobs: [], workers: 2, finished: [] },
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
  // Lookups off, so this measures the budget itself rather than the reserve a station
  // with tools claims against — that has its own test below.
  const config = settings({ llmMaxPerRun: 3, toolsEnabled: false });
  const snap = snapshot(Array.from({ length: 10 }, (_, i) => branch(`b${i}`)));
  const calls = stubProvider(insight());

  enrich.applyCached(snap, config);
  const result = await work.runBoard(snap, config);
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
  assert.equal(calls.summarised(), 1);
  assert.equal(one.parked, 0, 'once is not a verdict');

  const second = snapshot([branch('a')]);
  enrich.applyCached(second, settings());
  const two = await work.runBoard(second, settings());
  assert.equal(calls.summarised(), 2, 'tried once, retried once');
  assert.equal(two.parked, 1);
  const stuck = second.work.jobs.filter((j) => j.state === 'parked');
  assert.equal(stuck.length, 1);
  assert.ok(stuck[0]!.error, 'the parked job carries what went wrong');

  // And no later read quietly starts it over while the branch sits at the same head.
  const third = snapshot([branch('a')]);
  enrich.applyCached(third, settings());
  const three = await work.runBoard(third, settings());
  assert.equal(calls.summarised(), 2, 'still parked at the same head');
  assert.equal(three.byKind.brief, 1, 'and the brief is written anyway — it is not blocked by it');
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
    origin: 'routine' as const, state: 'waiting' as const, startedAt: null, attempts: 0,
    toolCalls: 0, doing: null, error: null, reserve: 1, stage: 0,
    run: async () => { ran++; },
    doneWhen: () => false,
  }];

  const first = await work.runBoard(snap, settings(), { derive: liar });
  assert.equal(first.done, 0, 'it claimed done and produced nothing');
  assert.equal(first.claimedButNotDone, 1, 'counted, every time it happens');

  const second = await work.runBoard(snap, settings(), { derive: liar });
  assert.equal(second.claimedButNotDone, 1);
  assert.equal(second.parked, 1);
  assert.equal(ran, 2, 'tried twice, then parked — never forever');

  const third = await work.runBoard(snap, settings(), { derive: liar });
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

  // Two summaries and the brief: the brief is on the board from the start, so that one
  // branch the model will not summarise cannot hold it back for ever.
  assert.equal(snap.work.jobs.length, 3);
  assert.equal(snap.work.jobs.filter((j) => j.kind === 'brief').length, 1);
  assert.equal(snap.work.workers, 3);
  assert.ok(snap.work.jobs.every((j) => j.state === 'waiting'));
});

// ---------------------------------------------------------------------------
// Tools, end to end: board → dispatcher → station → tool → the floor
// ---------------------------------------------------------------------------

test('an assessment can look things up, and the floor sees it happen', async () => {
  const config = settings({ visionAutoDraft: false, toolsEnabled: true });
  const subject = branch('a');
  const other = branch('b');

  // The owner said what it is for, so the assess job is derivable.
  vision.setVision({ repoKey: 'o/r', branch: 'a' }, 'Replace the picker with a searchable one', 'yours');

  const bodies: string[] = [];
  let turn = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    const content = turn++ === 0
      ? '{"tool":"sibling_branches","args":{"limit":3}}'
      : '{"verdict":"drifted","because":"b already did it","evidence":[]}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  const snap = snapshot([subject, other]);
  enrich.applyCached(snap, config);
  assist.applyAssist(snap, config);

  // Only the assess job: summaries are off and the brief is not what is being tested.
  const onlyAssess = (s: Snapshot, c: Settings) =>
    board.deriveBoard(s, c).filter((j) => j.kind === 'assess');
  assert.equal(onlyAssess(snap, config).length, 1, 'one branch with a vision and no assessment');

  const seen: { doing: string | null; toolCalls: number }[] = [];
  const result = await work.runBoard(snap, config, {
    derive: onlyAssess,
    onProgress: () => {
      for (const job of snap.work.jobs) {
        if (job.state === 'working') seen.push({ doing: job.doing, toolCalls: job.toolCalls });
      }
    },
  });

  assert.equal(result.done, 1);
  assert.equal(snap.branches[0]!.assessment?.verdict, 'drifted');
  assert.ok(
    seen.some((s) => s.doing === 'sibling_branches' && s.toolCalls === 1),
    `the floor should have shown the lookup: ${JSON.stringify(seen)}`,
  );
  assert.match(bodies[1]!, /o\/r b/, 'the sibling really was read and sent back');
});

test('the same assessment is not re-paid when tools are left alone', async () => {
  const config = settings({ visionAutoDraft: false, toolsEnabled: true });
  const subject = branch('a');
  vision.setVision({ repoKey: 'o/r', branch: 'a' }, 'Replace the picker', 'yours');

  const calls = stubProvider({ choices: [{ message: { content: '{"verdict":"on-track","because":"yes","evidence":[]}' } }] });

  const first = snapshot([subject]);
  enrich.applyCached(first, config);
  assist.applyAssist(first, config);
  await work.runBoard(first, config, {
    derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'assess'),
  });
  assert.equal(calls.calls, 1);

  const again = snapshot([branch('a')]);
  enrich.applyCached(again, config);
  assist.applyAssist(again, config);
  assert.equal(again.branches[0]!.assessment?.verdict, 'on-track', 'served from disk, free');
  await work.runBoard(again, config, {
    derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'assess'),
  });
  assert.equal(calls.calls, 1, 'nothing moved, nothing spent');

  // But turning tools off makes it a different question, drawn from different evidence.
  const off = { ...config, toolsEnabled: false };
  const third = snapshot([branch('a')]);
  enrich.applyCached(third, off);
  assist.applyAssist(third, off);
  assert.equal(third.branches[0]!.assessment, null, 'the stored one was written with tools');
});

// ---------------------------------------------------------------------------
// The audit — each of these is a way the room misbehaved before it was fixed
// ---------------------------------------------------------------------------

test('a bad API key does not park the fleet, and fixing it resumes the work', async () => {
  // It used to: two reads of 401 gave every claimed job its second failure, so everything
  // parked. Fixing the key brought back one branch — the rest sat in "waiting on you"
  // needing a click each. A rejected key is a fact about the settings, not about a job.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as typeof fetch;

  for (const _read of [1, 2]) {
    const snap = snapshot([branch('a'), branch('b'), branch('c')]);
    enrich.applyCached(snap, settings());
    const result = await work.runBoard(snap, settings());
    assert.equal(result.parked, 0, 'a settings problem parks nothing');
    assert.ok(result.errors.some((e: string) => /fixed in settings/.test(e)));
  }

  const calls = stubProvider(insight());
  const snap = snapshot([branch('a'), branch('b'), branch('c')]);
  enrich.applyCached(snap, settings());
  const result = await work.runBoard(snap, settings());

  assert.equal(result.byKind.summarise, 3, 'all three resume by themselves');
  assert.equal(snap.work.jobs.filter((j) => j.state === 'parked').length, 0);
  assert.equal(calls.summarised(), 3);
});

test('a job in flight is shown as in flight, even to a read that lands mid-run', async () => {
  // The floor said "0 at work" while two were: a refresh builds a new snapshot and asks
  // what is outstanding, and the answer has to include what a worker already has.
  const config = settings();
  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, config);

  let seenByLateRead: ReturnType<typeof board.deriveBoard> extends never ? never : number = 0;
  let lateJobs: { state: string }[] = [];

  globalThis.fetch = (async () => {
    // A read lands while this call is in flight, exactly as the refresh timer would.
    const later = snapshot([branch('a')]);
    enrich.applyCached(later, config);
    work.applyWork(later, config);
    lateJobs = later.work.jobs;
    seenByLateRead = later.work.jobs.filter((j) => j.state === 'working').length;
    return new Response(JSON.stringify(insight()), { status: 200 });
  }) as typeof fetch;

  await work.runBoard(snap, config);

  assert.equal(seenByLateRead, 1, `the later read should see it working: ${JSON.stringify(lateJobs)}`);
  assert.equal(lateJobs.filter((j) => j.state === 'waiting').length, 0, 'and not also as waiting');
});

test('nothing is left marked in flight once a run is over', async () => {
  const config = settings();
  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, config);
  stubProvider(insight());
  await work.runBoard(snap, config);

  const after = snapshot([branch('a'), branch('z')]);
  enrich.applyCached(after, config);
  work.applyWork(after, config);
  assert.equal(after.work.jobs.filter((j) => j.state === 'working').length, 0);
  assert.deepEqual(
    after.work.jobs.map((j) => j.kind).sort(),
    ['brief', 'summarise'],
    'the new branch, and the brief the fleet moving made stale',
  );
});

test('one job is never paid for twice in a run, whatever the board says', async () => {
  const calls = stubProvider(insight());
  const snap = snapshot([branch('a')]);
  enrich.applyCached(snap, settings());

  // A board that wrongly keeps offering a finished job. The dispatcher must not buy it
  // again: the derivation is the thing most likely to be wrong, and calls cost money.
  const specs = board.deriveBoard(snap, settings());
  const result = await work.runBoard(snap, settings(), { derive: () => specs });

  assert.equal(result.done, specs.length, 'every job ran');
  assert.equal(calls.calls, specs.length, 'and none of them ran twice');
});

test('the budget counts provider calls, not jobs — lookups come out of it too', async () => {
  // "Max per read" has to mean what a read costs. Counting jobs let a read with lookups
  // cost several times the number on the settings screen.
  const config = settings({ visionAutoDraft: false, toolsEnabled: true, llmMaxPerRun: 4 });
  for (const name of ['a', 'b', 'c', 'd']) {
    vision.setVision({ repoKey: 'o/r', branch: name }, `Do the ${name} thing`, 'yours');
  }

  let calls = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls++;
    // Every assessment looks one thing up before answering: two calls a job.
    const content = String(init?.body ?? '').includes('you asked for')
      ? '{"verdict":"on-track","because":"fine","evidence":[]}'
      : '{"tool":"sibling_branches","args":{}}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  const snap = snapshot(['a', 'b', 'c', 'd'].map((n) => branch(n)));
  enrich.applyCached(snap, config);
  assist.applyAssist(snap, config);
  const result = await work.runBoard(snap, config, {
    derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'assess'),
  });

  assert.ok(calls <= 8, `a budget of 4 calls should not have bought ${calls}`);
  assert.ok(result.done >= 2 && result.done < 4, `two jobs at two calls each: got ${result.done}`);
  assert.equal(result.budgetSpent, true, 'and it says the rest waits for the next read');
});

test('two workers really do work at once', async () => {
  const config = settings({ workers: 2 });
  let inFlight = 0;
  let peak = 0;

  globalThis.fetch = (async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return new Response(JSON.stringify(insight()), { status: 200 });
  }) as typeof fetch;

  const snap = snapshot([branch('a'), branch('b'), branch('c'), branch('d')]);
  enrich.applyCached(snap, config);
  await work.runBoard(snap, config, {
    derive: (s, c) => board.deriveBoard(s, c).filter((j) => j.kind === 'summarise'),
  });

  assert.equal(peak, 2, `settings say 2 at once; saw ${peak}`);
});
