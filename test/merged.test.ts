/**
 * A branch merged with a merge commit has an empty compare — its work is already in the
 * base — and used to read "nothing of its own", for exactly the branches whose history
 * is most worth having. Its pull request remembers what it did (D89).
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SETTINGS, type Settings } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-merged-'));
process.env['BEARING_DATA_DIR'] = TEMP;

let collect: typeof import('../server/collect.ts');
before(async () => {
  collect = await import('../server/collect.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(join(TEMP, 'cache'), { recursive: true, force: true });
});

const settings: Settings = { ...DEFAULT_SETTINGS, token: 'gh', repos: ['o/r'] };

const commit = (sha: string, message: string, date: string) => ({
  sha, html_url: 'u', commit: { message, author: { name: 'c', date }, committer: null }, author: null,
});

/** GitHub as it looks for one merged branch and one live one. Counts each call. */
function github(): { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { etag: '"e"' } });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls[path] = (calls[path] ?? 0) + 1;
    if (path === '/repos/o/r') return json({ name: 'r', owner: { login: 'o' }, default_branch: 'main', html_url: 'h' });
    if (path === '/repos/o/r/branches') return json([
      { name: 'main', commit: { sha: 'aaa' } },
      { name: 'merged-feature', commit: { sha: 'bbb' } },
      { name: 'live-feature', commit: { sha: 'ccc' } },
    ]);
    if (path === '/repos/o/r/pulls') return json([
      { number: 7, title: 'Merged feature', state: 'closed', merged_at: '2026-09-18T00:00:00Z', draft: false, html_url: 'p', updated_at: '2026-09-18T00:00:00Z', head: { ref: 'merged-feature' } },
    ]);
    if (path.includes('/compare/main...merged-feature')) return json({ ahead_by: 0, behind_by: 0, commits: [], files: [] });
    if (path.includes('/compare/main...live-feature')) return json({ ahead_by: 1, behind_by: 0, commits: [commit('ccc', 'Live work', '2026-09-19T00:00:00Z')], files: [] });
    if (path === '/repos/o/r/pulls/7/commits') return json([
      commit('b01', 'Start the feature', '2026-09-16T00:00:00Z'),
      commit('b02', 'Finish the feature', '2026-09-17T00:00:00Z'),
    ]);
    if (path.includes('/actions/runs')) return json({ workflow_runs: [] });
    if (path.endsWith('/status')) return json({ state: 'success', total_count: 0, statuses: [] });
    return new Response('unexpected ' + path, { status: 500 });
  }) as typeof fetch;
  return { calls };
}

test('a merged branch gets its commits from its pull request, newest first', async () => {
  const { calls } = github();
  const snapshot = await collect.collect(settings);
  const merged = snapshot.branches.find((b) => b.name === 'merged-feature')!;

  assert.equal(merged.commitsFrom, 'pull');
  assert.deepEqual(merged.commits.map((c) => c.message), ['Finish the feature', 'Start the feature']);
  assert.equal(merged.ahead, 0, 'still level with the base — that is true');
  assert.equal(merged.lastActivity, '2026-09-17T00:00:00.000Z', 'dated by its own last commit, not the merge');
  assert.equal(calls['/repos/o/r/pulls/7/commits'], 1);

  const live = snapshot.branches.find((b) => b.name === 'live-feature')!;
  assert.equal(live.commitsFrom, 'ahead', 'a branch with commits ahead is read from the compare as before');
});

test('the pull request is read once per head, like everything else', async () => {
  const { calls } = github();
  await collect.collect(settings);
  const again = await collect.collect(settings);
  assert.equal(calls['/repos/o/r/pulls/7/commits'], 1, 'served from the cache the second time');
  assert.equal(again.branches.find((b) => b.name === 'merged-feature')!.commits.length, 2);
});
