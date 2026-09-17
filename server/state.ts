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
import { applyWork, runBoard } from './work/run.ts';
import { collect } from './collect.ts';
import { applyGoals, pruneGoals } from './goals.ts';
import { recordHistory } from './history.ts';
import { loadSettings } from './settings.ts';

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

    // Both of these are free and local, so they go on before anyone sees the snapshot:
    // goals are the owner's own filing, summaries are already paid for and on disk.
    // A branch that no longer exists should not sit in a goal forever. The goal is
    // kept either way — it is the owner's, not GitHub's.
    pruneGoals(new Set(next.branches.map((b) => refKey(b.repoKey, b.name))));
    applyGoals(next);
    applyCached(next, settings);
    // Visions, assessments, judgements and the brief that are already on disk. Free.
    applyAssist(next, settings);
    // And what is left to do about all that — derived, not stored (D68). Also free, and
    // done before anyone sees the snapshot so the floor is populated from the first frame.
    applyWork(next, settings);

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
      if (snapshot === target) announce('snapshot');
    };

    const result = await runBoard(target, loadSettings(), announceIfCurrent);

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
    if (snapshot === target) announce('snapshot');
  }
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
  announce('snapshot');
}

/** Fresh on open, then keep going. `refreshSeconds: 0` turns polling off. */
export function startPolling(): void {
  stopPolling();
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
