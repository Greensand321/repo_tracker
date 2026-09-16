import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GitHubError,
  fetchBranches,
  fetchCheckRuns,
  getRateLimit,
  parseNextLink,
  splitRepoKey,
  verifyToken,
} from '../server/github.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Stub = { status: number; body?: unknown; headers?: Record<string, string> };

/** Replaces fetch and records what was asked for, so header behaviour is assertable. */
function stub(...responses: Stub[]): { calls: { url: string; headers: Headers }[] } {
  const calls: { url: string; headers: Headers }[] = [];
  let index = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return new Response(next.status === 304 ? null : JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4990',
        'x-ratelimit-reset': '1789999999',
        ...next.headers,
      },
    });
  }) as typeof fetch;
  return { calls };
}

// --- the conditional request, which is what makes live polling affordable ---

test('a stored ETag is sent, and 304 means the cache is still good', async () => {
  const { calls } = stub({ status: 304 });
  const result = await fetchBranches('o/r', 't', 'W/"abc"');

  assert.equal(result.status, 'unchanged');
  assert.equal(calls[0]!.headers.get('if-none-match'), 'W/"abc"');
});

test('a fresh response carries its ETag back for next time', async () => {
  stub({
    status: 200,
    body: [{ name: 'main', commit: { sha: 'a' } }],
    headers: { etag: 'W/"new"' },
  });
  const result = await fetchBranches('o/r', 't', null);

  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.etag, 'W/"new"');
  assert.equal(result.data[0]!.name, 'main');
});

test('no ETag is sent when there is nothing cached', async () => {
  const { calls } = stub({ status: 200, body: [] });
  await fetchBranches('o/r', 't', null);
  assert.equal(calls[0]!.headers.get('if-none-match'), null);
});

test('rate limit headers are read off every response', async () => {
  stub({ status: 200, body: [] });
  await fetchBranches('o/r', 't', null);

  const rate = getRateLimit();
  assert.equal(rate?.limit, 5000);
  assert.equal(rate?.remaining, 4990);
  assert.ok(rate?.resetsAt.endsWith('Z'));
});

// --- failures have to be distinguishable, because the remedies differ ---

test('a rejected token says so, rather than looking like a missing repo', async () => {
  stub({ status: 401 });
  await assert.rejects(verifyToken('bad'), (err: GitHubError) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /token/i);
    return true;
  });
});

test('exhausting the rate limit is reported as such, not as a permissions problem', async () => {
  // GitHub returns 403 for both, and the only thing that tells them apart is the
  // remaining count — getting this wrong sends you hunting for a scope you already have.
  stub({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  await assert.rejects(verifyToken('t'), (err: GitHubError) => {
    assert.match(err.message, /rate limit/i);
    return true;
  });
});

test('a 404 names the repo it could not see', async () => {
  stub({ status: 404 });
  await assert.rejects(fetchBranches('o/missing', 't', null), (err: GitHubError) => {
    assert.equal(err.repo, 'o/missing');
    assert.equal(err.status, 404);
    return true;
  });
});

test('a repo with checks disabled reports no CI rather than failing the branch', async () => {
  stub({ status: 403, headers: { 'x-ratelimit-remaining': '4990' } });
  assert.equal(await fetchCheckRuns('o/r', 't', 'sha'), null);
});

// --- plumbing ---

test('pagination follows only rel="next"', () => {
  const link = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"';
  assert.equal(parseNextLink(link), 'https://api.github.com/x?page=2');
  assert.equal(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"'), null);
  assert.equal(parseNextLink(null), null);
});

test('a malformed repo key is caught before it becomes a URL', () => {
  assert.deepEqual(splitRepoKey('owner/repo'), { owner: 'owner', name: 'repo' });
  for (const bad of ['owner', 'owner/repo/extra', '/repo', 'owner/']) {
    assert.throws(() => splitRepoKey(bad), GitHubError, `should reject ${bad}`);
  }
});

test('branch names with slashes survive the round trip into a URL', async () => {
  const { calls } = stub({ status: 200, body: { ahead_by: 0, behind_by: 0, commits: [] } });
  const { fetchCompare } = await import('../server/github.ts');
  await fetchCompare('o/r', 't', 'main', 'claude/kind-meitner-cpis9v');

  assert.match(calls[0]!.url, /main\.\.\.claude%2Fkind-meitner-cpis9v/);
});
