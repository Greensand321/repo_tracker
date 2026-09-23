/**
 * The one place the current snapshot lives, plus the background refresh loop.
 *
 * Pages do not poll the server; the server pushes to them when something changes.
 * That keeps "constantly updating" (D34) from turning into a second polling problem
 * on top of the GitHub one.
 */

import { refKey, type Snapshot, type SnapshotResponse } from '../shared/types.ts';
import { applyAssist } from './advise/assist.ts';
import { applyCached, llmReady } from './advise/enrich.ts';
import { applyWork, resumeDispatched, runBoard, unpark } from './work/run.ts';
import { feed } from './agent/record.ts';
import { dispatch } from './work/dispatched.ts';
import type { JobKind, JobSubject } from '../shared/types.ts';
import { collect } from './collect.ts';
import { applyGoals, pruneGoals } from './goals.ts';
import { recordHistory } from './history.ts';
import { loadSettings } from './settings.ts';
import { pruneVisions } from './vision.ts';
import { pruneInsights } from './advise/store.ts';

type Listener = (event: string) => void;

let snapshot: Snapshot | null = null;
let refreshing = false;
let lastError: string | null = null;
let timer: NodeJS.Timeout | null = null;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(event: string): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A page that went away mid-write must not take the refresh loop with it.
    }
  }
}

/**
 * At most one snapshot announcement every {@link COALESCE_MS}, trailing edge.
 *
 * The page re-reads the whole snapshot on every announcement, and the board announces on
 * every job claimed, every lookup started and finished, and every job done. Forty jobs
 * with a couple of lookups each is several hundred full reads of a structure covering a
 * hundred branches — for a panel whose smallest unit of meaning is "something moved".
 *
 * Trailing edge rather than leading, because the last state is the one that must be right;
 * a quarter of a second late is imperceptible, and a missed final update is not.
 */
const COALESCE_MS = 300;
let pending: NodeJS.Timeout | null = null;

function announceSnapshot(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    announce('snapshot');
  }, COALESCE_MS);
  pending.unref?.();
}

export function currentResponse(): SnapshotResponse {
  const settings = loadSettings();
  return {
    snapshot,
    refreshing,
    needs: !settings.token ? 'token' : settings.repos.length === 0 ? 'repos' : null,
    error: lastError,
  };
}

/**
 * Collect once. Concurrent calls join the run in flight rather than starting a second
 * one — a refresh button pressed three times should cost one set of API calls.
 */
export async function refresh(): Promise<void> {
  if (refreshing) return;
  const settings = loadSettings();
  if (!settings.token || settings.repos.length === 0) {
    announce('state');
    return;
  }

  refreshing = true;
  announce('state');
  try {
    const next = await collect(settings);

    // A branch that no longer exists should not sit in a goal forever, or keep a summary
    // and a vision on disk. Pruned here, once, and only within the repos this read actually
    // reached: a repo GitHub would not serve just now is missing from the snapshot, not
    // from GitHub — and pruning against that snapshot deleted every summary, every vision
    // and every filing for it on the strength of one bad connection at startup, then paid
    // to write the summaries again. The goals themselves are kept either way.
    const live = new Set(next.branches.map((b) => refKey(b.repoKey, b.name)));
    const reached = new Set(next.repos.map((r) => r.key));
    pruneGoals(live, reached);
    pruneVisions(live, reached);
    pruneInsights(live, reached);

    // All of these are free and local, so they go on before anyone sees the snapshot:
    // goals are the owner's own filing, summaries are already paid for and on disk.
    applyGoals(next);
    applyCached(next, settings);
    // Visions, assessments, judgements and the brief that are already on disk. Free.
    applyAssist(next, settings);
    // And what is left to do about all that — derived, not stored (D68). Also free, and
    // done before anyone sees the snapshot so the floor is populated from the first frame.
    applyWork(next, settings);
    next.changes = feed();

    snapshot = next;
    lastError = null;
    try {
      recordHistory(next);
    } catch (err) {
      // Failing to write history must never cost you the snapshot you just fetched.
      console.error('could not write history:', message(err));
    }
  } catch (err) {
    lastError = message(err);
    console.error('refresh failed:', lastError);
  } finally {
    refreshing = false;
    announce('snapshot');
  }

  // The paid pass runs after the snapshot is already being served. Deliberately not
  // awaited: nothing on screen should wait for a model.
  if (snapshot && llmReady(loadSettings())) void workInBackground(snapshot);
}

