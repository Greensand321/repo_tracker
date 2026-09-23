/**
 * Through the real server modules, end to end: a read, the board, the desk, a regrouping
 * accepted, a read that fails, and a run that outlives its read. The other files test the
 * parts; this one checks the wiring between them — which is where the review found its bugs.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-e2e-'));
process.env['BEARING_DATA_DIR'] = TEMP;
writeFileSync(join(TEMP, 'settings.json'), JSON.stringify({
  token: 'gh', repos: ['greensand321/harbor-api'], llmApiKey: 'key', llmModel: 'test-model',
  refreshSeconds: 0, toolsEnabled: true, briefEveryMinutes: 0, llmMaxPerRun: 40,
}));

const gh = {
  failRepo: false,
  featureSha: 'bbb1111bbb1111',
};
const provider = { slow: 0, deskReplies: [] as string[], calls: 0 };
let fresh: string | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', etag: `"${Math.random()}"` } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.github.com')) {
    if (gh.failRepo) return new Response('boom', { status: 500 });
    if (/\/repos\/greensand321\/harbor-api$/.test(url)) return json({ name: 'harbor-api', owner: { login: 'greensand321' }, default_branch: 'main', html_url: 'https://github.com/greensand321/harbor-api' });
    if (url.includes('/branches')) return json([{ name: 'main', commit: { sha: 'aaa0000aaa0000' } }, { name: 'feat/retry', commit: { sha: gh.featureSha } }]);
    if (url.includes('/pulls')) return json([]);
    if (url.includes('/compare/')) return json({ ahead_by: 1, behind_by: 0, commits: [{ sha: gh.featureSha, html_url: 'u', commit: { message: 'Add retry', author: { name: 'c', date: '2026-09-15T00:00:00Z' } } }], files: [] });
    if (url.includes('/actions/runs')) return json({ workflow_runs: [] });
    if (url.includes('/status')) return json({ state: 'success', total_count: 0, statuses: [] });
    if (url.includes('/readme')) return new Response('', { status: 404 });
    return new Response('unexpected github call ' + url, { status: 500 });
  }
  // the provider
  provider.calls++;
  if (provider.slow) await new Promise((r) => setTimeout(r, provider.slow));
  const body = String(init?.body ?? '');
  let content: string;
  if (body.includes('You are a personal assistant')) content = JSON.stringify({ brief: 'All quiet.', goals: [], overtaken: [] });
  else if (body.includes('You are the agent inside Bearing')) content = provider.deskReplies.shift() ?? JSON.stringify({ answer: 'Nothing to say.' });
  else if (body.includes('propose what it is FOR')) content = JSON.stringify({ vision: null, why: 'too thin' });
  else content = JSON.stringify({ title: 'Retrying webhooks', summary: `Summary ${provider.calls}.`, progress: 'progressing', evidence: [] });
  return json({ choices: [{ message: { content } }] });
}) as typeof fetch;

let state: typeof import('../server/state.ts');
let routes: typeof import('../server/routes.ts');

before(async () => {
  state = await import('../server/state.ts');
  routes = await import('../server/routes.ts');
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}
const feature = () => state.currentResponse().snapshot?.branches.find((b) => b.name === 'feat/retry');
const idle = () => {
  const s = state.currentResponse().snapshot;
  return !!s && !state.currentResponse().refreshing && s.work.jobs.every((j) => j.state !== 'working' && j.state !== 'waiting');
};
const insights = () => JSON.parse(readFileSync(join(TEMP, 'insights.json'), 'utf8')) as Record<string, { summary: string }>;

test('first read: the branch is summarised and the summary is on disk', async () => {
  state.startPolling();
  await until(() => !!feature()?.summary && idle(), 'the first summary');
  assert.equal(Object.keys(insights()).length, 1);
  assert.equal(feature()!.summary, 'Summary 1.');
});

test('the desk can start work and propose a regrouping; the work lands and the proposal files on acceptance', async () => {
  provider.deskReplies = [
    JSON.stringify({ tool: 'queue', args: { kind: 'summarise', branches: ['greensand321/harbor-api feat/retry'] } }),
    JSON.stringify({ answer: 'Started re-reading feat/retry; it lands on the page. I would file it under Webhooks.',
      groups: [{ title: 'Webhooks', branches: [{ repo: 'greensand321/harbor-api', branch: 'feat/retry' }] }] }),
  ];
  const res = await routes.api.request('/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'read feat/retry again and file it' }) });
  const payload = await res.json() as { answer: { changes: { text: string }[]; groups: { title: string; branches: { repoKey: string; branch: string }[] }[]; text: string } };
  assert.equal(res.status, 200, JSON.stringify(payload));
  assert.equal(payload.answer.changes.length, 1);
  assert.equal(payload.answer.groups.length, 1);

  await until(() => state.currentResponse().snapshot!.work.finished.length === 1 && idle(), 'the dispatched summary to land');
  assert.notEqual(feature()!.summary, 'Summary 1.', 'replaced by a fresh answer');
  fresh = feature()!.summary;
  const disk = JSON.parse(readFileSync(join(TEMP, 'dispatched.json'), 'utf8')) as { jobs: unknown[] };
  assert.equal(disk.jobs.length, 0, 'cleared once it landed');

  const filed = await routes.api.request('/goals/regroup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: payload.answer.groups, turn: 'accepted-turn' }) });
  const result = await filed.json() as { moved: number; changes: { text: string }[]; goals: { id: string; title: string; branches: unknown[] }[] };
  assert.equal(result.moved, 1);
  assert.deepEqual(result.changes.map((c) => c.text), ['Goal "Webhooks" created', 'feat/retry: filed under "Webhooks"'], 'recorded, so undoable');
  assert.equal(result.goals[0]!.title, 'Webhooks');
  assert.equal(feature()!.goalId, result.goals[0]!.id, 'on the page at once');
});

test('a read that cannot reach the repo takes nothing with it', async () => {
  gh.failRepo = true;
  await state.refresh();
  const s = state.currentResponse().snapshot!;
  assert.equal(s.branches.length, 0, 'the read really did fail');
  assert.ok(s.warnings.length > 0);
  assert.equal(Object.keys(insights()).length, 1, 'the summary is still on disk');
  const goals = JSON.parse(readFileSync(join(TEMP, 'goals.json'), 'utf8')) as { goals: { branches: unknown[] }[] };
  assert.equal(goals.goals[0]!.branches.length, 1, 'and the filing');
  gh.failRepo = false;
  await state.refresh();
  await until(() => !!feature()?.summary && idle(), 'the fleet back');
  assert.equal(feature()!.summary, fresh, 'nothing was paid for again');
});

test('a run that outlives its read hands its results to the read on screen', async () => {
  gh.featureSha = 'ccc2222ccc2222';   // the branch moves: a summary job exists again
  provider.slow = 300;
  const before = provider.calls;
  await state.refresh();              // collect done; the slow run is now in flight on this snapshot
  assert.equal(feature()!.summary, null);
  await state.refresh();              // a second read replaces the snapshot while the run is going
  const replaced = state.currentResponse().snapshot!;
  assert.equal(replaced.branches.find((b) => b.name === 'feat/retry')!.summary, null, 'not yet');
  await until(() => !!feature()?.summary, 'the summary to be carried over', 4000);
  assert.ok(provider.calls > before);
  assert.equal(state.currentResponse().snapshot!.branches.find((b) => b.name === 'feat/retry')!.summary, feature()!.summary);
  provider.slow = 0;
  await until(idle, 'quiet');
  state.stopPolling();
});
