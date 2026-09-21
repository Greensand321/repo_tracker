/**
 * The desk: the advisor answers from what it sees, may look at how things moved, and may
 * put work on the board — never do it. Rankings are answers; regroupings are proposals.
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
let tool: typeof import('../server/tools/desk.ts');
let goals: typeof import('../server/goals.ts');
let types: typeof import('../server/tools/types.ts');

before(async () => {
  desk = await import('../server/advise/ask.ts');
  tool = await import('../server/tools/desk.ts');
  goals = await import('../server/goals.ts');
  types = await import('../server/tools/types.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const file of readdirSync(TEMP)) rmSync(join(TEMP, file), { recursive: true, force: true });
  goals.resetGoalCache();
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
    ahead: 2, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null,
    vision: null, assessment: null, title: null, summary: null, progress: null, insight: null, ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-18T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
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

const door = () => {
  const calls: { kind: JobKind; subject: JobSubject }[] = [];
  return { calls, dispatch: (kind: JobKind, subject: JobSubject) => void calls.push({ kind, subject }) };
};

const ctxFor = (snap: Snapshot, dispatch: ((kind: JobKind, subject: JobSubject) => void) | null) => {
  const { token: _t, llmApiKey: _k, ...safe } = settings();
  return { snapshot: snap, settings: { ...safe, hasToken: true, hasLlmKey: true }, branch: null, now: new Date(), github: null, dispatch };
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
  const snap = snapshot([branch('a'), branch('b')]);
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
    snap,
  );
  assert.equal(r.text, 'b first.');
  assert.deepEqual(r.ranking.map((x) => x.ref.branch), ['b', 'a']);
  assert.equal(r.ranking[0]!.why, 'red CI');
});

test('a regrouping keeps only real branches, one group each, and drops a group with nothing in it', () => {
  const snap = snapshot([branch('a'), branch('b'), branch('c')]);
  const r = desk.parseAnswer(
    JSON.stringify({
      answer: 'Two groups.',
      groups: [
        { title: 'Webhooks', branches: [{ repo: 'o/r', branch: 'a' }, { repo: 'o/r', branch: 'ghost' }] },
        { title: 'Also webhooks', branches: [{ repo: 'o/r', branch: 'a' }] },
        { title: '', branches: [{ repo: 'o/r', branch: 'b' }] },
        { title: 'Unfiled', branches: [{ repo: 'o/r', branch: 'c' }] },
      ],
    }),
    snap,
  );
  assert.deepEqual(
    r.groups.map((g) => [g.title, g.branches.map((b) => b.branch)]),
    [['Webhooks', ['a']], ['Unfiled', ['c']]],
  );
});

test('the prompt carries what each branch is for and how it compares, not only its commits', () => {
  const snap = snapshot([
    branch('a', {
      vision: vision('Ship X', 'proposed'),
      summary: 'It ships X.',
      assessment: { verdict: 'drifted', because: 'went elsewhere', evidence: [], overtakenBy: null, looked: [], model: 'm', promptVersion: 'v', generatedAt: 'x', headSha: 'sha-a', visionText: 'Ship X' },
    }),
  ]);
  const prompt = desk.buildAskPrompt(snap, 'what?', 60);
  assert.match(prompt, /FOR: Ship X \(my guess/);
  assert.match(prompt, /DID: It ships X\./);
  assert.match(prompt, /COMPARED: drifted — went elsewhere/);
});

// ---------------------------------------------------------------------------
// The one write
// ---------------------------------------------------------------------------

test('dispatch queues through the door it was handed, and only what the page could ask for', () => {
  const d = door();
  const snap = snapshot([branch('a', { vision: vision('For a') }), branch('b')]);
  const ctx = ctxFor(snap, d.dispatch);

  assert.match(String(tool.dispatchWork.run({ kind: 'assess', repo: 'o/r', branch: 'a' }, ctx)), /Queued: checking a/);
  assert.match(String(tool.dispatchWork.run({ kind: 'brief' }, ctx)), /Queued: writing the brief/);
  assert.deepEqual(d.calls, [
    { kind: 'assess', subject: { kind: 'branch', repoKey: 'o/r', branch: 'a' } },
    { kind: 'brief', subject: { kind: 'fleet' } },
  ]);

  // Refused the way the page's buttons are refused, in words the model can act on.
  assert.throws(() => tool.dispatchWork.run({ kind: 'assess', repo: 'o/r', branch: 'b' }, ctx), types.ToolError);
  assert.throws(() => tool.dispatchWork.run({ kind: 'draft-vision', repo: 'o/r', branch: 'a' }, ctx), /already said/);
  assert.throws(() => tool.dispatchWork.run({ kind: 'polish', repo: 'o/r', branch: 'a' }, ctx), /not a kind of work/);
  assert.throws(() => tool.dispatchWork.run({ kind: 'summarise', repo: 'o/r', branch: 'nope' }, ctx), /no branch "nope"/);
  assert.equal(d.calls.length, 2, 'none of those reached the board');
});

test('a station is never handed the door', () => {
  const ctx = ctxFor(snapshot([branch('a')]), null);
  assert.throws(() => tool.dispatchWork.run({ kind: 'brief' }, ctx), /may not start/);
});

// ---------------------------------------------------------------------------
// The desk, end to end against a stub
// ---------------------------------------------------------------------------

test('the advisor can start work, and says so without describing a result it has not seen', async () => {
  const d = door();
  const asked = scripted([
    JSON.stringify({ tool: 'dispatch', args: { kind: 'summarise', repo: 'o/r', branch: 'a' } }),
    JSON.stringify({ answer: 'I have started reading a again; it will land on the page.' }),
  ]);

  const answer = await desk.ask(snapshot([branch('a')]), 'read a again', settings(), { dispatch: d.dispatch });

  assert.equal(asked.asks.length, 2, 'the tool call, then the answer');
  assert.deepEqual(d.calls, [{ kind: 'summarise', subject: { kind: 'branch', repoKey: 'o/r', branch: 'a' } }]);
  assert.equal(answer.started.length, 1);
  assert.match(answer.started[0]!, /Queued: reading a again/);
  assert.deepEqual(answer.looked, []);
  assert.match(answer.text, /started reading a again/);
  assert.match(asked.asks[1]!, /Queued: reading a again/, 'the model was told what happened');
});

test('the advisor can look at how things moved before answering', async () => {
  const asked = scripted([
    JSON.stringify({ tool: 'what_changed', args: { days: 3 } }),
    JSON.stringify({ answer: 'Nothing was recorded yet.' }),
  ]);
  const answer = await desk.ask(snapshot([branch('a')]), 'what moved?', settings());
  assert.deepEqual(answer.looked, ['what_changed']);
  assert.match(asked.asks[1]!, /Nothing was recorded/);
  assert.equal(answer.text, 'Nothing was recorded yet.');
});

test('with lookups off the desk is one turn, as before', async () => {
  const asked = scripted([JSON.stringify({ answer: 'Just this.' })]);
  const answer = await desk.ask(snapshot([branch('a')]), 'hello', settings({ toolsEnabled: false }));
  assert.equal(asked.asks.length, 1);
  assert.doesNotMatch(asked.asks[0]!, /dispatch\(/, 'no tools were offered');
  assert.equal(answer.text, 'Just this.');
});

// ---------------------------------------------------------------------------
// Accepting a regrouping
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
  const after = goals.listGoals();
  assert.deepEqual(after.map((g) => g.title).sort(), ['Search', 'Webhooks'], 'matched by title, whatever the case');
  assert.deepEqual(after.find((g) => g.title === 'Webhooks')!.branches.map((b) => b.branch), ['a']);
  assert.deepEqual(after.find((g) => g.title === 'Search')!.branches.map((b) => b.branch), ['b']);
});