let working = false;

/**
 * Work the board until it is empty or the budget is spent.
 *
 * Deliberately not awaited by `refresh`: nothing on screen waits for a model. The page is
 * told after every job so the floor fills in as the room works, rather than sitting still
 * and then jumping.
 */
async function workInBackground(target: Snapshot): Promise<void> {
  if (working) return;
  working = true;
  try {
    const announceIfCurrent = (): void => {
      // Only announce for the snapshot still on screen; a refresh may have replaced it.
      if (snapshot === target) announceSnapshot();
    };

    const result = await runBoard(target, loadSettings(), { onProgress: announceIfCurrent });

    if (result.failed > 0) {
      console.error(`the assistant: ${result.failed} failure(s)`, result.errors.join('; '));
      target.llm.errors = [...target.llm.errors, ...result.errors];
      // Say so on screen, not only in the terminal behind start.bat. Appending without
      // announcing meant the failure was replaced by the next read before the page ever
      // heard about it — a provider error repeating every minute went unseen for a day.
      announceIfCurrent();
    }
    if (result.claimedButNotDone > 0) {
      // The number worth watching: a worker said it was finished and the predicate
      // disagreed. If it climbs, the job is too big or its tools are wrong (D69).
      console.error(`the assistant: ${result.claimedButNotDone} job(s) claimed done without producing anything`);
    }
  } catch (err) {
    console.error('the assistant failed:', message(err));
  } finally {
    working = false;
    if (snapshot === target) {
      announce('snapshot');
    } else if (snapshot) {
      // A read landed while this run was going, so everything it wrote went onto a
      // snapshot nobody is looking at any more. Hand the results to the one on screen —
      // they are on disk, and applying them is free — and work its board now rather than
      // leaving both to the next read a minute away. With polling off, there is no next read.
      carryOver(snapshot);
      void workInBackground(snapshot);
    }
  }
}

/**
 * Everything on disk, applied to the snapshot on screen, and the page told. What a run
 * that outlived its read owes the read that replaced it.
 */
function carryOver(target: Snapshot): void {
  const settings = loadSettings();
  applyCached(target, settings);
  applyAssist(target, settings);
  applyWork(target, settings);
  target.changes = feed();
  announce('snapshot');
}

/**
 * Re-merge Plane B into the snapshot already on screen and tell the pages.
 *
 * Filing a branch under a goal is the owner's own data — it must not cost a GitHub
 * call, and it must not wait for the next poll to appear. This is the whole reason
 * goals are merged at the edge rather than fetched with everything else.
 */
export function reapplyGoals(): void {
  if (!snapshot) return;
  const settings = loadSettings();
  applyGoals(snapshot);
  applyAssist(snapshot, settings);
  applyWork(snapshot, settings);
  snapshot.changes = feed();
  announce('snapshot');
}

/**
 * Re-merge a vision edit into the snapshot on screen and tell the pages.
 *
 * Saying what a branch is for is the owner's own data and must not cost a GitHub call,
 * or wait for the next poll to appear. The assessment it invalidates is re-run by the
 * next paid pass; until then the page honestly shows no comparison rather than the old one.
 */
export function reapplyVisions(): void {
  if (!snapshot) return;
  const settings = loadSettings();
  applyAssist(snapshot, settings);
  // Saying what a branch is for puts an assessment on the board, and clearing a vision
  // takes one off. The floor should show that the moment you type it, not a minute later.
  applyWork(snapshot, settings);
  snapshot.changes = feed();
  announce('snapshot');
}

