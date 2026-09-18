/**
 * Work the owner asked for. The only kind that is written down.
 *
 * Routine work needs no persistence: it is derived from the fleet, so a job that died
 * halfway left no trace and the next read derives it again (D68). Dispatched work is the
 * exact opposite — **nothing in the fleet implies it.** It exists only because someone
 * asked, and if the program closes mid-job that fact lives here or nowhere (D72).
 *
 * So: written when accepted, cleared when its predicate passes, put back on the board at
 * startup if it is still here. Rebooted twice without finishing, it parks — otherwise one
 * poison job re-runs on every startup for the rest of the program's life.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { JobKind, JobSubject } from '../../shared/types.ts';
import { DATA_DIR, ensureDirs } from '../paths.ts';

/** Two starts. A third would be a loop rather than a retry. */
export const MAX_REBOOTS = 2;

export type Dispatched = {
  id: string;
  kind: JobKind;
  subject: JobSubject;
  /**
   * The answer already on disk was written before this, so it does not count. That is what
   * makes "read it again" mean *again* rather than "confirm what you already said" — the
   * cache key has not moved, so the predicate has to be about freshness instead.
   */
  since: string;
  askedAt: string;
  /** How many times this has come back from disk after a start. */
  reboots: number;
};

type File = { jobs: Dispatched[] };

const FILE = join(DATA_DIR, 'dispatched.json');
let cache: File | null = null;

function load(): File {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<File>;
    cache = { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    cache = { jobs: [] };
  }
  return cache;
}

function persist(file: File): void {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify(file, null, 2), 'utf8');
  cache = file;
}

export function listDispatched(): Dispatched[] {
  return load().jobs;
}

/**
 * Ask for something.
 *
 * One request per subject and kind: asking twice for the same branch to be re-read is one
 * job, not two, and the second ask refreshes `since` rather than queueing behind the first.
 */
export function dispatch(kind: JobKind, subject: JobSubject, now = new Date()): Dispatched {
  const file = load();
  const existing = file.jobs.find((job) => job.kind === kind && sameSubject(job.subject, subject));

  const job: Dispatched = existing ?? {
    id: randomUUID(),
    kind,
    subject,
    since: now.toISOString(),
    askedAt: now.toISOString(),
    reboots: 0,
  };
  job.since = now.toISOString();
  job.askedAt = now.toISOString();

  if (!existing) file.jobs.push(job);
  persist(file);
  return job;
}

export function clearDispatched(id: string): void {
  const file = load();
  const next = file.jobs.filter((job) => job.id !== id);
  if (next.length !== file.jobs.length) persist({ jobs: next });
}

/**
 * Called once at startup. Everything still here did not finish, so it is counted as
 * rebooted and handed back; anything that has used up its reboots is dropped and named,
 * so it appears as something that gave up rather than vanishing.
 */
export function rebootDispatched(): { resumed: Dispatched[]; gaveUp: Dispatched[] } {
  const file = load();
  const resumed: Dispatched[] = [];
  const gaveUp: Dispatched[] = [];

  for (const job of file.jobs) {
    job.reboots++;
    (job.reboots > MAX_REBOOTS ? gaveUp : resumed).push(job);
  }

  persist({ jobs: resumed });
  return { resumed, gaveUp };
}

export function resetDispatchedCache(): void {
  cache = null;
}

export function sameSubject(a: JobSubject, b: JobSubject): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'fleet' || b.kind === 'fleet') return true;
  return a.repoKey === b.repoKey && a.branch === b.branch;
}

/** Stable text for a subject, for matching a dispatched job against a routine one. */
export const subjectKey = (subject: JobSubject): string =>
  subject.kind === 'fleet' ? 'fleet' : JSON.stringify([subject.repoKey, subject.branch]);
