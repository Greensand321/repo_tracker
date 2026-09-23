/**
 * The agent's record, undo, and the changes feed (D94, Q78, Q80, Q81).
 *
 * Autonomy without asking first is only safe if every change is written down, can be taken
 * back — singly or everything one prompt did — and cannot be taken back over newer work.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, JobKind, JobSubject, Snapshot } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-record-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let actions: typeof import('../server/agent/actions.ts');
let undo: typeof import('../server/agent/undo.ts');
let record: typeof import('../server/agent/record.ts');
let goals: typeof import('../server/goals.ts');
let visions: typeof import('../server/vision.ts');

before(async () => {
  actions = await import('../server/agent/actions.ts');
  undo = await import('../server/agent/undo.ts');
  record = await import('../server/agent/record.ts');
  goals = await import('../server/goals.ts');
  visions = await import('../server/vision.ts');
});

afterEach(() => {
  for (const file of readdirSync(TEMP)) rmSync(join(TEMP, file), { recursive: true, force: true });
  record.resetRecordCache();
  goals.resetGoalCache();
  visions.resetVisionCache();
});

function branch(name: string): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'c', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    commitsFrom: 'ahead', ahead: 1, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: [], pr: null, ci: { state: 'none', url: null },
    relevance: 'active', isBase: false, goalId: null, vision: null, assessment: null,
    title: null, summary: null, recap: null, progress: null, insight: null,
  };
}

const snap = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-23T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: true, pending: 0, errors: [] },
});

function door(s: Snapshot, turn = 'turn-1', keep = 500) {
  const queued: { kind: JobKind; subject: JobSubject }[] = [];
  let refreshed = 0;
  const act = actions.actionsFor({
    snapshot: s, turn, words: 'the owner said so', keep,
    dispatch: (kind, subject) => void queued.push({ kind, subject }),
    refresh: () => { refreshed++; goals.applyGoals(s); },
  });
  return { act, queued, refreshed: () => refreshed };
}

const ref = (name: string) => ({ repoKey: 'o/r', branch: name });
const where = (name: string) => goals.goalOf(ref(name));

// ---------------------------------------------------------------------------

test('filing is applied, recorded, listed for the answer, and on screen at once', () => {
  const s = snap([branch('a'), branch('b')]);
  const d = door(s);
  const result = d.act.file('Webhooks', s.branches);

  assert.deepEqual(result.done, ['Goal "Webhooks" created', 'a: filed under "Webhooks"', 'b: filed under "Webhooks"']);
  assert.equal(d.refreshed(), 1, 'one refresh for the whole batch');
  assert.ok(s.branches.every((b) => b.goalId !== null), 'the snapshot on screen already shows it');
  assert.equal(d.act.did().length, 3, 'what the answer lists comes from the record');
  assert.equal(record.feed().unseen, 3);
});

test('undo one change puts that one back and leaves the rest', () => {
  const s = snap([branch('a'), branch('b')]);
  const d = door(s);
  d.act.file('Webhooks', s.branches);
  const fileA = d.act.did().find((c) => c.text.startsWith('a:'))!;

  const result = undo.undoChange(fileA.id!);
  assert.equal(result.ok, true);
  assert.equal(where('a'), null);
  assert.notEqual(where('b'), null, 'b is still filed');
  assert.ok(record.feed().recent.find((c) => c.id === fileA.id)!.undone, 'the feed shows it undone');
  assert.equal(undo.undoChange(fileA.id!).ok, false, 'and it cannot be undone twice');
});

test('undo all reverts everything one prompt changed, in the order that unpicks it', () => {
  const s = snap([branch('a'), branch('b'), branch('c')]);
  const old = goals.createGoal({ title: 'Old' });
  goals.assignBranch(ref('c'), old.id);

  const d = door(s, 'the-prompt');
  d.act.file('Webhooks', s.branches); // creates the goal, files a and b, moves c
  d.act.updateGoal('Webhooks', { note: 'from the agent' });

  const results = undo.undoTurn('the-prompt');
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(where('a'), null);
  assert.equal(where('b'), null);
  assert.equal(where('c'), old.id, 'c went back where it was');
  assert.deepEqual(goals.listGoals().map((g) => g.title), ['Old'], 'the goal it created is gone too');
});

test('an undo never overwrites a change made since', () => {
  const s = snap([branch('a')]);
  const d = door(s);
  d.act.file('Webhooks', s.branches);
  const filed = d.act.did().find((c) => c.text.startsWith('a:'))!;

  // The owner moves it somewhere else by hand afterwards.
  const mine = goals.createGoal({ title: 'Mine' });
  goals.assignBranch(ref('a'), mine.id);

  const result = undo.undoChange(filed.id!);
  assert.equal(result.ok, false);
  assert.match(result.text, /moved since/);
  assert.equal(where('a'), mine.id, 'the owner\'s later choice stands');
});

test('a goal marked done is flagged, counted, and named until it is seen (Q78)', () => {
  const s = snap([branch('a')]);
  goals.createGoal({ title: 'Webhooks' });
  const d = door(s);
  d.act.updateGoal('webhooks', { done: true });

  const feed = record.feed();
  assert.equal(feed.recent[0]!.flag, 'goal-done');
  assert.equal(feed.goalsDone, 1);
  assert.match(feed.recent[0]!.text, /marked done/);
  assert.equal(feed.recent[0]!.words, 'the owner said so', 'with what was asked, to judge it against');

  record.markSeen('all');
  assert.equal(record.feed().goalsDone, 0);
  assert.equal(record.feed().unseen, 0);
});

test('a deleted goal comes back whole — except a branch filed elsewhere since', () => {
  const s = snap([branch('a'), branch('b')]);
  const goal = goals.createGoal({ title: 'Webhooks', note: 'keep this' });
  goals.assignBranch(ref('a'), goal.id);
  goals.assignBranch(ref('b'), goal.id);

  const d = door(s);
  d.act.deleteGoal('Webhooks');
  assert.equal(goals.listGoals().length, 0);

  const elsewhere = goals.createGoal({ title: 'Elsewhere' });
  goals.assignBranch(ref('b'), elsewhere.id);

  const [deleted] = d.act.did();
  const result = undo.undoChange(deleted!.id!);
  assert.equal(result.ok, true);
  assert.match(result.text, /b filed elsewhere since/);
  const back = goals.getGoal(goal.id)!;
  assert.equal(back.note, 'keep this', 'same id, same note');
  assert.deepEqual(back.branches.map((b) => b.branch), ['a']);
  assert.equal(where('b'), elsewhere.id);
});

test('a goal it created is not removed while branches are in it', () => {
  const s = snap([branch('a')]);
  const d = door(s);
  d.act.createGoal('Search');
  const [created] = d.act.did();
  goals.assignBranch(ref('a'), goals.listGoals()[0]!.id);
  const result = undo.undoChange(created!.id!);
  assert.equal(result.ok, false);
  assert.match(result.text, /has branches in it now/);
});

test('a guess never replaces the owner\'s words, and a vision change undoes', () => {
  const s = snap([branch('a'), branch('b')]);
  visions.setVision(ref('a'), 'My own words', 'yours');
  const d = door(s);
  const result = d.act.setVision([
    { branch: s.branches[0]!, text: 'A guess', yours: false },
    { branch: s.branches[1]!, text: 'Ship the thing', yours: false },
  ]);
  assert.equal(result.done.length, 1);
  assert.match(result.refused[0]!, /owner already said/);
  assert.equal(visions.getVision(ref('a'))?.text, 'My own words');
  assert.equal(visions.getVision(ref('b'))?.state, 'proposed', 'a guess is marked as one (D61)');

  const [set] = d.act.did();
  assert.equal(undo.undoChange(set!.id!).ok, true);
  assert.equal(visions.getVision(ref('b')), null);
});

test('queued work is listed but cannot be undone — it runs regardless', () => {
  const s = snap([branch('a')]);
  const d = door(s);
  d.act.queue('summarise', s.branches);
  assert.equal(d.queued.length, 1);
  const [queued] = d.act.did();
  const change = record.feed().recent.find((c) => c.id === queued!.id)!;
  assert.equal(change.undoable, false);
  assert.match(undo.undoChange(queued!.id!).text, /cannot be taken back/);
});

test('the record keeps the last N, a whole prompt at a time, and survives a restart (Q80)', () => {
  const s = snap([branch('a')]);
  // Four prompts, each making a goal and a filing: eight entries against a limit of five.
  for (let i = 0; i < 4; i++) door(s, `t${i}`, 5).act.file(`G${i}`, s.branches);
  record.resetRecordCache();
  const kept = record.allEntries();
  assert.equal(kept.length, 4, 'two whole prompts dropped, never half of one');
  assert.deepEqual([...new Set(kept.map((e) => e.turn))], ['t2', 't3']);
  assert.match(kept[kept.length - 1]!.text, /G3/, 'the newest survive');
});

test('a prompt bigger than the limit is kept whole, so undo all still undoes all of it', () => {
  const names = Array.from({ length: 12 }, (_, i) => `b${i}`);
  const s = snap(names.map(branch));
  door(s, 'old', 5).act.file('Old', [s.branches[0]!]);
  const d = door(s, 'big', 5);
  d.act.file('Big', s.branches);
  assert.equal(d.act.did().length, 13, 'the goal and all twelve filings are listed');
  assert.ok(record.allEntries().every((e) => e.turn === 'big'), 'older prompts made room');
  assert.ok(undo.undoTurn('big').every((r) => r.ok));
  assert.equal(goals.listGoals().find((g) => g.title === 'Big'), undefined, 'and all of it undoes');
});