/**
 * Ask for something, and start on it now.
 *
 * Its own lane and its own guard, which is the whole point (D71): a routine pass over a
 * hundred branches may well be running, and work the owner asked for and then stopped
 * watching must not wait behind it. The two run side by side.
 */
export function dispatchWork(kind: JobKind, subject: JobSubject): void {
  dispatch(kind, subject);
  if (!snapshot) return;
  applyWork(snapshot, loadSettings());
  snapshot.changes = feed();
  announce('snapshot');
  if (llmReady(loadSettings())) void dispatchInBackground(snapshot);
}

let dispatching = false;
/** An ask that arrived while the lane was busy. It runs when the lane frees, not next read. */
let askedMeanwhile = false;

async function dispatchInBackground(target: Snapshot): Promise<void> {
  if (dispatching) {
    askedMeanwhile = true;
    return;
  }
  dispatching = true;
  askedMeanwhile = false;
  try {
    const result = await runBoard(target, loadSettings(), {
      lane: 'dispatched',
      onProgress: () => {
        if (snapshot === target) announceSnapshot();
      },
    });
    if (result.failed > 0) {
      console.error(`you asked for: ${result.failed} failure(s)`, result.errors.join('; '));
      target.llm.errors = [...target.llm.errors, ...result.errors];
    }
  } catch (err) {
    console.error('dispatched work failed:', message(err));
  } finally {
    dispatching = false;
    if (snapshot === target) announce('snapshot');
    else if (snapshot) carryOver(snapshot);
    // Something was asked for while this was running. The lane exists so that what you
    // ask for never waits behind other work — including its own previous batch.
    if (askedMeanwhile && snapshot && llmReady(loadSettings())) void dispatchInBackground(snapshot);
  }
}

/**
 * Take a parked job off the shelf and work it now, rather than at the next read.
 *
 * "Try again" that waits a minute to visibly do anything is indistinguishable from a
 * button that did nothing.
 */
export function retryJob(id: string): boolean {
  if (!snapshot) return false;
  const job = unpark(id);
  if (!job) return false;
  if (job.origin === 'dispatched') {
    // A routine job is derived again the moment it is forgotten. A dispatched one is not
    // derived from anything: parking took it off disk, so "try again" has to ask again —
    // otherwise the button forgot the failure and then did nothing at all.
    dispatchWork(job.kind, job.subject);
    return true;
  }
  applyWork(snapshot, loadSettings());
  snapshot.changes = feed();
  announce('snapshot');
  if (llmReady(loadSettings())) void workInBackground(snapshot);
  return true;
}

/** Fresh on open, then keep going. `refreshSeconds: 0` turns polling off. */
export function startPolling(): void {
  stopPolling();
  // Anything asked for before the program last closed goes back on the board (D72).
  const { resumed, gaveUp } = resumeDispatched();
  if (resumed > 0) console.log(`picking up ${resumed} thing(s) you asked for last time`);
  if (gaveUp > 0) console.log(`${gaveUp} thing(s) you asked for could not be finished`);
  const { refreshSeconds } = loadSettings();
  void refresh();
  if (refreshSeconds > 0) {
    timer = setInterval(() => void refresh(), refreshSeconds * 1000);
    timer.unref();
  }
}

export function stopPolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-merge all of Plane B into the snapshot on screen and tell the pages — what a change
 * made by the agent, or an undo of one, owes the page. Coalesced: a batch of forty filings
 * is one redraw, not forty.
 */
export function reapplyAll(): void {
  if (!snapshot) return;
  const settings = loadSettings();
  applyGoals(snapshot);
  applyAssist(snapshot, settings);
  applyWork(snapshot, settings);
  snapshot.changes = feed();
  announceSnapshot();
}
