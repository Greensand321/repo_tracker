/**
 * What the tools fetched from GitHub, kept so they never fetch it twice.
 *
 * Its own store rather than a corner of the repo cache, for one reason: the repo cache is
 * read, modified and written whole on every collection, and a tool finishing mid-read
 * would either lose its write or clobber the collection's. Two writers, one file, no
 * coordination — the bug you only see once a month.
 *
 * Both kinds of entry are permanently true, which is what makes "one call ever" honest:
 * a commit's file list cannot change, and a README is re-read only when the repo is
 * removed and added again.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchCommitFiles, fetchReadme, fetchTextFile } from '../github.ts';
import { DATA_DIR, ensureDirs } from '../paths.ts';

/** Commits whose file lists are remembered. Well past a fleet's worth of asking. */
const MAX_FILE_ENTRIES = 600;

export type CommitFiles = {
  sha: string;
  files: { path: string; status: string; added: number; removed: number }[];
  /** True when GitHub itself truncated the list — it caps at 300 files per commit. */
  truncated: boolean;
};

type Stored = {
  /** repoKey → the repo's own description of itself, or '' for "there is none". */
  readmes: Record<string, { text: string; at: string }>;
  /** `repoKey@sha` → the files it touched. */
  files: Record<string, CommitFiles & { at: string }>;
};

const FILE = join(DATA_DIR, 'evidence.json');
let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Stored>;
    cache = { readmes: parsed.readmes ?? {}, files: parsed.files ?? {} };
  } catch {
    cache = { readmes: {}, files: {} };
  }
  return cache;
}

function persist(all: Stored): void {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  cache = all;
}

export function resetEvidenceCache(): void {
  cache = null;
  inFlight.clear();
}

/**
 * One fetch per key, even when several workers ask at once.
 *
 * Two workers summarising two branches of the same repo both miss the cache in the same
 * millisecond and both call GitHub — the cache only closes after the first write. Measured
 * on a two-branch fleet it doubled every GitHub call; with eight workers it would be eight
 * times. The second asker waits for the first instead.
 */
const inFlight = new Map<string, Promise<unknown>>();

function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * The only way a tool reaches GitHub.
 *
 * A tool is handed this, never the token (D77). It cannot invent a call, cannot widen its
 * own permissions, and cannot put a credential into a prompt, because it never has one.
 */
export type GitHubReader = {
  readme(repoKey: string): Promise<string | null>;
  commitFiles(repoKey: string, sha: string): Promise<CommitFiles | null>;
};

/**
 * Binds a reader to the token, on the server, where the token already lives.
 *
 * Every call is served from disk when it can be. A fleet that has been read once costs
 * nothing here no matter how often a worker asks.
 */
export function readerFor(token: string): GitHubReader {
  return {
    readme(repoKey: string): Promise<string | null> {
      const stored = load().readmes[repoKey];
      if (stored) return Promise.resolve(stored.text || null);

      return once(`readme:${repoKey}`, async () => {
        let text = await fetchReadme(repoKey, token);
        if (!text) {
          // No README is common and not an error. Before giving up, try the file that in
          // practice describes an agent-written repo best — these branches are written by
          // agents reading exactly that file.
          text = await fetchTextFile(repoKey, token, 'CLAUDE.md');
        }

        // '' records "asked, there is none", so the next worker does not ask again.
        const all = load();
        all.readmes[repoKey] = { text: text ?? '', at: new Date().toISOString() };
        persist(all);
        return text;
      });
    },

    commitFiles(repoKey: string, sha: string): Promise<CommitFiles | null> {
      const key = `${repoKey}@${sha}`;
      const stored = load().files[key];
      if (stored) return Promise.resolve(stored);

      return once(`files:${key}`, async () => {
        const detail = await fetchCommitFiles(repoKey, token, sha);
        if (!detail) return null;

        const files = (detail.files ?? []).map((file) => ({
          path: file.previous_filename ? `${file.filename} (was ${file.previous_filename})` : file.filename,
          status: file.status,
          added: file.additions,
          removed: file.deletions,
        }));

        const entry = {
          sha: detail.sha ?? sha,
          files,
          // GitHub returns at most 300 files per commit and says nothing about it, so a
          // commit at the cap is reported as possibly incomplete rather than as complete.
          truncated: files.length >= 300,
          at: new Date().toISOString(),
        };

        const all = load();
        all.files[key] = entry;
        prune(all);
        persist(all);
        return entry;
      });
    },
  };
}

/** Oldest first out the door. A cache that grows without bound is a leak with a nice name. */
function prune(all: Stored): void {
  const keys = Object.keys(all.files);
  if (keys.length <= MAX_FILE_ENTRIES) return;
  keys
    .sort((a, b) => (all.files[a]!.at < all.files[b]!.at ? -1 : 1))
    .slice(0, keys.length - MAX_FILE_ENTRIES)
    .forEach((key) => delete all.files[key]);
}
