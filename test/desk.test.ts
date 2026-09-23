/**
 * The agent, phase 1: honest and whole (D94, plans/agent-autonomy.md).
 *
 * It answers from what it sees, may read further, and may queue work — and it must not be
 * able to say it did something it did not. Every audit finding but "cannot edit" has a
 * test here.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, JobKind, JobSubject, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-desk-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let desk: typeof import('../server/advise/ask.ts');
let tools: typeof import('../server/tools/agent.ts');
let actions: typeof import('../server/agent/actions.ts');
let goals: typeof import('../server/goals.ts');
let thread: typeof import('../server/advise/conversation.ts');
let types: typeof import('../server/tools/types.ts');
let record: typeof import('../server/agent/record.ts');
let visions: typeof import('../server/vision.ts');
let notebook: typeof import('../server/notebook.ts');
let brief: typeof import('../server/advise/brief.ts');
let undo: typeof import('../server/agent/undo.ts');

before(async () => {
  desk = await import('../server/advise/ask.ts');
  tools = await import('../server/tools/agent.ts');
  actions = await import('../server/agent/actions.ts');
  goals = await import('../server/goals.ts');
  thread = await import('../server/advise/conversation.ts');
  types = await import('../server/tools/types.ts');
  record = await import('../server/agent/record.ts');
  visions = await import('../server/vision.ts');
  notebook = await import('../server/notebook.ts');
  brief = await import('../server/advise/brief.ts');
  undo = await import('../server/agent/undo.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const file of readdirSync(TEMP)) rmSync(join(TEMP, file), { recursive: true, force: true });
  goals.resetGoalCache();
  record.resetRecordCache();
  visions.resetVisionCache();
  notebook.resetNotebookCache();
  // The advisor remembers between questions (D93); each test starts a fresh thread.
  thread.forget();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh', repos: ['o/r'], llmApiKey: 'key', llmModel: 'test-model',
  ...over,
});

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'c', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    commitsFrom: 'ahead', ahead: 2, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null,
    vision: null, assessment: null, title: null, summary: null, recap: null, progress: null, insight: null, ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-18T12:00:00Z', repos: [{ key: 'o/r', owner: 'o', name: 'r', defaultBranch: 'main', branchCount: branches.length, url: 'u' }],
  branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: true, pending: 0, errors: [] },
});

const vision = (text: string, state: 'yours' | 'proposed' = 'yours') =>
  ({ text, state, from: '', draftedAt: null, createdAt: 'x', updatedAt: 'x' });

/** Replies in order, then repeats the last one. Records what it was asked. */
function scripted(replies: string[]): { asks: string[] } {
  const state = { asks: [] as string[] };
  let i = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    state.asks.push(String(init.body));
    const content = replies[Math.min(i++, replies.length - 1)]!;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return state;
}

/** The action door as the route builds it, with the board replaced by a list. */
function door(snap: Snapshot) {
  const queued: { kind: JobKind; subject: JobSubject }[] = [];
  const retried: string[] = [];
  const act = (turn = 'turn-1', words = 'test') =>
    actions.actionsFor({
      snapshot: snap, turn, words, keep: 500,
      dispatch: (kind, subject) => void queued.push({ kind, subject }),
      retry: (id) => { retried.push(id); return true; },
      refresh: () => goals.applyGoals(snap),
    });
  return { queued, retried, act };
}

const ctxFor = (snap: Snapshot, act: ReturnType<typeof actions.actionsFor> | null) => {
  const { token: _t, llmApiKey: _k, ...safe } = settings();
  return { snapshot: snap, settings: { ...safe, hasToken: true, hasLlmKey: true }, branch: null, now: new Date(), github: null, act };
};

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

test('a reply that is not JSON is still the answer', () => {
  const r = desk.parseAnswer('Three branches moved and one went red.', snapshot([branch('a')]));
  assert.equal(r.text, 'Three branches moved and one went red.');
  assert.deepEqual(r.ranking, []);
  assert.deepEqual(r.groups, []);
});

