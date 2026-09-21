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
  briefDue,
  briefWrittenAt,
  isAssessed,
  isBriefed,
  isDescribed,
  writeTheBrief,
} from '../advise/assist.ts';
import { insightWrittenAt } from '../advise/store.ts';
import { assessedAt, describedAt } from '../vision.ts';
import { clearDispatched, listDispatched, type Dispatched } from './dispatched.ts';
import { briefKey, worthAVision } from '../advise/brief.ts';
import { toolsFor } from '../tools/catalog.ts';
import { isSummarised, llmReady, summariseBranch, worthSummarising } from '../advise/enrich.ts';
import type { RunHandle } from './handle.ts';
export { cannotAsk } from './asks.ts';

/**
 * A job, plus the two things only the server may hold: how to do it, and how to tell
 * whether it was actually done. The `Job` half is what reaches the page.
 */
export type JobSpec = Job & {
  /**
   * Which round this job belongs to. Everything about one branch is stage 0; the brief,
   * which reads every branch's verdict, is stage 1. The dispatcher works the lowest stage
   * that has anything in it and re-derives, so ordering is a number rather than a foreman.
   *
   * It is a stage rather than a condition on the derivation for one reason: a job that has
   * **given up** must not hold the brief back. One branch the model will not summarise
   * used to block the most valuable thing the assistant writes, permanently, because the
   * brief only appeared when the board was otherwise empty — and a parked job is still on
   * the board.
   */
  stage: number;
  /**
   * What to set aside for this job, in provider calls: one for the answer, plus one for a
   * lookup if the station has tools.
   *
   * A guess, and it only decides how many jobs a read *claims*; the purse is what actually
   * enforces the cap. Claiming purely by the cap was worse than a guess — a budget of four
   * claimed four jobs, each then wanted a lookup there was no money for, and the read
   * finished nothing at all while spending the lot.
   */
  reserve: number;
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
  settings: Settings,
  run: (handle: RunHandle) => Promise<void>,
  doneWhen: () => boolean,
): JobSpec {
  return {
    stage: 0,
    reserve: toolsFor(kind, settings).length > 0 ? 2 : 1,
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
export function deriveBoard(snapshot: Snapshot, settings: Settings, now = new Date()): JobSpec[] {
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
          settings,
          (handle) => summariseBranch(branch, snapshot, settings, handle),
          () => isSummarised(branch, settings),
        ),
      );
    }
  }

  if (settings.visionAutoDraft) {
    for (const branch of branches) {
      if (worthAVision(branch) && branch.summary !== null && !isDescribed(branch, settings)) {
        jobs.push(
          forBranch(
            'draft-vision',
            branch,
            `Working out what ${branch.name} is for`,
            settings,
            (handle) => draftFor(branch, snapshot, settings, handle),
            () => isDescribed(branch, settings),
          ),
        );
      }
    }
  }

  for (const branch of branches) {
    // A vision and nothing to compare it against is not a job: the verdict on a branch with
    // no commits is a guess dressed as a finding, and "drifted" on a merged, empty compare
    // was exactly that.
    if (!branch.isBase && branch.vision !== null && branch.commits.length > 0 && !isAssessed(branch, settings)) {
      jobs.push(
        forBranch(
          'assess',
          branch,
          `Checking ${branch.name} against what it is for`,
          settings,
          (handle) => assessFor(branch, snapshot, settings, handle),
          () => isAssessed(branch, settings),
        ),
      );
    }
  }

  // The brief reads every branch, every vision and every verdict, so it is worth nothing
  // until those have settled — which is what stage 1 says, and why it is not a condition
  // on deriving it at all. And it waits its interval: the fleet moves every few minutes,
  // and the brief is the one prompt that reads all of it.
  if (!isBriefed(snapshot, settings) && briefDue(settings, now)) {
    jobs.push({
      stage: 1,
      // Keyed on what the brief would be written FROM, not on when: an unchanged fleet
      // derives the same id, and the moment anything moves it becomes a different job.
      reserve: toolsFor('brief', settings).length > 0 ? 2 : 1,
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

// ---------------------------------------------------------------------------
// Work the owner asked for
// ---------------------------------------------------------------------------

/**
 * The same stations, asked again on purpose.
 *
 * The routine board derives from what is *missing*, so it can never produce "read this
 * again": the summary is right there, the cache key has not moved, and the predicate is
 * already satisfied. A dispatched job carries the time it was asked for instead, and is
 * done when the answer on disk is newer than the question (D81).
 *
 * That is the whole difference. Same run function, same evidence, same everything else —
 * which is why asking for a second opinion costs one line rather than a second pipeline.
 */
export function deriveDispatched(snapshot: Snapshot, settings: Settings): JobSpec[] {
  if (!llmReady(settings)) return [];

  const specs: JobSpec[] = [];
  for (const asked of listDispatched()) {
    const spec = toSpec(asked, snapshot, settings);
    if (spec) specs.push(spec);
  }
  return specs;
}

function toSpec(asked: Dispatched, snapshot: Snapshot, settings: Settings): JobSpec | null {
  const base = {
    id: `asked:${asked.id}`,
    kind: asked.kind,
    subject: asked.subject,
    origin: 'dispatched' as const,
    state: 'waiting' as const,
    startedAt: null,
    attempts: 0,
    toolCalls: 0,
    doing: null,
    error: null,
    stage: 0,
    reserve: toolsFor(asked.kind, settings).length > 0 ? 2 : 1,
  };

  if (asked.subject.kind === 'fleet') {
    if (asked.kind !== 'brief') return null;
    return {
      ...base,
      title: 'Writing the brief again',
      run: (handle) => writeTheBrief(snapshot, settings, handle.sessionId),
      doneWhen: () => isNewer(briefWrittenAt(), asked.since),
    };
  }

  const ref = asked.subject;
  const branch = snapshot.branches.find((b) => b.repoKey === ref.repoKey && b.name === ref.branch);
  if (!branch) {
    // Gone from a repo this read did reach: the branch was deleted, and a request against
    // it would otherwise sit on disk until its reboots ran out and then park as "could not
    // be finished", which is not what happened. Missing because the repo itself could not
    // be read is different — that is a bad connection, and the request stands.
    if (snapshot.repos.some((r) => r.key === ref.repoKey)) clearDispatched(asked.id);
    return null;
  }

  switch (asked.kind) {
    case 'summarise':
      return {
        ...base,
        title: `Reading ${branch.name} again`,
        run: (handle) => summariseBranch(branch, snapshot, settings, handle),
        doneWhen: () => isNewer(insightWrittenAt(branch.repoKey, branch.name, branch.headSha), asked.since),
      };
    case 'draft-vision':
      // A draft is a proposal, and it must never replace the owner's own words (D61): the
      // station writes over whatever vision is there, so it is only sent where there is
      // none, or only its own earlier guess.
      if (branch.vision && branch.vision.state !== 'proposed') {
        clearDispatched(asked.id);
        return null;
      }
      return {
        ...base,
        title: `Having another go at what ${branch.name} is for`,
        run: (handle) => draftFor(branch, snapshot, settings, handle),
        doneWhen: () => isNewer(describedAt({ repoKey: branch.repoKey, branch: branch.name }), asked.since),
      };
    case 'assess':
      // Nothing to compare against — or nothing to compare — is not a failure; the request
      // simply does not apply, and is cleared, or it would come back on every start.
      if (!branch.vision || branch.commits.length === 0) {
        clearDispatched(asked.id);
        return null;
      }
      return {
        ...base,
        title: `Checking ${branch.name} against what it is for, again`,
        run: (handle) => assessFor(branch, snapshot, settings, handle),
        doneWhen: () =>
          isNewer(assessedAt({ repoKey: branch.repoKey, branch: branch.name }, branch.headSha), asked.since),
      };
    default:
      return null;
  }
}

/** Written at or after it was asked for. Equal counts: the clock has one-second corners. */
const isNewer = (writtenAt: string | null, since: string): boolean =>
  writtenAt !== null && writtenAt >= since;
