/**
 * Turning what the model wrote into branches that exist.
 *
 * Everything from the model is untrusted, and a batch tool is the place that matters most:
 * one invented name in a list of twelve must not sink the other eleven, and must not be
 * quietly dropped either. So a list resolves to what was found and what was not, and the
 * tool says both.
 *
 * Accepted: `"owner/repo branch-name"` (what the prompt shows), a bare `"branch-name"` when
 * only one repo has it, or `{ "repo": "owner/repo", "branch": "branch-name" }`.
 */

import type { Branch, Snapshot } from '../../shared/types.ts';

export type Resolved = { found: Branch[]; missing: string[] };

export function resolveBranch(input: unknown, snapshot: Snapshot): Branch | string {
  const threads = snapshot.branches.filter((b) => !b.isBase);
  let text: string;
  let repo: string | null = null;

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const item = input as { repo?: unknown; branch?: unknown; name?: unknown };
    const raw = typeof item.branch === 'string' ? item.branch : typeof item.name === 'string' ? item.name : '';
    text = tidy(raw);
    if (!text) return 'a branch with no name';
    if (typeof item.repo === 'string' && item.repo.trim()) repo = knownRepo(item.repo.trim(), snapshot) ?? item.repo.trim();
  } else if (typeof input === 'string' && tidy(input)) {
    text = tidy(input);
  } else {
    return 'a branch with no name';
  }

  // "owner/repo name" — in a string or in an object's "branch" alike. A branch name may
  // itself contain a slash, so the first word counts as a repo only when it is one.
  if (repo === null) {
    const space = text.indexOf(' ');
    const head = space > 0 ? knownRepo(text.slice(0, space), snapshot) : null;
    if (head) {
      repo = head;
      text = text.slice(space + 1).trim();
    }
  }

  const pool = threads.filter((b) => repo === null || b.repoKey === repo);
  let matches = pool.filter((b) => b.name === text);
  // Git names are case-sensitive, but two branches differing only in case are rare enough
  // that a model's slip is the likelier reading — when it is unambiguous.
  if (matches.length === 0) matches = pool.filter((b) => b.name.toLowerCase() === text.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return `${text} (it is in ${matches.map((b) => b.repoKey).join(' and ')} — say which)`;
  return repo ? `${repo} ${text}` : text;
}

/** One line, without the list bullet or quotes a model copies along with a name. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^[-*•]\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim();
}

/** The repo's own key for what was written, ignoring case — or null if it names none. */
function knownRepo(text: string, snapshot: Snapshot): string | null {
  if (!text.includes('/')) return null;
  const want = text.toLowerCase();
  const keys = new Set([...snapshot.repos.map((r) => r.key), ...snapshot.branches.map((b) => b.repoKey)]);
  return [...keys].find((k) => k.toLowerCase() === want) ?? null;
}

/** A list of branches from `args[key]`, or a single `args.branch` (+ `args.repo`). */
export function resolveBranches(args: Record<string, unknown>, snapshot: Snapshot, key = 'branches'): Resolved {
  const raw = args[key];
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' || (raw && typeof raw === 'object')
      ? [raw]
      : typeof args['branch'] === 'string'
        ? [{ repo: args['repo'], branch: args['branch'] }]
        : [];
  const found: Branch[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const hit = resolveBranch(item, snapshot);
    if (typeof hit === 'string') {
      missing.push(hit);
    } else if (!seen.has(`${hit.repoKey} ${hit.name}`)) {
      seen.add(`${hit.repoKey} ${hit.name}`);
      found.push(hit);
    }
  }
  return { found, missing };
}
