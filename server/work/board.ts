/**
 * The board — everything the assistant has left to do, derived on every read.
 *
 * Not a queue. The board is a pure function of the snapshot plus what is already on disk,
 * which is the same derivation the old `assist()` did on every pass — it was just consumed
 * by a `for` loop instead of by workers (D68).
 *
 * Two properties fall out of deriving rather than storing, and both are the reason for it:
 *
 *   **Ids are stable.** `kind:repo:branch:headSha` derived twice is the same id, so a read
 *   landing while a worker is mid-flight finds the job already claimed rather than starting
 *   a second one. No queue means nothing to deduplicate.
 *
 *   **Crash recovery is free.** A job that died halfway wrote nothing, so the next read
 *   derives it again. There is nothing to restore because there is no second copy of the
 *   truth — which is exactly why work the *owner* dispatched will need one (D72): nothing
 *   in the fleet implies it.
 *
 * Adding a station is adding a row here, not a stage in a pipeline.
 */

import type { Branch, Job, JobKind, Settings, Snapshot } from '../../shared/types.ts';
import {
  draftFor,
  assessFor,
  isAssessed,
  isBriefed,
  isDescribed,
  writeTheBrief,
} from '../advise/assist.ts';
import { briefKey, worthAVision } from '../advise/brief.ts';
import { isSummarised, llmReady, summariseBranch, worthSummarising } from '../advise/enrich.ts';
import type { RunHandle } from './handle.ts';

/**
 * A job, plus the two things only the server may hold: how to do it, and how to tell
 * whether it was actually done. The `Job` half is what reaches the page.
 */
export type JobSpec = Job & {
  /**
   * Checked against the snapshot after the worker says it has finished — never instead of
   * it, and never in place of it (D69). Free: it reads the same stores the cache reads.
   */
  doneWhen(): boolean;
  run(handle: RunHandle): Promise<void>;
};

const jobId = (kind: JobKind, branch: Branch): string =>
  `${kind}:${branch.repoKey}:${branch.name}:${branch.headSha.slice(0, 12)}`;

function forBranch(
  kind: JobKind,
  branch: Branch,
  title: string,
  run: (handle: RunHandle) => Promise<void>,
  doneWhen: () => boolean,
): JobSpec {
  return {
    id: jobId(kind, branch),
    kind,
    title,
    subject: { kind: 'branch', repoKey: branch.repoKey, branch: branch.name },
    origin: 'routine',
    state: 'waiting',
    startedAt: null,
    attempts: 0,
    toolCalls: 0,
    doing: null,
    error: null,
    run,
    doneWhen,
  };
}

/**
 * Everything outstanding, in the order it should be claimed.
 *
 * Dependencies between stations are expressed here, as conditions on what is derivable,
 * rather than as an order of loops somewhere else:
 *
 *   summarise     → any branch with commits and no summary at this head
 *   draft vision  → only once the branch HAS a summary; the draft reads better for it
 *   assess        → only once there IS a vision to compare against (D61)
 *   the brief     → only when nothing else is outstanding; it reads everything
 *
 * So the dispatcher re-derives after each pass and the ordering takes care of itself. No
 * foreman, because this is a sort, and a sort is code.
 */
export function deriveBoard(snapshot: Snapshot, settings: Settings): JobSpec[] {
  if (!llmReady(settings)) return [];

  const jobs: JobSpec[] = [];
  // Newest first: the branches you are most likely to be looking at are served soonest.
  const branches = [...snapshot.branches].sort(
    (a, b) => Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0'),
  );

  for (const branch of branches) {
    if (worthSummarising(branch) && !isSummarised(branch, settings)) {
      jobs.push(
        forBranch(
          'summarise',
          branch,
          `Reading what ${branch.name} is doing`,
          (handle) => summariseBranch(branch, settings, handle.sessionId),
          () => isSummarised(branch, settings),
        ),
      );
    }
  }

  if (settings.visionAutoDraft) {
    for (const branch of branches) {
      if (worthAVision(branch) && branch.summary !== null && !isDescribed(branch)) {
        jobs.push(
          forBranch(
            'draft-vision',
            branch,
            `Working out what ${branch.name} is for`,
            (handle) => draftFor(branch, settings, handle.sessionId),
            () => isDescribed(branch),
          ),
        );
      }
    }
  }

  for (const branch of branches) {
    if (!branch.isBase && branch.vision !== null && !isAssessed(branch, settings)) {
      jobs.push(
        forBranch(
          'assess',
          branch,
          `Checking ${branch.name} against what it is for`,
          (handle) => assessFor(branch, snapshot, settings, handle),
          () => isAssessed(branch, settings),
        ),
      );
    }
  }

  // The brief reads every branch, every vision and every verdict, so it is worth nothing
  // until those have settled. Waiting for an empty board is what orders it.
  if (jobs.length === 0 && !isBriefed(snapshot, settings)) {
    jobs.push({
      // Keyed on what the brief would be written FROM, not on when: an unchanged fleet
      // derives the same id, and the moment anything moves it becomes a different job.
      id: `brief:${briefKey(snapshot, settings)}`,
      kind: 'brief',
      title: 'Writing the brief',
      subject: { kind: 'fleet' },
      origin: 'routine',
      state: 'waiting',
      startedAt: null,
      attempts: 0,
      toolCalls: 0,
      doing: null,
      error: null,
      run: (handle) => writeTheBrief(snapshot, settings, handle.sessionId),
      doneWhen: () => isBriefed(snapshot, settings),
    });
  }

  return jobs;
}

/** What reaches the page: the job without the two server-only closures. */
export function toJob(spec: JobSpec): Job {
  const { run: _run, doneWhen: _doneWhen, ...job } = spec;
  return job;
}
