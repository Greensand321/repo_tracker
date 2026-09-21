/**
 * The assistant's stations that are not the summariser: draft a vision, compare the branch
 * against it, and read the whole fleet once to write the brief.
 *
 * Each is one job on the board (D68) with a predicate the dispatcher checks afterwards
 * (D69), plus the free pass that applies everything already on disk before the snapshot is
 * served. The ordering that used to be a sequence of `for` loops here is now expressed as
 * dependencies between derivations in `server/work/board.ts` — vision before judgement,
 * because a goal called done on branches whose purpose was never stated is the assistant
 * marking its own inference as the owner's intent.
 */

import { join } from 'node:path';

import { type Assessment, type Branch, type BranchRef, type BriefParts, type Settings, type Snapshot } from '../../shared/types.ts';
import { readJson, writeJson } from '../jsonfile.ts';
import { DATA_DIR } from '../paths.ts';
import { contextFor } from '../tools/context.ts';
import {
  applyVisions,
  clearVision,
  getAssessment,
  putAssessment,
  recordDecline,
  setVision,
  wasDeclined,
} from '../vision.ts';
import type { RunHandle } from '../work/handle.ts';
import { BRIEF_PROMPT_VERSION, briefKey, writeBrief, type BriefResult } from './brief.ts';
import { VISION_PROMPT_VERSION, assessBranch, assessVersion, draftVersion, draftVision } from './vision.ts';

// ---------------------------------------------------------------------------
// The fleet-level store: one brief, its judgements, its overtaken findings
// ---------------------------------------------------------------------------

type Stored = {
  key: string;
  brief: string;
  /** The three parts (D89). Absent in a file written before v2. */
  parts?: BriefParts | null;
  generatedAt: string;
  model: string;
  judgements: Record<string, BriefResult['judgements'] extends Map<string, infer V> ? V : never>;
  /**
   * `visionText` is what the overtaken branch was FOR when the finding was made. Once the
   * fleet has moved the finding is still applied — but only while that vision stands: a
   * purpose achieved elsewhere does not un-happen because a commit landed, and a purpose
   * the owner has since rewritten was never the one compared.
   */
  overtaken: { ref: BranchRef; by: BranchRef; why: string; visionText?: string }[];
};

const FILE = join(DATA_DIR, 'assist.json');
let cache: Stored | null = null;

function loadStored(): Stored | null {
  if (cache) return cache;
  cache = readJson<Stored>(FILE);
  return cache;
}

function saveStored(value: Stored): void {
  writeJson(FILE, value);
  cache = value;
}

export function resetAssistCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Free pass — everything already on disk, before anyone sees the snapshot
// ---------------------------------------------------------------------------

/**
 * Attaches visions, assessments, judgements, overtaken verdicts and the brief from disk.
 * No network, no cost, no waiting. Called beside `applyCached` and `applyGoals`.
 */
export function applyAssist(snapshot: Snapshot, settings: Settings): void {
  // The version carries the station's tool set (D74): turning tools on or off makes every
  // stored assessment stale, because it was drawn from different evidence.
  applyVisions(snapshot, assessVersion(settings), settings.llmModel);

  const stored = loadStored();
  if (!stored) {
    snapshot.brief = null;
    return;
  }

  // The fleet has moved since this was written — so it is shown dated and marked, not
  // hidden. It used to be dropped the moment anything moved, which with agents pushing
  // every few minutes meant a blank space most of the day, and a rewrite on nearly every
  // read to fill it (`briefEveryMinutes`). Ten minutes old and honest about it is the
  // more useful of the two.
  const fresh = stored.key === briefKey(snapshot, settings);

  snapshot.brief = {
    text: stored.brief,
    parts: stored.parts ?? null,
    generatedAt: stored.generatedAt,
    model: stored.model,
    promptVersion: BRIEF_PROMPT_VERSION,
    stale: !fresh,
  };

  for (const goal of snapshot.goals) {
    goal.judgement = stored.judgements[goal.id] ?? null;
  }

  // Overtaken is a fleet-level finding, applied over the per-branch verdict. Once stale,
  // only while the vision it was made against still stands.
  for (const finding of stored.overtaken) {
    const branch = snapshot.branches.find(
      (b) => b.repoKey === finding.ref.repoKey && b.name === finding.ref.branch,
    );
    if (!branch?.assessment) continue;
    if (!fresh && finding.visionText !== branch.vision?.text) continue;
    branch.assessment = { ...branch.assessment, verdict: 'overtaken', because: finding.why, overtakenBy: finding.by };
  }
}

// ---------------------------------------------------------------------------
// Station: draft a vision for a branch nobody has described
// ---------------------------------------------------------------------------

