/**
 * The tool layer: the loop, the budget, and the two free tools.
 *
 * What is being protected here is that a worker with tools stays **bounded and honest**.
 * The loop must terminate whatever the model does — including asking for a tool that does
 * not exist, asking for the same one forever, or asking for one after it has run out —
 * and everything the model sends is untrusted input, arguments included.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-tools-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let converse: typeof import('../server/advise/converse.ts');
let free: typeof import('../server/tools/free.ts');
let catalog: typeof import('../server/tools/catalog.ts');
let toolTypes: typeof import('../server/tools/types.ts');

before(async () => {
  converse = await import('../server/advise/converse.ts');
  free = await import('../server/tools/free.ts');
  catalog = await import('../server/tools/catalog.ts');
  toolTypes = await import('../server/tools/types.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(join(TEMP, 'history'), { recursive: true, force: true });
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  llmApiKey: 'key',
  llmModel: 'test-model',
  llmBaseUrl: 'https://opencode.ai/zen/v1',
  ...over,
});

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'claude', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    ahead: 2, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null,
    vision: null, assessment: null, title: null, summary: null, progress: null, insight: null, ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-17T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2 }, llm: { enabled: true, pending: 0, errors: [] },
});

const ctx = (branches: Branch[], subject: Branch | null, over: Partial<Settings> = {}) => {
  // A tool is handed SafeSettings, never Settings: it cannot leak a token it never had.
  const { token: _t, llmApiKey: _k, ...safe } = settings(over);
  return {
    snapshot: snapshot(branches),
    settings: { ...safe, hasToken: true, hasLlmKey: true },
    branch: subject,
    now: new Date('2026-09-17T12:00:00Z'),
  };
};

/** Replies in order, then repeats the last one. Records what it was asked. */
function scripted(replies: string[]): { asks: string[] } {
  const state = { asks: [] as string[] };
  let i = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    state.asks.push(String(init?.body ?? ''));
    const content = replies[Math.min(i++, replies.length - 1)] ?? '';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return state;
}

const FINAL = '{"verdict":"on-track","because":"it matches","evidence":[]}';

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test('a reply with no tool call is the answer, handed back untouched', async () => {
  const asks = scripted([FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches], ctx: ctx([branch('a')], branch('a')),
    sessionId: 's',
  });

  assert.equal(result.text, FINAL, 'the station parses its own answer, unchanged');
  assert.equal(result.uses.length, 0);
  assert.equal(asks.asks.length, 1, 'no tools, no extra calls');
});

test('a tool call is run and its result comes back in the next prompt', async () => {
  const asks = scripted(['{"tool":"sibling_branches","args":{"limit":2}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr',
    tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b'), branch('c')], branch('a')),
    sessionId: 's',
  });

  assert.equal(result.uses.length, 1);
  assert.equal(result.uses[0]!.name, 'sibling_branches');
  assert.equal(result.uses[0]!.failed, false);
  assert.match(asks.asks[1]!, /you asked for sibling_branches/);
  assert.match(asks.asks[1]!, /o\/r b/, 'the result is in the second prompt');
  assert.equal(result.text, FINAL);
});

test('with no tools it is exactly one plain call', async () => {
  const asks = scripted([FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });
  assert.equal(asks.asks.length, 1);
  assert.equal(result.uses.length, 0);
  assert.doesNotMatch(asks.asks[0]!, /BEFORE ANSWERING/, 'no tool preamble when there are none');
});

test('a model that only ever asks for tools still terminates, at the budget', async () => {
  // The worst case, and the one that has to be impossible: it never answers.
  const asks = scripted(['{"tool":"sibling_branches","args":{}}']);
  await assert.rejects(
    () => converse.converse(settings({ toolCallsPerJob: 3 }), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
    }),
    /never answered/,
  );

  assert.equal(asks.asks.length, 4, 'three lookups, then one last turn to answer in');
  assert.match(asks.asks[3]!, /no lookups left/, 'and it was told so');
});

test('the same call twice is answered from what we already have', async () => {
  const asks = scripted([
    '{"tool":"sibling_branches","args":{"limit":2}}',
    '{"tool":"sibling_branches","args":{"limit":2}}',
    FINAL,
  ]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses.length, 2, 'it still costs budget, so a loop terminates');
  assert.match(result.uses[1]!.result, /already asked/);
  assert.equal(asks.asks.length, 3);
});

