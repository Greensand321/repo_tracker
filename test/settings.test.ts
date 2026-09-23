/**
 * Settings are the owner's (Q79): one table of tunables drives the clamps, the route, the
 * agent's read and its suggestions, and reset to defaults. The agent reads them — never the
 * secrets — and suggests; only the owner applies.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TUNABLES, coerceTunable, tunable } from '../shared/settings.ts';
import { DEFAULT_SETTINGS, type Settings, type Snapshot } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-settings-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let store: typeof import('../server/settings.ts');
let desk: typeof import('../server/advise/ask.ts');
let tools: typeof import('../server/tools/agent.ts');
let catalog: typeof import('../server/tools/catalog.ts');
let thread: typeof import('../server/advise/conversation.ts');

before(async () => {
  store = await import('../server/settings.ts');
  desk = await import('../server/advise/ask.ts');
  tools = await import('../server/tools/agent.ts');
  catalog = await import('../server/tools/catalog.ts');
  thread = await import('../server/advise/conversation.ts');
});

afterEach(() => {
  for (const file of readdirSync(TEMP)) rmSync(join(TEMP, file), { recursive: true, force: true });
  thread.forget();
});

const snap = (): Snapshot => ({
  generatedAt: '2026-09-23T12:00:00Z', repos: [], branches: [], warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: true, pending: 0, errors: [] },
});

const settings = (over: Partial<Settings> = {}): Settings =>
  ({ ...DEFAULT_SETTINGS, token: 'ghp_secret', llmApiKey: 'sk-secret', llmModel: 'm', repos: ['o/r'], ...over });

// ---------------------------------------------------------------------------
// One table
// ---------------------------------------------------------------------------

test('the table holds every number and switch, and nothing that is who you are', () => {
  const tunables = Object.entries(DEFAULT_SETTINGS)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')
    .map(([k]) => k)
    .sort();
  assert.deepEqual(TUNABLES.map((t) => t.key).sort(), tunables, 'a new setting must be added to the table');
  for (const key of ['token', 'llmApiKey', 'repos', 'llmBaseUrl', 'llmModel']) assert.equal(tunable(key), null, key);
  for (const t of TUNABLES) {
    if (t.type !== 'number') continue;
    const d = DEFAULT_SETTINGS[t.key] as number;
    assert.ok(d >= t.min && d <= t.max, `${t.key}'s default ${d} is outside ${t.min}–${t.max}`);
  }
});

test('the store clamps to the table\'s ranges, and a switch is off only when it is false', () => {
  const saved = store.saveSettings({ askBranchCap: 9999, nowLineWords: 1, agentHistory: 10, agentEnabled: false, toolsEnabled: 'no' as unknown as boolean });
  assert.equal(saved.askBranchCap, 400);
  assert.equal(saved.nowLineWords, 5);
  assert.equal(saved.agentHistory, 50);
  assert.equal(saved.agentEnabled, false);
  assert.equal(saved.toolsEnabled, true);
  assert.deepEqual(store.loadSettings(), saved, 'and that is what is on disk');
});

test('a suggested value is coerced like the owner typed it, or refused', () => {
  const cap = tunable('askBranchCap')!;
  assert.equal(coerceTunable(cap, '120'), 120);
  assert.equal(coerceTunable(cap, 120.6), 121);
  assert.equal(coerceTunable(cap, 10_000), 400);
  assert.equal(coerceTunable(cap, 'lots'), null);
  const sw = tunable('agentEnabled')!;
  assert.equal(coerceTunable(sw, false), false);
  assert.equal(coerceTunable(sw, 'on'), true);
  assert.equal(coerceTunable(sw, 1), null);
});

// ---------------------------------------------------------------------------
// The agent reads them
// ---------------------------------------------------------------------------

test('the agent can read every setting, and never a secret', () => {
  const { token: _t, llmApiKey: _k, ...safe } = settings();
  const ctx = { snapshot: snap(), settings: { ...safe, hasToken: true, hasLlmKey: false }, branch: null, now: new Date(), github: null, act: null };
  const out = String(tools.readSettings.run({}, ctx));
  for (const t of TUNABLES) assert.match(out, new RegExp(`\\b${t.key} = `), t.key);
  assert.match(out, /askBranchCap = 60 \(default 60, 1–400\)/);
  assert.match(out, /GitHub token set · model key missing/);
  assert.doesNotMatch(out, /secret/);
});

test('reading them is always on offer; nothing on offer writes one', () => {
  const names = catalog.agentTools(settings()).map((t) => t.name);
  assert.ok(names.includes('settings'));
  assert.ok(catalog.agentTools(settings({ agentEnabled: false })).some((t) => t.name === 'settings'), 'read-only mode reads them too');
  assert.ok(!names.some((n) => /setting/.test(n) && n !== 'settings'), `no tool changes a setting: ${names.join(', ')}`);
});

// ---------------------------------------------------------------------------
// And suggests
// ---------------------------------------------------------------------------

test('suggestions are checked: real tunables only, in range, changed, at most three', () => {
  const current = settings({ askBranchCap: 60 });
  const r = desk.parseAnswer(
    JSON.stringify({
      answer: 'You have 200 branches; I would show more of them.',
      settings: [
        { setting: 'askBranchCap', to: 9000, why: 'most of the register is one line' },
        { setting: 'token', to: 'x' },
        { setting: 'llmModel', to: 'another' },
        { setting: 'madeUp', to: 3 },
        { setting: 'askBranchCap', to: 100 },
        { setting: 'refreshSeconds', to: 60 },
        { setting: 'agentEnabled', to: 'off', why: 'you asked' },
        { setting: 'workers', to: 3 },
        { setting: 'dispatchWorkers', to: 3 },
      ],
    }),
    snap(),
    current,
  );
  assert.deepEqual(r.suggestions.map((x) => [x.setting, x.from, x.to]), [
    ['askBranchCap', 60, 400],
    ['agentEnabled', true, false],
    ['workers', 2, 3],
  ]);
  assert.equal(r.suggestions[0]!.label, 'Branches');
  assert.equal(r.suggestions[0]!.why, 'most of the register is one line');
});

test('a suggestion reaches the answer, and the agent changed no setting', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    answer: 'I cannot change settings, but more steps would let me finish.',
    settings: [{ setting: 'agentCallsPerQuestion', to: 20, why: 'it ran out of steps twice' }],
  }) } }] }), { status: 200 })) as typeof fetch;
  try {
    const before = store.saveSettings({});
    const answer = await desk.ask(snap(), 'why do you keep stopping?', settings());
    assert.deepEqual(answer.suggestions.map((x) => [x.setting, x.from, x.to]), [['agentCallsPerQuestion', 12, 20]]);
    assert.deepEqual(store.loadSettings(), before, 'nothing on disk moved');
    assert.equal(answer.unbacked, false, 'a suggestion is not a claim');
    assert.match(thread.transcript(thread.recall(30)), /You suggested settings, which only the owner can apply: Steps 12 → 20/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('it is told it may only suggest', () => {
  for (const mode of ['act', 'read'] as const) {
    assert.match(desk.systemFor(mode), /"settings" tool/);
    assert.match(desk.systemFor(mode), /Change a setting\. You may only suggest one/);
  }
});
