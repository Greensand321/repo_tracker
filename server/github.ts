/**
 * Every GitHub call in the codebase. The I/O boundary (CLAUDE.md rule 5).
 *
 * Plain fetch rather than a client library, because the refresh strategy is built on
 * conditional requests: a 304 costs nothing against the rate limit, and that is what
 * makes polling ~100 branches affordable. Being explicit about ETags matters more here
 * than the convenience of a wrapper.
 */

import type { GhBranch, GhCheckRuns, GhCompare, GhPull, GhRepo } from './gh-types.ts';
import type { RateLimit } from '../shared/types.ts';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  // Written out rather than declared as constructor parameter properties, which Node's
  // type stripping cannot handle — and the whole codebase runs through it.
  status: number;
  repo: string | undefined;

  constructor(message: string, status: number, repo?: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.repo = repo;
  }
}

export type Conditional<T> =
  | { status: 'ok'; data: T; etag: string | null }
  | { status: 'unchanged' };

/** Updated on every response so the UI can show remaining quota honestly. */
let lastRateLimit: RateLimit | null = null;
export const getRateLimit = (): RateLimit | null => lastRateLimit;

function readRateLimit(headers: Headers): void {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) return;
  lastRateLimit = { limit, remaining, resetsAt: new Date(reset * 1000).toISOString() };
}

type RequestOptions = {
  token: string;
  etag?: string | null;
  /** Names the repo in errors, so a failure says which one. */
  repo?: string;
};

async function request(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${opts.token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'bearing',
  };
  if (opts.etag) headers['if-none-match'] = opts.etag;

  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { headers });
  readRateLimit(res.headers);

  if (res.status === 304 || res.ok) return res;

  // A rate-limit rejection is a 403 with remaining 0 — distinguish it, because the
  // remedy (wait) is completely different from the remedy for a bad token (fix it).
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const resetsAt = lastRateLimit?.resetsAt ?? 'shortly';
    throw new GitHubError(`GitHub rate limit reached — resets at ${resetsAt}`, res.status, opts.repo);
  }
  if (res.status === 401) throw new GitHubError('GitHub rejected the token', 401, opts.repo);
  if (res.status === 404) {
    throw new GitHubError(`not found, or the token cannot see it`, 404, opts.repo);
  }
  throw new GitHubError(`GitHub returned ${res.status}`, res.status, opts.repo);
}

/** One request, honouring an ETag. `unchanged` means the caller's cache is still good. */
async function getConditional<T>(path: string, opts: RequestOptions): Promise<Conditional<T>> {
  const res = await request(path, opts);
  if (res.status === 304) return { status: 'unchanged' };
  return { status: 'ok', data: (await res.json()) as T, etag: res.headers.get('etag') };
}

async function getAll<T>(path: string, opts: RequestOptions): Promise<T[]> {
  const out: T[] = [];
  let url = path.includes('?') ? `${path}&per_page=100` : `${path}?per_page=100`;
  // Bounded so a pagination bug cannot loop forever against a live API.
  for (let page = 0; page < 20; page++) {
    const res = await request(url, { ...opts, etag: null });
    out.push(...((await res.json()) as T[]));
    const next = parseNextLink(res.headers.get('link'));
    if (!next) break;
    url = next;
  }
  return out;
}

/** `<https://…page=2>; rel="next", <…>; rel="last"` → the next URL, or null. */
export function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function splitRepoKey(key: string): { owner: string; name: string } {
  const [owner, name] = key.split('/');
  if (!owner || !name || key.split('/').length !== 2) {
    throw new GitHubError(`"${key}" is not in owner/repo form`, 400, key);
  }
  return { owner, name };
}

// ---------------------------------------------------------------------------
// The four calls Stage 1 needs
// ---------------------------------------------------------------------------

export async function fetchRepo(key: string, token: string): Promise<GhRepo> {
  const { owner, name } = splitRepoKey(key);
  const res = await request(`/repos/${owner}/${name}`, { token, repo: key });
  return (await res.json()) as GhRepo;
}

/**
 * The change detector. One call returns every branch's head SHA, so comparing against
 * the cache tells us exactly which branches moved — and with an ETag, a repo where
 * nothing moved answers 304 and costs nothing against the rate limit.
 */
export async function fetchBranches(
  key: string,
  token: string,
  etag: string | null,
): Promise<Conditional<GhBranch[]>> {
  const { owner, name } = splitRepoKey(key);
  const first = await getConditional<GhBranch[]>(
    `/repos/${owner}/${name}/branches?per_page=100`,
    { token, etag, repo: key },
  );
  if (first.status === 'unchanged') return first;
  // 100 branches fit in one page; beyond that, pay for the full walk and drop the ETag
  // (it only describes page 1, so keeping it would mask changes on later pages).
  if (first.data.length < 100) return first;
  const all = await getAll<GhBranch>(`/repos/${owner}/${name}/branches`, { token, repo: key });
  return { status: 'ok', data: all, etag: null };
}

/**
 * All PRs for a repo in one conditional call. PR state changes without any branch
 * moving — a review lands, a PR merges — so this is fetched every cycle, and the ETag
 * is what keeps that free.
 */
export async function fetchPulls(
  key: string,
  token: string,
  etag: string | null,
): Promise<Conditional<GhPull[]>> {
  const { owner, name } = splitRepoKey(key);
  const path = `/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc`;
  const first = await getConditional<GhPull[]>(`${path}&per_page=100`, { token, etag, repo: key });
  if (first.status === 'unchanged') return first;
  if (first.data.length < 100) return first;
  // Sorted newest-first, so page 1 already holds every PR that could still be open.
  // Walking hundreds of closed PRs would cost more than it could ever tell us.
  return { status: 'ok', data: first.data, etag: first.etag };
}

/**
 * The core call: in one request, the commits this branch adds to the base, how far
 * ahead and behind it is, and the files it changed.
 */
export async function fetchCompare(
  key: string,
  token: string,
  base: string,
  head: string,
): Promise<GhCompare> {
  const { owner, name } = splitRepoKey(key);
  const res = await request(
    `/repos/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`,
    { token, repo: key },
  );
  return (await res.json()) as GhCompare;
}

export async function fetchCheckRuns(
  key: string,
  token: string,
  sha: string,
): Promise<GhCheckRuns | null> {
  const { owner, name } = splitRepoKey(key);
  try {
    const res = await request(`/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`, {
      token,
      repo: key,
    });
    return (await res.json()) as GhCheckRuns;
  } catch (err) {
    // CI state is a nice-to-have. A repo with checks disabled must not fail the branch.
    if (err instanceof GitHubError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

/** Used by the settings screen to verify a pasted token before saving it. */
export async function verifyToken(token: string): Promise<{ login: string }> {
  const res = await request('/user', { token });
  const user = (await res.json()) as { login: string };
  return { login: user.login };
}
