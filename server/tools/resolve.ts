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
  let repo: string | null = null;
  let name: string;

  if (input && typeof input === 'object') {
    const item = input as { repo?: unknown; branch?: unknown };
    if (typeof item.branch !== 'string' || !item.branch.trim()) return 'a branch with no name';
    name = item.branch.trim();
    repo = typeof item.repo === 'string' && item.repo.trim() ? item.repo.trim() : null;
  } else if (typeof input === 'string' && input.trim()) {
    const text = input.trim();
    const space = text.indexOf(' ');
    const head = space > 0 ? text.slice(0, space) : '';
    // "owner/repo name" — but a branch name may itself contain a slash, so the first word
    // counts as a repo only when it is one.
    if (head.includes('/') && (snapshot.repos.some((r) => r.key === head) || threads.some((b) => b.repoKey === head))) {
      repo = head;
      name = text.slice(space + 1).trim();
    } else {
      name = text;
    }
  } else {
    return String(input);
  }

  const matches = threads.filter((b) => b.name === name && (repo === null || b.repoKey === repo));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return `${name} (it is in ${matches.map((b) => b.repoKey).join(' and ')} — say which)`;
  return repo ? `${repo} ${name}` : name;
}

/** A list of branches from `args[key]`, or a single `args.branch` (+ `args.repo`). */
export function resolveBranches(args: Record<string, unknown>, snapshot: Snapshot, key = 'branches'): Resolved {
  const raw = args[key];
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
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
