/**
 * The dispatcher — the room, and the only place that spends money.
 *
 * It replaces three separate loops (the summariser's worker pool, and the two sequential
 * passes inside the old `assist()`), so the budget, the concurrency and the "is it
 * actually done" check are decided once rather than three times and differently.
 *
 * The shape, from docs/plans/workroom.md:
 *
 *   derive the board → claim up to the budget → run N at once → check each predicate
 *   → re-derive → repeat until nothing is left, nothing moved, or the budget is spent.
 *
 * Re-deriving between passes is what orders the stations: a vision draft becomes derivable
 * once its summary exists, an assessment once its vision does, the brief once the board is
 * empty. Nobody decides that; it falls out of what is derivable.
 */

import { randomUUID } from 'node:crypto';

import type { Job, JobKind, Settings, Snapshot } from '../../shared/types.ts';
import { refKey } from '../../shared/types.ts';
import { LlmError } from '../advise/client.ts';
import { BudgetError } from '../advise/converse.ts';
import { isFatal, llmReady } from '../advise/enrich.ts';
import { insightKey, pruneInsights } from '../advise/store.ts';
import { pruneVisions } from '../vision.ts';
import { deriveBoard, toJob, type JobSpec } from './board.ts';

/**
 * Up to this many rounds of derive-and-run per read. Four covers the longest real chain
 * (summarise → draft → assess → brief); the cap exists so a station that somehow never
 * satisfies its own predicate cannot spin for the life of the process.
 */
const MAX_PASSES = 5;

/**
 * A job is tried twice in its lifetime, and **once per read**.
 *
 * Not twice in a row: a provider that just rate-limited will rate-limit again this second,
 * and the next read is a minute away, which is a better wait than none. After the second
 * failure it parks — a visible state, not a silent one, which is the whole lesson of D67.
 */
const MAX_ATTEMPTS = 2;

/**
 * Held across reads, deliberately. Both are keyed by the derived job id, which contains the
 * head SHA — so a branch that moves gets a new id and is tried afresh, and a branch that has
 * not moved is not retried every minute forever.
 */
const attempts = new Map<string, number>();
const parked = new Map<string, Job>();

/**
 * Claimed right now. Module-scope rather than per-run, because a read that lands mid-flight
 * builds a *new* snapshot and asks what is outstanding — and the honest answer includes the
 * two jobs a worker already has in its hands. Per-run, the new snapshot showed them as
 * waiting and the floor said "0 at work" while two were.
 */
const working = new Map<string, Job>();

/**
 * Put a parked job back on the board.
 *
 * Parking is not a verdict on the work, only on two attempts at it, so "try again" has to
 * exist — otherwise the honest thing (D67: say it failed) becomes a dead end. Clearing the
 * attempt count is enough: the job is derived again on the next pass, because it was never
 * stored anywhere in the first place.
 */
export function unpark(id: string): boolean {
  attempts.delete(id);
  return parked.delete(id);
}

/**
 * Forget every failure. Called when settings change, because what parked a job may be
 * exactly what just changed: a key, a model, an endpoint. Leaving work parked on the
 * strength of a problem the owner has since fixed is the opposite of helpful.
 *
 * Nothing in flight is touched — there is nothing to cancel, only a memory of failures.
 */
export function resetBoardState(): void {
  attempts.clear();
  parked.clear();
  working.clear();
}

export type RunResult = {
  done: number;
  failed: number;
  parked: number;
  /**
   * How often a worker finished without its predicate agreeing. Watch this number: if it
   * climbs, the job is too big or the tools are wrong, and there is no other way to tell.
   */
  claimedButNotDone: number;
  errors: string[];
  budgetSpent: boolean;
  byKind: Partial<Record<JobKind, number>>;
};

/** The free pass: what is outstanding, before anything is spent. Beside applyCached. */
export function applyWork(snapshot: Snapshot, settings: Settings): void {
  const waiting = deriveBoard(snapshot, settings).filter(
    (spec) => !parked.has(spec.id) && !working.has(spec.id),
  );
  snapshot.work = {
    jobs: [...working.values(), ...waiting.map(toJob), ...parked.values()],
    workers: Math.max(1, settings.workers),
  };
}