test('a ranking names only real branches, once each, in the order given', () => {
  const r = desk.parseAnswer(
    JSON.stringify({
      answer: 'b first.',
      ranking: [
        { repo: 'o/r', branch: 'b', why: 'red CI' },
        { repo: 'o/r', branch: 'invented', why: 'no' },
        { repo: 'o/r', branch: 'a', why: 'moving' },
        { repo: 'o/r', branch: 'b', why: 'again' },
      ],
    }),
    snapshot([branch('a'), branch('b')]),
  );
  assert.deepEqual(r.ranking.map((x) => x.ref.branch), ['b', 'a']);
});

test('a regrouping keeps only real branches, one group each, and drops a group with nothing in it', () => {
  const r = desk.parseAnswer(
    JSON.stringify({
      answer: 'Two groups.',
      groups: [
        { title: 'Webhooks', branches: [{ repo: 'o/r', branch: 'a' }, { repo: 'o/r', branch: 'ghost' }] },
        { title: 'Also webhooks', branches: [{ repo: 'o/r', branch: 'a' }] },
        { title: 'Unfiled', branches: [{ repo: 'o/r', branch: 'c' }] },
      ],
    }),
    snapshot([branch('a'), branch('b'), branch('c')]),
  );
  assert.deepEqual(r.groups.map((g) => [g.title, g.branches.map((b) => b.branch)]), [['Webhooks', ['a']], ['Unfiled', ['c']]]);
});

// ---------------------------------------------------------------------------
// Finding 4 — every branch is in view
// ---------------------------------------------------------------------------

