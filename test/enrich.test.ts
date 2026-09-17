import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

// The store writes to disk, so point it somewhere disposable before anything imports it.
const TEMP = mkdtempSync(join(tmpdir(), 'bearing-test-'));
process.env['BEARING_DATA_DIR'] = TEMP;

type EnrichModule = typeof import('../server/advise/enrich.ts');
type StoreModule = typeof import('../server/advise/store.ts');
let advise: EnrichModule;
let store: StoreModule;

before(async () => {
  advise = await import('../server/advise/enrich.ts');
  store = await import('../server/advise/store.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(join(TEMP, 'insights.json'), { force: true });
  store.resetInsightCache();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh',
  repos: ['o/r'],
  llmApiKey: 'key',
  llmModel: 'test-model',
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
  llm: { enabled: false, pending: 0, errors: [] },
});

/** A provider that answers every call the same way, and counts how often it was asked. */
function stubProvider(reply: unknown, status = 200): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return state;
}

const goodReply = {
  choices: [{ message: { content: JSON.stringify({
    title: 'A real title', summary: 'It does a thing.', progress: 'progressing', evidence: ['abc1234'],
  }) } }],
};

test('summaries land on the branches and are cached for next time', async () => {
  const snap = snapshot([branch('a'), branch('b')]);
  const calls = stubProvider(goodReply);

  advise.applyCached(snap, settings());
  assert.equal(snap.llm.pending, 2);

  const result = await advise.enrich(snap, settings());
  assert.equal(result.summarised, 2);
  assert.equal(calls.calls, 2);
  assert.equal(snap.branches[0]!.title, 'A real title');
  assert.equal(snap.branches[0]!.progress, 'progressing');
  assert.equal(snap.llm.pending, 0);

  // A second snapshot at the same head SHAs must cost nothing.
  const again = snapshot([branch('a'), branch('b')]);
  advise.applyCached(again, settings());
  assert.equal(again.llm.pending, 0, 'cached summaries should apply for free');
  assert.equal(again.branches[0]!.summary, 'It does a thing.');
  const after = await advise.enrich(again, settings());
  assert.equal(after.summarised, 0);
  assert.equal(calls.calls, 2, 'no further provider calls');
});

test('a branch that moved is re-summarised', async () => {
  const first = snapshot([branch('a')]);
  const calls = stubProvider(goodReply);
  advise.applyCached(first, settings());
  await advise.enrich(first, settings());

  const moved = snapshot([branch('a', { headSha: 'sha-a-moved' })]);
  advise.applyCached(moved, settings());
  assert.equal(moved.llm.pending, 1, 'the cached summary describes the old head');
  await advise.enrich(moved, settings());
  assert.equal(calls.calls, 2);
});

test('a rejected API key stops the run instead of failing 50 times', async () => {
  const many = Array.from({ length: 50 }, (_, i) => branch(`b${i}`));
  const snap = snapshot(many);
  const calls = stubProvider({ error: { message: 'bad key' } }, 401);

  advise.applyCached(snap, settings());
  const result = await advise.enrich(snap, settings());

  assert.ok(calls.calls < 5, `should have stopped early, made ${calls.calls} calls`);
  assert.equal(result.summarised, 0);
  assert.ok(result.errors.some((e) => /repeat for every branch/.test(e)));
});

test('one unparseable reply does not stop the others', async () => {
  const snap = snapshot([branch('a'), branch('b')]);
  let first = true;
  globalThis.fetch = (async () => {
    const content = first ? 'I cannot help with that' : JSON.stringify({
      title: 'Fine', summary: 'Fine.', progress: 'done', evidence: [],
    });
    first = false;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;

  advise.applyCached(snap, settings());
  const result = await advise.enrich(snap, settings());
  assert.equal(result.summarised, 1);
  assert.equal(result.failed, 1);
});

test('the base branch and empty branches are never sent to the model', async () => {
  const snap = snapshot([
    branch('main', { isBase: true }),
    branch('empty', { commits: [] }),
    branch('real'),
  ]);
  const calls = stubProvider(goodReply);

  advise.applyCached(snap, settings());
  assert.equal(snap.llm.pending, 1);
  await advise.enrich(snap, settings());
  assert.equal(calls.calls, 1, 'only the branch with commits of its own');
});

test('llmMaxPerRun caps what one refresh can spend', async () => {
  const snap = snapshot(Array.from({ length: 10 }, (_, i) => branch(`b${i}`)));
  const calls = stubProvider(goodReply);

  advise.applyCached(snap, settings());
  await advise.enrich(snap, settings({ llmMaxPerRun: 3 }));
  assert.equal(calls.calls, 3);
});

test('with no key or no model the advisor is simply off, not broken', async () => {
  for (const missing of [{ llmApiKey: '' }, { llmModel: '' }, { llmEnabled: false }]) {
    const snap = snapshot([branch('a')]);
    const calls = stubProvider(goodReply);
    const config = settings(missing);

    assert.equal(advise.llmReady(config), false);
    advise.applyCached(snap, config);
    assert.equal(snap.llm.enabled, false);
    const result = await advise.enrich(snap, config);
    assert.equal(result.summarised, 0);
    assert.equal(calls.calls, 0, 'no provider call without full configuration');
  }
});
