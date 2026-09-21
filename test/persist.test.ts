/**
 * What survives the program closing — and what a bad read must not be allowed to take.
 *
 * Everything the assistant writes is paid for. Losing it between sessions is not a
 * display bug; it is the same bill twice.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS, refKey } from '../shared/types.ts';
import { readJson, writeJson } from '../server/jsonfile.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-persist-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let store: typeof import('../server/advise/store.ts');
let visions: typeof import('../server/vision.ts');
let assist: typeof import('../server/advise/assist.ts');
let board: typeof import('../server/work/board.ts');
let goals: typeof import('../server/goals.ts');

before(async () => {
  store = await import('../server/advise/store.ts');
  visions = await import('../server/vision.ts');
  assist = await import('../server/advise/assist.ts');
  board = await import('../server/work/board.ts');
  goals = await import('../server/goals.ts');
});

afterEach(() => {
  for (const file of readdirSync(TEMP)) rmSync(join(TEMP, file), { recursive: true, force: true });
  store.resetInsightCache();
  visions.resetVisionCache();
  assist.resetAssistCache();
  goals.resetGoalCache();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  token: 'gh', repos: ['o/r', 'o/s'], llmApiKey: 'key', llmModel: 'test-model',
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
    vision: null, assessment: null, title: null, summary: null, progress: null, insight: null, ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-18T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: false, pending: 0, errors: [] },
});

const insight = (repoKey: string, name: string, generatedAt = '2026-09-18T11:00:00Z') =>
  store.putInsight(repoKey, name, {
    title: 'T', summary: 'S', progress: 'progressing',
    meta: { evidence: [], model: 'test-model', promptVersion: 'v1', generatedAt, headSha: `sha-${name}` },
  });

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------

test('a write leaves no temporary file behind and reads back whole', () => {
  const file = join(TEMP, 'thing.json');
  writeJson(file, { a: 1 });
  writeJson(file, { a: 2 });
  assert.deepEqual(readJson(file), { a: 2 });
  assert.deepEqual(readdirSync(TEMP), ['thing.json'], 'nothing else on disk');
});

test('a file that cannot be read is set aside, never overwritten', () => {
  // Treating a torn file as empty meant the next write replaced a hundred summaries with
  // one. The broken copy is kept under another name so nothing is lost twice.
  const file = join(TEMP, 'insights.json');
  writeFileSync(file, '{"half": "of a fi', 'utf8');

  assert.equal(readJson(file), null);
  assert.equal(existsSync(file), false, 'moved out of the way');
  const aside = readdirSync(TEMP).find((f) => f.startsWith('insights.json.broken-'));
  assert.ok(aside, 'kept under a name that says what happened');
  assert.equal(readFileSync(join(TEMP, aside!), 'utf8'), '{"half": "of a fi');

  writeJson(file, { fresh: true });
  assert.ok(readdirSync(TEMP).includes(aside!), 'the broken copy survives the next write');
});

test('a missing file is the normal first run, not a broken one', () => {
  assert.equal(readJson(join(TEMP, 'never.json')), null);
  assert.deepEqual(readdirSync(TEMP), []);
});

test('every store survives a restart, exactly as written', () => {
  insight('o/r', 'a');
  visions.setVision({ repoKey: 'o/r', branch: 'a' }, 'A purpose', 'yours');
  const goal = goals.createGoal({ title: 'G' });
  goals.assignBranch({ repoKey: 'o/r', branch: 'a' }, goal.id);

  // A new process reads from disk, not from the module's memory.
  store.resetInsightCache();
  visions.resetVisionCache();
  goals.resetGoalCache();

  assert.equal(store.getInsight('o/r', 'a', 'sha-a', 'v1', 'test-model')?.summary, 'S');
  assert.equal(visions.getVision({ repoKey: 'o/r', branch: 'a' })?.text, 'A purpose');
  assert.equal(goals.listGoals()[0]?.branches.length, 1);
});

// ---------------------------------------------------------------------------
// Pruning — only ever within what the read actually saw
// ---------------------------------------------------------------------------

test('a repo GitHub would not serve keeps every summary, vision and filing it had', () => {
  // One bad connection at startup left the snapshot without the repo — and pruning
  // against that snapshot deleted everything written about it, then paid to write the
  // summaries again. Missing from a read is not deleted from GitHub.
  insight('o/r', 'a');
  insight('o/s', 'b');
  visions.setVision({ repoKey: 'o/r', branch: 'a' }, 'For a', 'yours');
  visions.setVision({ repoKey: 'o/s', branch: 'b' }, 'For b', 'yours');
  const goal = goals.createGoal({ title: 'G' });
  goals.assignBranch({ repoKey: 'o/r', branch: 'a' }, goal.id);
  goals.assignBranch({ repoKey: 'o/s', branch: 'b' }, goal.id);

  // This read reached o/r only, and o/r still has branch a.
  const live = new Set([refKey('o/r', 'a')]);
  const reached = new Set(['o/r']);
  assert.equal(store.pruneInsights(live, reached), 0);
  assert.equal(visions.pruneVisions(live, reached), 0);
  assert.equal(goals.pruneGoals(live, reached), 0);

  assert.ok(store.getInsight('o/s', 'b', 'sha-b', 'v1', 'test-model'), 'the unreachable repo is untouched');
  assert.equal(visions.getVision({ repoKey: 'o/s', branch: 'b' })?.text, 'For b');
  assert.equal(goals.listGoals()[0]?.branches.length, 2);
});

test('a branch deleted from a repo the read did reach is pruned', () => {
  insight('o/r', 'a');
  insight('o/r', 'gone');
  const live = new Set([refKey('o/r', 'a')]);
  assert.equal(store.pruneInsights(live, new Set(['o/r'])), 1);
  assert.ok(store.getInsight('o/r', 'a', 'sha-a', 'v1', 'test-model'));
  assert.equal(store.getInsight('o/r', 'gone', 'sha-gone', 'v1', 'test-model'), null);
});

test('an empty read prunes nothing at all', () => {
  // The worst case of the same bug: the machine wakes up before the network does, every
  // repo fails, and the snapshot is empty. Nothing about the fleet has changed.
  insight('o/r', 'a');
  visions.setVision({ repoKey: 'o/r', branch: 'a' }, 'For a', 'yours');
  assert.equal(store.pruneInsights(new Set(), new Set()), 0);
  assert.equal(visions.pruneVisions(new Set(), new Set()), 0);
  assert.ok(store.getInsight('o/r', 'a', 'sha-a', 'v1', 'test-model'));
});

// ---------------------------------------------------------------------------
// The brief — the dearest call, and how often it is made
// ---------------------------------------------------------------------------

const briefReply = (brief = 'All quiet.') =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ brief, goals: [], overtaken: [] }) } }] }),
    { status: 200 },
  );

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a routine rewrite of the brief waits its interval; asking for one does not', async () => {
  const config = settings({ briefEveryMinutes: 15 });
  globalThis.fetch = (async () => briefReply()) as typeof fetch;

  const first = snapshot([branch('a')]);
  await assist.writeTheBrief(first, config);
  const writtenAt = Date.parse(assist.briefWrittenAt()!);

  // The fleet moves. The routine board does not rewrite the brief for another quarter hour.
  const moved = snapshot([branch('a', { headSha: 'sha-a2' })]);
  assist.applyAssist(moved, config);
  const soon = new Date(writtenAt + 5 * 60_000);
  const later = new Date(writtenAt + 16 * 60_000);
  assert.equal(board.deriveBoard(moved, config, soon).filter((j) => j.kind === 'brief').length, 0);
  assert.equal(board.deriveBoard(moved, config, later).filter((j) => j.kind === 'brief').length, 1);

  // 0 is the old behaviour: every read.
  assert.equal(board.deriveBoard(moved, settings({ briefEveryMinutes: 0 }), soon).filter((j) => j.kind === 'brief').length, 1);
});

test('between rewrites the last brief stays up, dated and marked as behind the fleet', async () => {
  const config = settings();
  globalThis.fetch = (async () => briefReply('Here it is.')) as typeof fetch;

  const first = snapshot([branch('a')]);
  await assist.writeTheBrief(first, config);
  assert.equal(first.brief?.stale, false);

  const moved = snapshot([branch('a', { headSha: 'sha-a2' })]);
  assist.applyAssist(moved, config);
  assert.equal(moved.brief?.text, 'Here it is.', 'shown, not hidden');
  assert.equal(moved.brief?.stale, true, 'and honest about it');
});

test('a reply with no brief in it fails the job rather than saving an empty one', async () => {
  const config = settings();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })) as typeof fetch;

  await assert.rejects(assist.writeTheBrief(snapshot([branch('a')]), config), /did not write a brief/);
  assert.equal(assist.briefWrittenAt(), null, 'nothing was saved');
});

test('an overtaken finding outlives the read it was made in, but not the vision it was made against', async () => {
  const config = settings();
  // Visions and verdicts live on disk, which is what the brief's apply pass reads.
  const judge = (name: string, purpose: string, headSha = `sha-${name}`): Branch => {
    const ref = { repoKey: 'o/r', branch: name };
    const vision = visions.setVision(ref, purpose, 'yours');
    visions.putAssessment(ref, {
      verdict: 'on-track', because: 'fine', evidence: [], overtakenBy: null, looked: [],
      model: 'test-model', promptVersion: 'v1', generatedAt: 'x', headSha, visionText: purpose,
    });
    return branch(name, { headSha, vision });
  };
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        brief: 'b did what a was for.',
        goals: [],
        overtaken: [{ repo: 'o/r', branch: 'a', byRepo: 'o/r', byBranch: 'b', why: 'b got there first' }],
      }) } }] }),
      { status: 200 },
    )) as typeof fetch;

  const first = snapshot([judge('a', 'Ship X'), judge('b', 'Ship X faster')]);
  await assist.writeTheBrief(first, config);
  assert.equal(first.branches[0]!.assessment?.verdict, 'overtaken');

  // The fleet moves but a's purpose stands: still overtaken.
  const moved = snapshot([judge('a', 'Ship X', 'sha-a2'), judge('b', 'Ship X faster')]);
  assist.applyAssist(moved, config);
  assert.equal(moved.brief?.stale, true);
  assert.equal(moved.branches[0]!.assessment?.verdict, 'overtaken');

  // The owner rewrites what a is for: the old finding was never about this purpose.
  const rewritten = snapshot([judge('a', 'Ship Y', 'sha-a2'), judge('b', 'Ship X faster')]);
  assist.applyAssist(rewritten, config);
  assert.equal(rewritten.branches[0]!.assessment?.verdict, 'on-track');
});