test('every branch is in the prompt: the recent in full, the rest one line each', () => {
  const many = Array.from({ length: 90 }, (_, i) =>
    branch(`x${String(i).padStart(2, '0')}`, { lastActivity: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z` }));
  const prompt = desk.buildAskPrompt(snapshot(many), 'organise everything', 60);
  const named = new Set((prompt.match(/- o\/r x\d\d/g) ?? []));
  assert.equal(named.size, 90, 'no branch is invisible');
  assert.match(prompt, /all 90: 60 most recent in full, 30 more one line each/);
  assert.doesNotMatch(prompt, /omitted/);
});

test('the branch tool reads any branch in full, and names what it could not find', () => {
  const snap = snapshot([branch('a', { vision: vision('Ship X'), title: 'Shipping X' }), branch('b')]);
  const out = String(tools.branchDetail.run({ branches: ['a', 'o/r b', 'ghost'] }, ctxFor(snap, null)));
  assert.match(out, /- o\/r a .*\n\s+FOR: Ship X \(the owner's words\)/);
  assert.match(out, /- o\/r b /);
  assert.match(out, /Not found: ghost/);
});

// ---------------------------------------------------------------------------
// Finding 3 — batch, and a run cut short says what it did
// ---------------------------------------------------------------------------

test('one call queues work for many branches, and says which it could not', () => {
  const snap = snapshot([branch('a', { vision: vision('For a') }), branch('b'), branch('c')]);
  const d = door(snap);
  const out = String(tools.queueWork.run({ kind: 'assess', branches: ['a', 'b', 'ghost'] }, ctxFor(snap, d.act())));
  assert.deepEqual(d.queued.map((q) => q.subject), [{ kind: 'branch', repoKey: 'o/r', branch: 'a' }]);
  assert.match(out, /Done \(1\)/);
  assert.match(out, /Not done \(1\):\n\s+nobody has said what b is for/);
  assert.match(out, /Not found \(1\): ghost/);
});

test('a run that runs out of steps reports what it changed instead of failing', async () => {
  const names = Array.from({ length: 20 }, (_, i) => `b${i}`);
  const snap = snapshot(names.map((n) => branch(n)));
  // One branch per call, never answering: the worst a model can do with a batch tool.
  scripted(names.map((n) => JSON.stringify({ tool: 'queue', args: { kind: 'summarise', branches: [n] } })));
  const d = door(snap);
  const answer = await desk.ask(snap, 're-read every branch', settings({ agentCallsPerQuestion: 5 }), { act: d.act });

  assert.equal(answer.unfinished, true);
  assert.equal(d.queued.length, 5, 'the five it did are really on the board');
  assert.equal(answer.changes.length, 5, 'and all five are listed');
  assert.match(answer.text, /ran out of steps.*5 changes/);
});

// ---------------------------------------------------------------------------
// Finding 1 — it cannot claim what it did not do
// ---------------------------------------------------------------------------

test('what it changed comes from the door, never from its words', async () => {
  const snap = snapshot([branch('a')]);
  scripted([
    JSON.stringify({ tool: 'queue', args: { kind: 'summarise', branches: ['a'] } }),
    // It claims more than it did: the list must not believe it.
    JSON.stringify({ answer: "I've re-read a and rewritten the brief." }),
  ]);
  const d = door(snap);
  const answer = await desk.ask(snap, 'read a again', settings(), { act: d.act });
  assert.deepEqual(answer.changes.map((c) => c.text), ['a: queued to be read again']);
  assert.equal(answer.unbacked, false, 'it did change something');
});

test('a claimed change with nothing behind it is flagged', async () => {
  scripted([JSON.stringify({ answer: 'Done — I renamed the goal to Payments and marked it done.' })]);
  const snap = snapshot([branch('a')]);
  const answer = await desk.ask(snap, 'rename the goal', settings(), { act: door(snap).act });
  assert.equal(answer.unbacked, true);
  assert.deepEqual(answer.changes, []);
});

test('describing the state is not a claim', () => {
  assert.equal(desk.claimsChange('claude/a is filed under Webhooks and is done.'), false);
  assert.equal(desk.claimsChange('I have filed both under Webhooks.'), true);
  assert.equal(desk.claimsChange("I've queued a re-read."), true);
  assert.equal(desk.claimsChange('Done. Both are under Webhooks.'), true);
});

test('it is told what it cannot do, and told differently when changes are off', () => {
  assert.match(desk.systemFor('act'), /Change anything on GitHub/);
  assert.match(desk.systemFor('act'), /Change a setting/);
  assert.match(desk.systemFor('act'), /never ask first/);
  assert.match(desk.systemFor('read'), /switched off in the owner's settings/);
  assert.doesNotMatch(desk.systemFor('read'), /never ask first/);
  assert.match(desk.systemFor('none'), /You have no tools this time/);
  assert.doesNotMatch(desk.systemFor('none'), /"branch" reads any/);
});

// ---------------------------------------------------------------------------
// Finding 5 — its own switch, not the stations'
// ---------------------------------------------------------------------------

test('turning off the stations\' lookups leaves the advisor its tools', async () => {
  const { asks } = scripted([JSON.stringify({ answer: 'ok' })]);
  const snap = snapshot([branch('a')]);
  await desk.ask(snap, 'hi', settings({ toolsEnabled: false, toolCallsPerJob: 0 }), { act: door(snap).act });
  assert.match(asks[0]!, /queue\(/, 'it can still queue');
  assert.match(asks[0]!, /branch\(/, 'and still read');
});

test('with changes switched off it reads but has no door, whatever it says', async () => {
  const { asks } = scripted([JSON.stringify({ answer: "I've queued it." })]);
  const snap = snapshot([branch('a')]);
  const d = door(snap);
  const answer = await desk.ask(snap, 'read a again', settings({ agentEnabled: false }), { act: d.act });
  assert.doesNotMatch(asks[0]!, /queue\(/, 'no change tool offered');
  assert.match(asks[0]!, /branch\(/, 'reads still are');
  assert.equal(d.queued.length, 0);
  assert.equal(answer.unbacked, true, 'and the claim is flagged');
});

test('a station never has the door, so a queue call from one is refused', () => {
  assert.throws(() => tools.queueWork.run({ kind: 'brief' }, ctxFor(snapshot([branch('a')]), null)), types.ToolError);
});

// ---------------------------------------------------------------------------
// Findings 2 and 6 — memory that holds what it did, and survives a reload
// ---------------------------------------------------------------------------

test('the next turn knows what the last one changed and proposed', async () => {
  const snap = snapshot([branch('a'), branch('b')]);
  const { asks } = scripted([
    JSON.stringify({ tool: 'queue', args: { kind: 'summarise', branches: ['a'] } }),
    JSON.stringify({ answer: 'Queued a; I would file both under Webhooks.', groups: [{ title: 'Webhooks', branches: [{ repo: 'o/r', branch: 'a' }, { repo: 'o/r', branch: 'b' }] }] }),
    JSON.stringify({ answer: 'ok' }),
  ]);
  const d = door(snap);
  await desk.ask(snap, 'read a again and show me a grouping', settings(), { act: d.act });
  await desk.ask(snap, 'yes, do that', settings(), { act: d.act });
  const earlier = asks[2]!.split('LATEST QUESTION')[0]!;
  assert.match(earlier, /You changed: a: queued to be read again/);
  assert.match(earlier, /You proposed filing, not yet done: Webhooks \(a, b\)/);
});

test('the server hands the thread back for a reload, newest first', async () => {
  const snap = snapshot([branch('a')]);
  scripted([JSON.stringify({ answer: 'one' }), JSON.stringify({ answer: 'two' })]);
  await desk.ask(snap, 'first', settings());
  await desk.ask(snap, 'second', settings());
  assert.deepEqual(thread.thread(30).map((a) => a.question), ['second', 'first']);
});

// ---------------------------------------------------------------------------
// Accepting a regrouping (the proposal path stays)
// ---------------------------------------------------------------------------

test('accepting a regrouping reuses goals by title, creates the rest, and unfiles on request', () => {
  const kept = goals.createGoal({ title: 'Webhooks' });
  goals.assignBranch({ repoKey: 'o/r', branch: 'c' }, kept.id);
  const result = goals.regroup([
    { title: 'webhooks', branches: [{ repoKey: 'o/r', branch: 'a' }] },
    { title: 'Search', branches: [{ repoKey: 'o/r', branch: 'b' }] },
    { title: 'Unfiled', branches: [{ repoKey: 'o/r', branch: 'c' }] },
  ]);
  assert.deepEqual(result, { created: 1, moved: 3 });
  assert.deepEqual(goals.listGoals().map((g) => g.title).sort(), ['Search', 'Webhooks']);
});

// ---------------------------------------------------------------------------
// Phases 3 and 4 — it acts, through the door, and it all undoes
// ---------------------------------------------------------------------------

test('"organise the register" files everything in one answer, and undo all reverts it', async () => {
  const snap = snapshot([branch('a'), branch('b'), branch('c')]);
  scripted([
    JSON.stringify({ tool: 'file', args: { goal: 'Webhooks', branches: ['a', 'o/r b'] } }),
    JSON.stringify({ tool: 'file', args: { goal: 'Search', branches: ['c'] } }),
    JSON.stringify({ answer: 'I filed a and b under Webhooks and c under Search.' }),
  ]);
  const d = door(snap);
  const answer = await desk.ask(snap, 'organise the register by theme', settings(), { act: d.act });

  assert.equal(answer.unbacked, false);
  assert.deepEqual(answer.changes.map((c) => c.text), [
    'Goal "Webhooks" created', 'a: filed under "Webhooks"', 'b: filed under "Webhooks"',
    'Goal "Search" created', 'c: filed under "Search"',
  ]);
  assert.deepEqual(goals.listGoals().map((g) => g.title).sort(), ['Search', 'Webhooks']);

  const undo = await import('../server/agent/undo.ts');
  assert.ok(undo.undoTurn(answer.turn).every((r) => r.ok));
  assert.deepEqual(goals.listGoals(), [], 'everything that one prompt did, taken back');
});

test('it can mark a goal done on its own, and that is flagged for the owner (Q78)', async () => {
  goals.createGoal({ title: 'Webhooks' });
  const snap = snapshot([branch('a')]);
  scripted([
    JSON.stringify({ tool: 'update_goal', args: { goal: 'Webhooks', done: true } }),
    JSON.stringify({ answer: 'I marked Webhooks done — every branch under it has merged.' }),
  ]);
  const answer = await desk.ask(snap, 'tidy up the goals', settings(), { act: door(snap).act });
  assert.equal(goals.listGoals()[0]!.done, true);
  assert.equal(record.feed().goalsDone, 1);
  assert.equal(record.feed().recent[0]!.words, 'tidy up the goals');
  assert.equal(answer.unbacked, false);
});

test('purposes: a guess is marked as one, the owner\'s words are kept, and names resolve', () => {
  visions.setVision({ repoKey: 'o/r', branch: 'a' }, 'My own words', 'yours');
  const snap = snapshot([branch('a'), branch('b')]);
  const out = String(tools.setVision.run(
    { items: [{ branch: 'o/r a', purpose: 'A guess' }, { branch: 'b', purpose: 'Ship the search box' }] },
    ctxFor(snap, door(snap).act()),
  ));
  assert.match(out, /Done \(1\)/);
  assert.match(out, /owner already said/);
  assert.equal(visions.getVision({ repoKey: 'o/r', branch: 'b' })?.state, 'proposed');

  const owner = door(snap).act('t2', 'a is for what they told me, write that down');
  String(tools.setVision.run({ items: [{ branch: 'a', purpose: 'What they told me' }], yours: true }, ctxFor(snap, owner)));
  assert.equal(visions.getVision({ repoKey: 'o/r', branch: 'a' })?.text, 'What they told me', 'yours=true, in the owner\'s words, is the owner speaking');
});

test('a batch with an unknown name does the rest and names what it could not find', () => {
  const snap = snapshot([branch('a')]);
  const out = String(tools.fileBranches.run({ goal: 'Webhooks', branches: ['a', 'ghost'] }, ctxFor(snap, door(snap).act())));
  assert.match(out, /a: filed under "Webhooks"/);
  assert.match(out, /Not found \(1\): ghost/);
});

test('deleting a goal leaves its branches unfiled and says how many', () => {
  const g = goals.createGoal({ title: 'Old' });
  goals.assignBranch({ repoKey: 'o/r', branch: 'a' }, g.id);
  const snap = snapshot([branch('a')]);
  const out = String(tools.deleteGoal.run({ goal: 'old' }, ctxFor(snap, door(snap).act())));
  assert.match(out, /Goal "Old" deleted \(1 branch now unfiled\)/);
  assert.equal(goals.goalOf({ repoKey: 'o/r', branch: 'a' }), null);
});

test('with changes off, no change tool is even offered', () => {
  const { asks } = scripted([JSON.stringify({ answer: 'ok' })]);
  const snap = snapshot([branch('a')]);
  return desk.ask(snap, 'file a under X', settings({ agentEnabled: false }), { act: door(snap).act }).then(() => {
    for (const name of ['file(', 'update_goal(', 'delete_goal(', 'set_purpose(', 'queue(']) {
      assert.ok(!asks[0]!.includes(name), `${name} should not be offered`);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — the notebook, the brief, the board
// ---------------------------------------------------------------------------

test('"from now on, lead the brief with anything red" is kept, followed, and rewrites the brief', () => {
  const snap = snapshot([branch('a')]);
  const s = settings();
  const keyBefore = brief.briefKey(snap, s);
  const d = door(snap);
  const out = String(tools.rememberNote.run({ text: 'Lead with anything red', for: 'brief' }, ctxFor(snap, d.act())));

  assert.match(out, /For the brief: "Lead with anything red"/);
  assert.deepEqual(d.queued, [{ kind: 'brief', subject: { kind: 'fleet' } }], 'the brief is rewritten with it at once');
  assert.notEqual(brief.briefKey(snap, s), keyBefore, 'a cached brief no longer counts as current');
  assert.match(brief.buildBriefPrompt(snap, 10), /THE OWNER'S INSTRUCTIONS FOR THE BRIEF[^\n]*\n- Lead with anything red/);
});

test('a note for the conversation is in every prompt, with its id, and leaves the brief alone', () => {
  const snap = snapshot([branch('a')]);
  const d = door(snap);
  tools.rememberNote.run({ text: 'Payments work ships before search', for: 'conversation' }, ctxFor(snap, d.act()));
  const [note] = notebook.listNotes();

  assert.equal(d.queued.length, 0);
  assert.doesNotMatch(brief.buildBriefPrompt(snap, 10), /Payments work/);
  assert.match(desk.buildAskPrompt(snap, 'what next?', 60), new RegExp(`id ${note!.id} · remember · Payments work ships before search`));
});

test('the same note twice is refused, and a note is forgotten by id or by its words', () => {
  const snap = snapshot([branch('a')]);
  const act = door(snap).act();
  act.remember('remember', 'Search is paused');
  assert.deepEqual(act.remember('remember', 'search is paused').refused, ['that is already in the notebook']);

  const [note] = notebook.listNotes();
  assert.match(String(tools.forgetNote.run({ note: note!.id }, ctxFor(snap, act))), /Note removed: "Search is paused"/);
  assert.deepEqual(notebook.listNotes(), []);

  act.remember('remember', 'Webhooks first');
  assert.equal(act.forget('Webhooks first').done.length, 1, 'by its exact words');
  assert.match(act.forget('nothing like this').refused[0]!, /no note/);
});

test('forgetting a brief instruction undoes, and the undo says the brief needs writing again', () => {
  const snap = snapshot([branch('a')]);
  const d = door(snap);
  d.act('t1').remember('brief', 'Keep it to three lines');
  const [note] = notebook.listNotes('brief');
  d.act('t2').forget(note!.id);
  assert.deepEqual(notebook.listNotes(), []);

  const removed = record.turnEntries('t2').find((e) => e.kind === 'note')!;
  const result = undo.undoChange(removed.id);
  assert.equal(result.ok, true);
  assert.equal(result.brief, true, 'the route rewrites the brief on this');
  assert.deepEqual(notebook.listNotes(), [note], 'the same note, same id, back');
});

test('undo all takes a note back out, and queuing work is never offered as undoable', () => {
  const snap = snapshot([branch('a')]);
  door(snap).act('p').remember('brief', 'Lead with red');
  const entries = record.turnEntries('p');
  assert.deepEqual(entries.map((e) => [e.kind, e.undoable]), [['note', true], ['queue', false]]);
  const results = undo.undoTurn('p');
  assert.ok(results.find((r) => r.id === entries[0]!.id)?.ok);
  assert.deepEqual(notebook.listNotes(), []);
});

test('the board reads the floor in words, and parked work can be retried by id or all at once', () => {
  const job = (id: string, state: 'working' | 'waiting' | 'parked', error: string | null = null) => ({
    id, kind: 'summarise' as const, title: `Reading ${id}`, subject: { kind: 'fleet' as const }, origin: 'routine' as const,
    state, startedAt: null, attempts: state === 'parked' ? 2 : 0, toolCalls: 0, doing: null, error,
  });
  const snap = snapshot([branch('a')]);
  snap.work.jobs = [job('j1', 'working'), job('j2', 'waiting'), job('j3', 'parked', 'the reply was empty'), job('j4', 'parked')];

  const board = String(tools.readBoard.run({}, ctxFor(snap, null)));
  assert.match(board, /Running \(1\): Reading j1/);
  assert.match(board, /Waiting \(1\): Reading j2/);
  assert.match(board, /id j3 · Reading j3 · the reply was empty/);
  assert.match(board, /id j4 · Reading j4 · failed twice/);

  const d = door(snap);
  const one = String(tools.retryParked.run({ jobs: ['j3', 'j1'] }, ctxFor(snap, d.act())));
  assert.deepEqual(d.retried, ['j3']);
  assert.match(one, /Tried again: Reading j3/);
  assert.match(one, /j1 is not parked/);

  tools.retryParked.run({ jobs: ['all'] }, ctxFor(snap, d.act()));
  assert.deepEqual(d.retried, ['j3', 'j3', 'j4']);
  assert.throws(() => tools.retryParked.run({ jobs: [] }, ctxFor(snap, d.act())), types.ToolError);
});
