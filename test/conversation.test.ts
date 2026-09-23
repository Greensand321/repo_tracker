/**
 * The advisor remembers what was said, for a while.
 *
 * There is no process being kept alive between questions — every one is a stateless
 * request — so all "context" means here is a bounded transcript we send again, and the
 * idle timer is on what we remember (D93). The state is always the current one.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

process.env['BEARING_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'bearing-conv-'));

let desk: typeof import('../server/advise/ask.ts');
let thread: typeof import('../server/advise/conversation.ts');

before(async () => {
  desk = await import('../server/advise/ask.ts');
  thread = await import('../server/advise/conversation.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  thread.forget();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh', repos: ['o/r'], llmApiKey: 'key', llmModel: 'test-model', toolsEnabled: false,
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
  generatedAt: '2026-09-21T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: true, pending: 0, errors: [] },
});

/** Answers each turn in order, and keeps what it was sent. */
function replies(texts: string[]): { sent: string[]; sessions: string[] } {
  const sent: string[] = [];
  const sessions: string[] = [];
  let i = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(String(init.body));
    sessions.push(String((init.headers as Record<string, string>)['x-opencode-session'] ?? ''));
    const answer = texts[Math.min(i++, texts.length - 1)]!;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer }) } }] }), { status: 200 });
  }) as typeof fetch;
  return { sent, sessions };
}

// ---------------------------------------------------------------------------

test('the first question starts cold; the next one sees what was said', async () => {
  const config = settings();
  const { sent } = replies(['claude/a is the busiest.', 'It is mid-refactor.']);
  const snap = snapshot([branch('a')]);

  const first = await desk.ask(snap, 'which branch is busiest?', config);
  assert.equal(first.inThread, 0);
  assert.doesNotMatch(sent[0]!, /EARLIER IN THIS CONVERSATION/);

  const second = await desk.ask(snap, 'and what is it doing?', config);
  assert.equal(second.inThread, 1, 'it had the first exchange in front of it');
  assert.match(sent[1]!, /EARLIER IN THIS CONVERSATION/);
  assert.match(sent[1]!, /which branch is busiest\?/);
  assert.match(sent[1]!, /claude\/a is the busiest\./);
  assert.match(sent[1]!, /LATEST QUESTION: and what is it doing\?/);
});

test('every turn is answered from the state as it is now, not as it was said to be', async () => {
  const config = settings();
  const { sent } = replies(['One branch.', 'Two now.']);
  await desk.ask(snapshot([branch('a')]), 'how many?', config);

  // The fleet moves between turns. The second prompt carries the new state, and says so.
  await desk.ask(snapshot([branch('a'), branch('b')]), 'and now?', config);
  assert.match(sent[1]!, /o\/r b/, 'the new branch is in the prompt');
  assert.match(sent[1]!, /is what you must answer from/);
});

test('it forgets after the quiet window, and 0 keeps nothing at all', async () => {
  const minute = 60_000;
  thread.remember('q', 'a', {}, 0);
  assert.equal(thread.recall(30, 29 * minute).length, 1, 'still warm');
  assert.equal(thread.recall(30, 31 * minute).length, 0, 'gone cold');
  assert.equal(thread.recall(30, 31 * minute + 1).length, 0, 'and stays gone');

  thread.remember('q', 'a', {}, 0);
  assert.equal(thread.recall(0, 0).length, 0, 'memory off');
});

test('the transcript is bounded, oldest first out', async () => {
  for (let i = 0; i < 9; i++) thread.remember(`q${i}`, `a${i}`, {}, 1000);
  const kept = thread.recall(30, 1000);
  assert.equal(kept.length, 6);
  assert.equal(kept[0]!.question, 'q3', 'the oldest three were dropped');
  assert.equal(kept[5]!.question, 'q8');
});

test('a long answer is trimmed rather than carried whole', () => {
  thread.remember('q', 'x'.repeat(5000), {}, 1000);
  assert.ok(thread.recall(30, 1000)[0]!.answer.length <= 700);
});

test('one conversation is one session on the provider, and a new thread is a new one', async () => {
  const config = settings({ llmBaseUrl: 'https://opencode.ai/zen/v1' });
  const { sessions } = replies(['a', 'b', 'c']);
  const snap = snapshot([branch('a')]);

  await desk.ask(snap, 'one', config);
  await desk.ask(snap, 'two', config);
  assert.equal(sessions[0], sessions[1], 'the register is the same prefix; keep it cached');

  thread.forget();
  await desk.ask(snap, 'three', config);
  assert.notEqual(sessions[2], sessions[1]);
});

test('a question that failed leaves nothing behind to be confused by', async () => {
  const config = settings();
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  await assert.rejects(desk.ask(snapshot([branch('a')]), 'this one breaks', config));
  assert.equal(thread.recall(30).length, 0);
});

test('starting a fresh thread forgets what was said and nothing else', async () => {
  const config = settings();
  const { sent } = replies(['first', 'second']);
  const snap = snapshot([branch('a')]);
  await desk.ask(snap, 'one', config);
  thread.forget();

  const next = await desk.ask(snap, 'two', config);
  assert.equal(next.inThread, 0);
  assert.doesNotMatch(sent[1]!, /EARLIER IN THIS CONVERSATION/);
  assert.match(sent[1]!, /o\/r a/, 'the state is still all there');
});

test('it can see the work it set going, so "did that finish?" has an answer', async () => {
  const config = settings();
  const { sent } = replies(['started it']);
  const snap = snapshot([branch('a')]);
  const job = {
    id: 'j', kind: 'summarise' as const, title: 'Reading a again',
    subject: { kind: 'branch' as const, repoKey: 'o/r', branch: 'a' }, origin: 'dispatched' as const,
    state: 'working' as const, startedAt: 'x', attempts: 1, toolCalls: 0, doing: null, error: null,
  };
  snap.work = { workers: 2, jobs: [job], finished: [{ ...job, id: 'f', state: 'done', title: 'Writing the brief again', finishedAt: 'x' }] };

  await desk.ask(snap, 'did that finish?', config);
  assert.match(sent[0]!, /still running: Reading a again/);
  assert.match(sent[0]!, /just finished: Writing the brief again/);
});