export async function draftFor(
  branch: Branch,
  snapshot: Snapshot,
  settings: Settings,
  handle: RunHandle,
): Promise<void> {
  const ref: BranchRef = { repoKey: branch.repoKey, branch: branch.name };
  const draft = await draftVision(branch, settings, {
    sessionId: handle.sessionId,
    ctx: contextFor(snapshot, settings, branch),
    onTool: handle.onTool,
    spend: handle.spend,
  });

  if (draft.text === null) {
    // Declining is a correct outcome, not a failure: a vision that cannot be contradicted
    // is worse than none. But it has to be *recorded*, or this job is derived again on the
    // next read and paid for again, every minute, forever (D70).
    //
    // Recorded against the evidence it was made on, not just the head SHA: "I could not be
    // specific" was true of the commit messages alone, and a station since given the
    // README deserves to be asked again.
    recordDecline(ref, branch.headSha, draftVersion(settings));
    // Its own earlier guess, made at a head the branch has left, is withdrawn rather than
    // left standing to be judged against. The owner's words are never touched here.
    if (branch.vision?.state === 'proposed') {
      clearVision(ref);
      recordDecline(ref, branch.headSha, draftVersion(settings));
      branch.vision = null;
      branch.assessment = null;
    }
    return;
  }

  branch.vision = setVision(ref, draft.text, 'proposed', {
    from: draft.from,
    draftedAt: branch.headSha,
  });
}

/** Done means the question has been settled either way — a vision, or a recorded decline. */
export function isDescribed(branch: Branch, settings: Settings): boolean {
  if (branch.vision !== null) return true;
  return wasDeclined(
    { repoKey: branch.repoKey, branch: branch.name },
    branch.headSha,
    draftVersion(settings),
  );
}

// ---------------------------------------------------------------------------
// Station: compare a vision against what the branch actually did
// ---------------------------------------------------------------------------

export async function assessFor(
  branch: Branch,
  snapshot: Snapshot,
  settings: Settings,
  handle: RunHandle,
): Promise<void> {
  const ref: BranchRef = { repoKey: branch.repoKey, branch: branch.name };
  const vision = branch.vision;
  if (!vision) return;

  const verdict = await assessBranch(branch, vision.text, settings, {
    sessionId: handle.sessionId,
    // The worker's whole world: the fleet it can look at, and the one branch it is about.
    ctx: contextFor(snapshot, settings, branch),
    onTool: handle.onTool,
    spend: handle.spend,
  });
  const assessment: Assessment = {
    verdict: verdict.verdict,
    because: verdict.because,
    evidence: verdict.evidence,
    overtakenBy: null,
    looked: verdict.looked,
    model: settings.llmModel,
    promptVersion: assessVersion(settings),
    generatedAt: new Date().toISOString(),
    headSha: branch.headSha,
    visionText: vision.text,
  };
  putAssessment(ref, assessment);
  branch.assessment = assessment;
}

export function isAssessed(branch: Branch, settings: Settings): boolean {
  if (!branch.vision) return true; // nothing to compare against; not this job's problem
  return (
    getAssessment(
      { repoKey: branch.repoKey, branch: branch.name },
      branch.headSha,
      branch.vision.text,
      assessVersion(settings),
      settings.llmModel,
    ) !== null
  );
}

// ---------------------------------------------------------------------------
// Station: the brief
// ---------------------------------------------------------------------------

export async function writeTheBrief(
  snapshot: Snapshot,
  settings: Settings,
  sessionId?: string,
): Promise<void> {
  const key = briefKey(snapshot, settings);
  const written = await writeBrief(snapshot, settings, sessionId);
  // A reply with no brief in it is not a brief. Saving it would satisfy the predicate with
  // an empty string, show nothing on the page, and never be tried again until the fleet
  // moved — a silent failure dressed as a finished job.
  if (!written.brief) throw new Error('the model did not write a brief');
  const visionOf = (ref: BranchRef): string | undefined =>
    snapshot.branches.find((b) => b.repoKey === ref.repoKey && b.name === ref.branch)?.vision?.text;
  saveStored({
    key,
    brief: written.brief,
    parts: written.parts,
    generatedAt: new Date().toISOString(),
    model: settings.llmModel,
    judgements: Object.fromEntries(written.judgements),
    overtaken: written.overtaken.map((finding) => ({ ...finding, visionText: visionOf(finding.ref) })),
  });
  applyAssist(snapshot, settings);
}

/** The brief on disk was written about this exact fleet, vision for vision, verdict for verdict. */
export function isBriefed(snapshot: Snapshot, settings: Settings): boolean {
  const stored = loadStored();
  return stored !== null && stored.key === briefKey(snapshot, settings);
}

/** When the brief on disk was written. What a re-write the owner asked for turns on (D81). */
export function briefWrittenAt(): string | null {
  return loadStored()?.generatedAt ?? null;
}

/**
 * Whether a routine rewrite may happen yet.
 *
 * The brief reads the whole fleet, and its key moves whenever any branch does. With agents
 * pushing every few minutes that meant the most expensive prompt in the program on nearly
 * every read — a call a minute, all day, to change a clause. A routine rewrite now waits
 * `briefEveryMinutes` since the last one. Asking for one does not: that is the dispatched
 * lane, which never reads this.
 */
export function briefDue(settings: Settings, now = new Date()): boolean {
  const written = briefWrittenAt();
  if (!written) return true;
  const age = now.getTime() - Date.parse(written);
  return !Number.isFinite(age) || age >= settings.briefEveryMinutes * 60_000;
}