test('a tool that does not exist is a correction, not a crash', async () => {
  const asks = scripted(['{"tool":"rm_rf","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses[0]!.failed, true);
  assert.match(result.uses[0]!.result, /no tool called "rm_rf"/);
  assert.match(asks.asks[1]!, /sibling_branches/, 'and it is told what does exist');
  assert.equal(result.text, FINAL);
});

test('a tool that throws is reported to the model rather than failing the job', async () => {
  const angry = {
    name: 'angry', description: 'always fails', cost: 'free' as const, args: [],
    run: () => { throw new toolTypes.ToolError('that branch does not exist'); },
  };
  scripted(['{"tool":"angry","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [angry], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses[0]!.failed, true);
  assert.match(result.uses[0]!.result, /that branch does not exist/);
  assert.equal(result.text, FINAL);
});

test('a tool result too large to send is cut rather than blowing the prompt', async () => {
  const chatty = {
    name: 'chatty', description: 'says too much', cost: 'free' as const, args: [],
    run: () => 'x'.repeat(50_000),
  };
  scripted(['{"tool":"chatty","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [chatty], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.ok(result.uses[0]!.result.length < 5000, `was ${result.uses[0]!.result.length}`);
  assert.match(result.uses[0]!.result, /cut/);
});

test('the clock ends it even when the lookup budget has not', async () => {
  // Nothing sleeps here, so a deadline already in the past stands in for a slow provider.
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  const result = await converse.converse(settings({ toolCallsPerJob: 20, toolSeconds: 5 }), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });
  assert.equal(result.uses.length, 1, 'it did get one lookup');
  assert.equal(result.text, FINAL);
});

test('what the model sends is never trusted, arguments included', () => {
  const t = toolTypes;
  assert.equal(t.num({ days: '14' }, 'days', 7, 1, 90), 14, 'a number as text is still a number');
  assert.equal(t.num({ days: 100000 }, 'days', 7, 1, 90), 90, 'out of range is corrected, not used');
  assert.equal(t.num({ days: -5 }, 'days', 7, 1, 90), 1);
  assert.equal(t.num({ days: 'soon' }, 'days', 7, 1, 90), 7, 'nonsense falls back');
  assert.equal(t.num({}, 'days', 7, 1, 90), 7);
  assert.equal(t.str({ repo: ' o/r ' }, 'repo'), 'o/r');
  assert.throws(() => t.str({}, 'repo'), /required/);
});

test('readToolCall tells a call from an answer, and survives rubbish', () => {
  assert.deepEqual(converse.readToolCall('{"tool":"x","args":{"a":1}}'), { name: 'x', args: { a: 1 } });
  assert.deepEqual(converse.readToolCall('{"tool":"x"}'), { name: 'x', args: {} });
  assert.equal(converse.readToolCall(FINAL), null, 'a station answer is not a tool call');
  assert.equal(converse.readToolCall('I cannot help'), null);
  assert.equal(converse.readToolCall('{"tool":"","args":{}}'), null);
  assert.equal(converse.readToolCall('{"tool":123}'), null);
  // Arguments sent as an array are not arguments.
  assert.deepEqual(converse.readToolCall('{"tool":"x","args":[1,2]}'), { name: 'x', args: {} });
});

// ---------------------------------------------------------------------------
// The tools themselves
// ---------------------------------------------------------------------------

test('sibling_branches puts the same goal first, then the same repo', () => {
  const mine = branch('mine', { goalId: 'g1' });
  const sibling = branch('sibling', { goalId: 'g1', lastActivity: '2026-09-01T00:00:00Z' });
  const sameRepo = branch('same-repo', { lastActivity: '2026-09-16T00:00:00Z' });
  const elsewhere = branch('elsewhere', { repoKey: 'o/other', lastActivity: '2026-09-17T00:00:00Z' });

  const out = free.siblingBranches.run({}, ctx([mine, sibling, sameRepo, elsewhere], mine)) as string;
  const lines = out.split('\n').filter((l) => l.startsWith('- '));

  assert.match(lines[0]!, /sibling/, 'the same goal beats being more recent');
  assert.match(lines[1]!, /same-repo/);
  assert.match(lines[2]!, /elsewhere/);
  assert.doesNotMatch(out, /o\/r mine/, 'a branch is not its own sibling');
});

test('sibling_branches says so plainly when there is nothing to compare against', () => {
  const only = branch('only');
  assert.match(free.siblingBranches.run({}, ctx([only], only)) as string, /no other branches/);
});

test('what_changed reads the history this program has been keeping', () => {
  mkdirSync(join(TEMP, 'history'), { recursive: true });
  writeFileSync(
    join(TEMP, 'history', '2026-09.jsonl'),
    [
      { date: '2026-09-14', repo: 'o/r', branch: 'a', sha: 'one', commits: 2, ahead: 2, behind: 0, ci: 'passing', pr: 'none' },
      { date: '2026-09-17', repo: 'o/r', branch: 'a', sha: 'two', commits: 9, ahead: 9, behind: 0, ci: 'failing', pr: 'open' },
      { date: '2026-09-14', repo: 'o/r', branch: 'still', sha: 'x', commits: 1, ahead: 1, behind: 0, ci: 'none', pr: 'none' },
      { date: '2026-09-17', repo: 'o/r', branch: 'still', sha: 'x', commits: 1, ahead: 1, behind: 0, ci: 'none', pr: 'none' },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const out = free.whatChanged.run({ days: 7 }, ctx([branch('a')], branch('a'))) as string;
  assert.match(out, /THIS BRANCH.*\+7 commits/s);
  assert.match(out, /CI passing → failing/);
  assert.match(out, /PR none → open/);
  assert.match(out, /1 branches did not move at all/);
});

test('what_changed says the record is empty rather than saying nothing changed', () => {
  // A fresh install knows nothing, and that is a fact about the tool, not about the fleet.
  const out = free.whatChanged.run({ days: 7 }, ctx([branch('a')], branch('a'))) as string;
  assert.match(out, /Nothing was recorded/);
  assert.doesNotMatch(out, /did not move/);
});

// ---------------------------------------------------------------------------
// D74 — the tool set is part of the cache key
// ---------------------------------------------------------------------------

test('changing a station\'s tools changes its prompt version', async () => {
  const { assessVersion } = await import('../server/advise/vision.ts');

  const withTools = assessVersion(settings({ toolsEnabled: true }));
  const without = assessVersion(settings({ toolsEnabled: false }));

  assert.notEqual(withTools, without, 'answers drawn from different evidence are not the same answer');
  assert.equal(without, 'v1', 'no tools means the version it always had — nothing needless is regenerated');
  assert.equal(assessVersion(settings({ toolCallsPerJob: 0 })), 'v1', 'no lookups allowed is no tools');
  assert.equal(withTools, assessVersion(settings({ toolsEnabled: true })), 'and it is stable');
});

test('a station with no tools has an empty tag, and one with tools does not', () => {
  assert.equal(catalog.toolSetTag([]), '');
  assert.match(catalog.toolSetTag([free.siblingBranches]), /^\+t[0-9a-f]{4}$/);
  assert.notEqual(
    catalog.toolSetTag([free.siblingBranches]),
    catalog.toolSetTag([free.siblingBranches, free.whatChanged]),
  );
  assert.equal(
    catalog.toolSetTag([free.siblingBranches, free.whatChanged]),
    catalog.toolSetTag([free.whatChanged, free.siblingBranches]),
    'the order they are listed in is not a change',
  );
});

test('a tool is never handed a secret', async () => {
  // Its output goes straight into a prompt that goes straight to a provider, so the type
  // itself refuses: ToolContext carries SafeSettings, which has neither credential.
  const seen = ctx([branch('a')], branch('a'));
  assert.equal('token' in seen.settings, false);
  assert.equal('llmApiKey' in seen.settings, false);

  const fs = await import('node:fs');
  for (const file of fs.readdirSync(new URL('../server/tools/', import.meta.url))) {
    const src = fs.readFileSync(new URL(file, new URL('../server/tools/', import.meta.url)), 'utf8');
    assert.doesNotMatch(src, /settings\.token|llmApiKey/, `${file} must not reach for a credential`);
    assert.doesNotMatch(src, /writeFileSync|appendFileSync|execSync|spawn/, `${file} must not write anything`);
  }
});

test('a model that never answers fails the job rather than writing a junk verdict', async () => {
  // It used to hand the last tool call back as the answer. The station parsed it into a
  // verdict of "unclear" with no reason, and cached it — an accounting limit dressed up
  // as a judgement.
  scripted(['{"tool":"sibling_branches","args":{}}']);
  await assert.rejects(
    () => converse.converse(settings({ toolCallsPerJob: 2 }), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
    }),
    /never answered/,
  );
});

test('running out of budget mid-conversation is not a verdict either', async () => {
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  await assert.rejects(
    () => converse.converse(settings(), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
      spend: () => false,
    }),
    (err: Error) => err.name === 'BudgetError',
  );
});

test('it says so when it was pushed to answer, and the answer still counts', async () => {
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  const result = await converse.converse(settings({ toolCallsPerJob: 1 }), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });
  assert.equal(result.text, FINAL);
  assert.equal(result.hitBudget, true);
  assert.equal(result.uses.length, 1);
});