export async function runBoard(
  snapshot: Snapshot,
  settings: Settings,
  onProgress?: () => void,
  /**
   * The board itself, injectable. Deriving it is the pure half of this file (rule 5), so a
   * test can hand in a job that lies about having finished and check that the predicate —
   * not the worker's word — is what decides.
   */
  derive: (snapshot: Snapshot, settings: Settings) => JobSpec[] = deriveBoard,
): Promise<RunResult> {
  const result: RunResult = {
    done: 0, failed: 0, parked: 0, claimedButNotDone: 0, errors: [], budgetSpent: false, byKind: {},
  };
  if (!llmReady(settings)) {
    applyWork(snapshot, settings);
    return result;
  }

  // Housekeeping: branches that no longer exist should not keep their summaries, visions
  // or assessments forever.
  const live = new Set(snapshot.branches.map((b) => refKey(b.repoKey, b.name)));
  pruneVisions(live);
  pruneInsights(new Set(snapshot.branches.map((b) => insightKey(b.repoKey, b.name))));

  /**
   * One budget for the whole read, spent across every station, and counted in **provider
   * calls** rather than jobs. A job that looks two things up costs three calls, and a cap
   * that counted jobs would quietly let a read cost several times what it says.
   *
   * Claiming deducts one per job up front; the lookups are deducted as they happen, so a
   * pass can overshoot slightly and the next pass sees the real total.
   */
  let budget = settings.llmMaxPerRun;
  /** One call, if there is one to be had. The only place money is committed. */
  const spend = (): boolean => (budget > 0 ? (budget--, true) : false);
  const workers = Math.max(1, settings.workers);
  // Every job in a read shares an identical system prompt per station, so routing them
  // together is exactly what the session header is for. Reads stay distinct.
  const sessionId = randomUUID();

  let fatal = false;
  /**
   * Finished in this run. A correct board never re-derives a done job — its predicate now
   * holds — but "never spend twice for the same thing because a derivation was wrong" is
   * too cheap a guarantee to leave to correctness elsewhere.
   */
  const finished = new Set<string>();

  const publish = (): void => {
    const waiting = derive(snapshot, settings).filter(
      (spec) => !parked.has(spec.id) && !working.has(spec.id) && !finished.has(spec.id),
    );
    snapshot.work = {
      jobs: [...working.values(), ...waiting.map(toJob), ...parked.values()],
      workers,
    };
    onProgress?.();
  };

  // Everything this run claimed, so nothing can be left marked as in-flight by a failure
  // outside the per-job try — a job stuck in `working` is filtered out of the board for
  // the life of the process and would simply never run again.
  const claimedHere = new Set<string>();

  try {
    for (let pass = 0; pass < MAX_PASSES && !fatal; pass++) {
      const outstanding = derive(snapshot, settings).filter(
        (spec) => !parked.has(spec.id) && !finished.has(spec.id) && !working.has(spec.id),
      );
      if (outstanding.length === 0) break;

      // The lowest stage that still has anything in it. Everything about a branch comes
      // before the brief that reads them all, and a job that gave up is already gone from
      // this list — so one unsummarisable branch cannot hold the brief back for ever.
      const stage = Math.min(...outstanding.map((spec) => spec.stage));
      const board = outstanding.filter((spec) => spec.stage === stage);

      if (budget <= 0) {
        result.budgetSpent = true;
        break;
      }

      // Claim what can be paid for in full, rather than starting more than the purse can
      // finish. Each claim pays for its own first call here; lookups ask as they go.
      const claimed: JobSpec[] = [];
      let reserved = 0;
      for (const spec of board) {
        if (reserved + spec.reserve > budget) break;
        reserved += spec.reserve;
        claimed.push(spec);
      }
      if (claimed.length === 0) {
        result.budgetSpent = true;
        break;
      }
      for (const _ of claimed) spend();

      const before = result.done;
      await pool(claimed, workers, async (spec) => {
        if (fatal) return;
        const tried = (attempts.get(spec.id) ?? 0) + 1;
        attempts.set(spec.id, tried);

        const job: Job = {
          ...toJob(spec),
          state: 'working',
          startedAt: new Date().toISOString(),
          attempts: tried,
          toolCalls: 0,
          doing: null,
        };
        working.set(spec.id, job);
        claimedHere.add(spec.id);
        publish();

        try {
          await spec.run({
            sessionId,
            spend,
            onTool: (name) => {
              // Live, so the floor moves while the work happens rather than jumping at the
              // end. A worker that is looking something up should look like one — and one
              // that has finished looking should stop saying it is.
              if (name === null) {
                job.doing = null;
              } else {
                job.toolCalls++;
                job.doing = name;
              }
              publish();
            },
          });
          // Never the worker's word for it. The predicate reads the store the cache reads.
          if (spec.doneWhen()) {
            result.done++;
            result.byKind[spec.kind] = (result.byKind[spec.kind] ?? 0) + 1;
            attempts.delete(spec.id);
            finished.add(spec.id);
          } else {
            result.claimedButNotDone++;
            park(spec, tried, 'finished without producing anything', result);
          }
        } catch (err) {
          if (err instanceof BudgetError) {
            // Not a failure and not an attempt: the read ran out of money mid-job. Nothing
            // was written, so the next read does it properly on a fresh budget.
            attempts.delete(spec.id);
            result.budgetSpent = true;
            return;
          }

          const message = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.errors.push(`${spec.title}: ${message}`);

          if (err instanceof LlmError && isFatal(err)) {
            // A rejected key, an empty wallet, a model that does not exist: nothing about
            // *this job* failed, and every other job would fail identically. So the attempt
            // is not counted and nothing parks — otherwise two reads with a bad key park the
            // whole fleet, and fixing the key would not bring it back. Which it did.
            attempts.delete(spec.id);
            fatal = true;
            result.errors.push('stopped early — this failure will repeat until it is fixed in settings');
          } else {
            park(spec, tried, message, result);
          }
        } finally {
          working.delete(spec.id);
          publish();
        }
      });

      // A pass that achieved nothing will achieve nothing again a second later. Whatever
      // failed is left for the next read, which is also its one retry.
      if (result.done === before) break;
    }

  } finally {
    for (const id of claimedHere) working.delete(id);
  }

  // Anything still derivable and not parked is left for the next read, honestly shown.
  const stillLive = new Set(derive(snapshot, settings).map((spec) => spec.id));
  for (const id of [...attempts.keys()]) if (!stillLive.has(id) && !parked.has(id)) attempts.delete(id);
  for (const id of [...parked.keys()]) if (!stillLive.has(id)) parked.delete(id);

  publish();
  return result;
}

/**
 * Failing once is worth another go — a timeout, a rate limit, a mangled reply. Failing
 * twice is a fact about the job, and repeating it is how a provider error runs unnoticed
 * for a day (D67). So it parks, where it is visible and answerable.
 */
function park(spec: JobSpec, tried: number, error: string, result: RunResult): void {
  if (tried < MAX_ATTEMPTS) return;
  parked.set(spec.id, { ...toJob(spec), state: 'parked', attempts: tried, error });
  result.parked++;
}

/** N at a time over one list. Workers take the next job as they free up. */
async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
