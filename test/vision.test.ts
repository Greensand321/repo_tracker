/**
 * Vision — the store, the parsers, and the questions it raises.
 *
 * Two things here are load-bearing and everything else is detail:
 *
 *   1. Editing a vision invalidates its assessment; merely confirming one does not.
 *      A comparison drawn against words you have since rewritten is confidently about
 *      something that no longer exists.
 *   2. Nothing the model returns is trusted. An invented branch, an unknown goal, a
 *      branch overtaking itself — all dropped rather than shown to the owner.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { Branch, Goal, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';
import { parseAssessment, parseDistribution, parseDraft } from '../server/advise/vision.ts';
import { briefKey, parseBrief } from '../server/advise/brief.ts';
import { questions, verdictChip, verdictLabel } from '../web/derive.ts';

const dir = mkdtempSync(join(tmpdir(), 'bearing-vision-'));
process.env['BEARING_DATA_DIR'] = dir;
const store = await import('../server/vision.ts');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const REF = { repoKey: 'greensand321/repo_tracker', branch: 'claude/kind-meitner-cpis9v' };

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'greensand321/repo_tracker',
    name,
    headSha: 'aaaaaaa1111',
    url: '',
    commits: [
      { sha: 'abc1234def', message: 'first', body: '', author: 'claude', authoredAt: '2026-09-17T10:00:00Z', url: '' },
      { sha: 'def5678abc', message: 'second', body: '', author: 'claude', authoredAt: '2026-09-16T10:00:00Z', url: '' },
    ],
    ahead: 2,
    behind: 0,
    lastActivity: '2026-09-17T10:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 },
    activity: [],
    pr: null,
    ci: { state: 'none', url: null },
    relevance: 'active',
    isBase: false,
    goalId: null,
    vision: null,
    assessment: null,
    title: null,
    summary: null,
    progress: null,
    insight: null, recap: null, commitsFrom: 'ahead',
    ...over,
  };
}

function goal(id: string, over: Partial<Goal> = {}): Goal {
  return {
    id, title: id, note: '', milestone: '', branches: [], done: false,
    judgement: null, createdAt: '', updatedAt: '', ...over,
  };
}

function snap(branches: Branch[], goals: Goal[] = []): Snapshot {
  return {
    generatedAt: '2026-09-17T13:42:08Z',
    repos: [{ key: 'greensand321/repo_tracker', owner: 'greensand321', name: 'repo_tracker', defaultBranch: 'main', branchCount: 9, url: '' }],
    branches, goals, brief: null, work: { jobs: [], workers: 2, finished: [] }, warnings: [], rateLimit: null,
    llm: { enabled: true, pending: 0, errors: [] },
  };
}

const settings: Settings = { ...DEFAULT_SETTINGS, llmModel: 'test-model' };

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('a vision remembers whose words it is', () => {
  store.clearVision(REF);
  const v = store.setVision(REF, '  Build the broadsheet  ', 'proposed', { from: '23 commits', draftedAt: 'aaa' });
  assert.equal(v.text, 'Build the broadsheet', 'trimmed');
  assert.equal(v.state, 'proposed');
  assert.equal(v.from, '23 commits');
});

test('an empty vision is refused rather than stored as a blank yardstick', () => {
  assert.throws(() => store.setVision(REF, '   ', 'yours'), /needs some words/);
});

test('confirming keeps the words, so the assessment drawn against them survives', () => {
  store.clearVision(REF);
  store.setVision(REF, 'Build the broadsheet', 'proposed');
  store.putAssessment(REF, {
    verdict: 'on-track', because: 'it is', evidence: [], overtakenBy: null, looked: [],
    model: 'test-model', promptVersion: 'v1', generatedAt: '', headSha: 'head1',
    visionText: 'Build the broadsheet',
  });

  const confirmed = store.confirmVision(REF);

  assert.equal(confirmed.state, 'confirmed');
  assert.ok(
    store.getAssessment(REF, 'head1', 'Build the broadsheet', 'v1', 'test-model'),
    'confirming does not throw away the comparison',
  );
});

test('rewriting the vision throws away the assessment drawn against the old one', () => {
  store.clearVision(REF);
  store.setVision(REF, 'Build the broadsheet', 'proposed');
  store.putAssessment(REF, {
    verdict: 'on-track', because: 'it is', evidence: [], overtakenBy: null, looked: [],
    model: 'test-model', promptVersion: 'v1', generatedAt: '', headSha: 'head1',
    visionText: 'Build the broadsheet',
  });

  store.setVision(REF, 'Actually, build the goal store', 'yours');

  assert.equal(
    store.getAssessment(REF, 'head1', 'Actually, build the goal store', 'v1', 'test-model'),
    null,
    'the yardstick moved, so the comparison says nothing',
  );
});

test('an assessment of a head you have moved past is not served', () => {
  store.clearVision(REF);
  store.setVision(REF, 'A vision', 'yours');
  store.putAssessment(REF, {
    verdict: 'done', because: '', evidence: [], overtakenBy: null, looked: [],
    model: 'test-model', promptVersion: 'v1', generatedAt: '', headSha: 'old',
    visionText: 'A vision',
  });
  assert.equal(store.getAssessment(REF, 'new', 'A vision', 'v1', 'test-model'), null);
});

test('applyVisions drops an assessment that no longer matches, rather than showing it', () => {
  store.clearVision(REF);
  store.setVision(REF, 'A vision', 'yours');
  store.putAssessment(REF, {
    verdict: 'done', because: '', evidence: [], overtakenBy: null, looked: [],
    model: 'test-model', promptVersion: 'v1', generatedAt: '', headSha: 'old',
    visionText: 'A vision',
  });

  const s = snap([branch(REF.branch, { headSha: 'moved-on' })]);
  store.applyVisions(s, 'v1', 'test-model');

  assert.equal(s.branches[0]!.vision?.text, 'A vision', 'the vision survives the branch moving');
  assert.equal(s.branches[0]!.assessment, null, 'the comparison does not');
});

test('clearing is a real answer and takes the assessment with it', () => {
  store.setVision(REF, 'A vision', 'yours');
  store.clearVision(REF);
  assert.equal(store.getVision(REF), null);
});

test('pruning forgets branches that are gone', () => {
  store.setVision(REF, 'A vision', 'yours');
  assert.ok(store.pruneVisions(new Set(), new Set([REF.repoKey])) >= 1);
  assert.equal(store.getVision(REF), null);
});

test('pruning never touches a repo this read did not reach', () => {
  // A repo GitHub would not serve just now is missing from the snapshot, not deleted. One
  // bad connection at startup used to take every vision the owner had written for it.
  store.setVision(REF, 'A vision', 'yours');
  assert.equal(store.pruneVisions(new Set(), new Set()), 0);
  assert.equal(store.getVision(REF)?.text, 'A vision');
});

// ---------------------------------------------------------------------------
// Reading what the model said
// ---------------------------------------------------------------------------

test('a draft comes back with what it was drawn from', () => {
  const d = parseDraft('{"vision": "Replace the native select", "from": "6 commits"}');
  assert.deepEqual(d, { text: 'Replace the native select', from: '6 commits' });
});

test('declining to draft is a result, not a failure', () => {
  const d = parseDraft('{"vision": null, "why": "too scattered to name one purpose"}');
  assert.equal(d.text, null);
  assert.match((d as { why: string }).why, /scattered/);
});

test('a reply that is not JSON declines rather than throwing', () => {
  assert.equal(parseDraft('I think this branch is about the picker.').text, null);
});

test('an assessment keeps only evidence the branch actually contains', () => {
  const b = branch('x');
  const r = parseAssessment(
    '{"verdict":"drifted","because":"doing the settings sheet instead","evidence":["abc1234","9999999"]}',
    b,
  );
  assert.equal(r.verdict, 'drifted');
  assert.deepEqual(r.evidence, ['abc1234'], 'the invented SHA is dropped, not rendered');
});

test('an unknown verdict falls back to unclear rather than being trusted', () => {
  assert.equal(parseAssessment('{"verdict":"excellent","because":"","evidence":[]}', branch('x')).verdict, 'unclear');
});

test('a branch cannot call itself overtaken — that needs the whole fleet', () => {
  const r = parseAssessment('{"verdict":"overtaken","because":"done elsewhere","evidence":[]}', branch('x'));
  assert.equal(r.verdict, 'unclear', 'only the brief, which sees everything, may say this');
});

test('a reply wrapped in prose is still read, as long as the JSON is there', () => {
  const out = parseDistribution(
    'Sure! Here you go:\n{"visions":[{"repo":"greensand321/repo_tracker","branch":"gui-updates","vision":"The picker"}]}',
    [branch('gui-updates')],
  );
  assert.equal(out.length, 1);
});

test('distribution only ever names branches that exist', () => {
  const real = [branch('gui-updates'), branch('claude/kind-meitner-cpis9v')];
  const out = parseDistribution(
    JSON.stringify({
      visions: [
        { repo: 'greensand321/repo_tracker', branch: 'gui-updates', vision: 'The picker', suggest: 'close' },
        { repo: 'greensand321/repo_tracker', branch: 'not-a-real-branch', vision: 'Invented' },
      ],
    }),
    real,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ref.branch, 'gui-updates');
  assert.equal(out[0]!.suggest, 'close');
});

test('distribution does not propose the same branch twice', () => {
  const real = [branch('gui-updates')];
  const out = parseDistribution(
    JSON.stringify({
      visions: [
        { repo: 'greensand321/repo_tracker', branch: 'gui-updates', vision: 'One' },
        { repo: 'greensand321/repo_tracker', branch: 'gui-updates', vision: 'Two' },
      ],
    }),
    real,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.vision, 'One');
});

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

test('the brief ignores a judgement about a goal that does not exist', () => {
  const s = snap([branch('a')], [goal('g1')]);
  const r = parseBrief(
    JSON.stringify({ brief: 'ok', goals: [{ id: 'nope', state: 'looks-done', because: '' }], overtaken: [] }),
    s,
    settings,
  );
  assert.equal(r.judgements.size, 0);
});

test('a judgement cites only branches that are actually under that goal', () => {
  const s = snap(
    [branch('a'), branch('b')],
    [goal('g1', { branches: [{ repoKey: 'greensand321/repo_tracker', branch: 'a' }] })],
  );
  const r = parseBrief(
    JSON.stringify({
      brief: '', overtaken: [],
      goals: [{ id: 'g1', state: 'progressing', because: 'moving', branches: ['a', 'b'] }],
    }),
    s,
    settings,
  );
  assert.deepEqual(r.judgements.get('g1')!.evidence.map((e) => e.branch), ['a']);
});

test('a branch cannot be overtaken by itself', () => {
  const s = snap([branch('a')]);
  const r = parseBrief(
    JSON.stringify({
      brief: '', goals: [],
      overtaken: [{ repo: 'greensand321/repo_tracker', branch: 'a', byRepo: 'greensand321/repo_tracker', byBranch: 'a', why: 'x' }],
    }),
    s,
    settings,
  );
  assert.deepEqual(r.overtaken, []);
});

test('overtaken by a branch that does not exist is dropped', () => {
  const s = snap([branch('a')]);
  const r = parseBrief(
    JSON.stringify({
      brief: '', goals: [],
      overtaken: [{ repo: 'greensand321/repo_tracker', branch: 'a', byRepo: 'greensand321/repo_tracker', byBranch: 'ghost', why: 'x' }],
    }),
    s,
    settings,
  );
  assert.deepEqual(r.overtaken, []);
});

test('the brief cache key moves when a head moves', () => {
  const before = briefKey(snap([branch('a', { headSha: 'one' })]), settings);
  const after = briefKey(snap([branch('a', { headSha: 'two' })]), settings);
  assert.notEqual(before, after);
});

test('the brief cache key moves when a vision is rewritten', () => {
  const v = (text: string) => ({ text, state: 'yours' as const, from: '', draftedAt: null, createdAt: '', updatedAt: '' });
  const before = briefKey(snap([branch('a', { vision: v('one') })]), settings);
  const after = briefKey(snap([branch('a', { vision: v('two') })]), settings);
  assert.notEqual(before, after);
});

test('the brief cache key is stable when nothing has changed', () => {
  assert.equal(briefKey(snap([branch('a')]), settings), briefKey(snap([branch('a')]), settings));
});

// ---------------------------------------------------------------------------
// The questions it raises
// ---------------------------------------------------------------------------

const proposed = { text: 'A guess', state: 'proposed' as const, from: '', draftedAt: null, createdAt: '', updatedAt: '' };
const mine = { text: 'Mine', state: 'yours' as const, from: '', draftedAt: null, createdAt: '', updatedAt: '' };
const drifted = {
  verdict: 'drifted' as const, because: 'doing something else', evidence: [], overtakenBy: null, looked: [],
  model: 'm', promptVersion: 'v1', generatedAt: '', headSha: 'aaaaaaa1111', visionText: 'Mine',
};

test('work going wrong is asked about before setup questions', () => {
  const s = snap([
    branch('needs-confirming', { vision: proposed }),
    branch('has-drifted', { vision: mine, assessment: drifted }),
  ]);
  assert.deepEqual(questions(s, 5).map((q) => q.kind), ['drift', 'confirm-vision']);
});

test('quiet branches are never asked about — most of a hundred are quiet', () => {
  const s = snap([branch('sleeping', { relevance: 'quiet', vision: proposed })]);
  assert.deepEqual(questions(s, 5), []);
});

test('the cap holds, because a wall of questions is a chore list', () => {
  const s = snap([
    branch('a', { vision: proposed }),
    branch('b', { vision: proposed }),
    branch('c', { vision: proposed }),
  ]);
  assert.equal(questions(s, 2).length, 2);
  assert.equal(questions(s, 0).length, 0, 'zero switches them off entirely');
});

test('a goal the assistant thinks is finished is proposed, never assumed', () => {
  const s = snap([], [goal('g1', { judgement: { state: 'looks-done', because: 'all merged', evidence: [], model: 'm', promptVersion: 'v1', generatedAt: '' } })]);
  assert.deepEqual(questions(s, 5).map((q) => q.kind), ['goal-done']);
});

test('a goal the owner already marked done stops asking', () => {
  const s = snap([], [goal('g1', { done: true, judgement: { state: 'looks-done', because: '', evidence: [], model: 'm', promptVersion: 'v1', generatedAt: '' } })]);
  assert.deepEqual(questions(s, 5), []);
});

test('a branch with a vision the owner wrote raises nothing on its own', () => {
  assert.deepEqual(questions(snap([branch('settled', { vision: mine })]), 5), []);
});

test('"done" never reads as "merged" — they are different claims', () => {
  assert.match(verdictLabel('done'), /vision met/);
  assert.doesNotMatch(verdictLabel('done'), /merged/);
});

test('the chip form of a verdict is never truncated into nonsense', () => {
  // "done — vision met" clipped to "ion met" in the register once. It is short now.
  for (const v of ['on-track', 'drifted', 'done', 'overtaken', 'unclear'] as const) {
    assert.ok(verdictChip(v).length <= 11, `${v}: ${verdictChip(v)}`);
  }
});

test('one budget for the whole read, and only the dispatcher may spend it', async () => {
  // Drafting was capped and assessing was not, so a read that had just been given forty
  // visions would then assess all forty — past the ceiling that exists so a first run
  // cannot surprise you with a bill. Now there is one budget, in one place, and a station
  // that helped itself to its own cap is the bug this is here to prevent coming back.
  const fs = await import('node:fs');
  const stations = new URL('../server/advise/', import.meta.url);
  for (const file of fs.readdirSync(stations)) {
    const src = fs.readFileSync(new URL(file, stations), 'utf8');
    assert.doesNotMatch(src, /llmMaxPerRun/, `${file} must not cap spending itself`);
  }

  const dispatcher = fs.readFileSync(new URL('../server/work/run.ts', import.meta.url), 'utf8');
  assert.match(dispatcher, /let budget = settings\.llmMaxPerRun/, 'one budget, in the dispatcher');
});

test('the brief key knows which branches are under a goal, not only how many', () => {
  // Moving one branch between two goals of equal size changes what every judgement rests
  // on, and used to leave the key exactly as it was.
  const goal = (id: string, names: string[]) => ({
    id, title: id, note: '', milestone: '', done: false, judgement: null, createdAt: 'x', updatedAt: 'x',
    branches: names.map((n) => ({ repoKey: 'o/r', branch: n })),
  });
  const before = briefKey({ ...snap([branch('a'), branch('b')]), goals: [goal('g1', ['a']), goal('g2', ['b'])] }, settings);
  const after = briefKey({ ...snap([branch('a'), branch('b')]), goals: [goal('g1', ['b']), goal('g2', ['a'])] }, settings);
  assert.notEqual(before, after);
});

test('the brief comes back in three parts, and as one text for anything that reads it whole', () => {
  const r = parseBrief(
    JSON.stringify({ done: 'Webhooks landed.', next: 'Fix the red CI on a.', now: 'b is mid-refactor.', goals: [], overtaken: [] }),
    snap([branch('a'), branch('b')]),
    settings,
  );
  assert.deepEqual(r.parts, { done: 'Webhooks landed.', next: 'Fix the red CI on a.', now: 'b is mid-refactor.' });
  assert.equal(r.brief, 'Webhooks landed. Fix the red CI on a. b is mid-refactor.');
});

test('a brief in the old single-paragraph shape still reads', () => {
  const r = parseBrief(JSON.stringify({ brief: 'All quiet.', goals: [], overtaken: [] }), snap([branch('a')]), settings);
  assert.equal(r.brief, 'All quiet.');
  assert.equal(r.parts, null);
});
