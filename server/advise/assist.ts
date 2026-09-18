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

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Assessment, type Branch, type BranchRef, type Settings, type Snapshot } from '../../shared/types.ts';
import { DATA_DIR, ensureDirs } from '../paths.ts';
import { contextFor } from '../tools/context.ts';
import {
  applyVisions,
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
  generatedAt: string;
  model: string;
  judgements: Record<string, BriefResult['judgements'] extends Map<string, infer V> ? V : never>;
  overtaken: { ref: BranchRef; by: BranchRef; why: string }[];
};

const FILE = join(DATA_DIR, 'assist.json');
let cache: Stored | null = null;

function loadStored(): Stored | null {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as Stored;
  } catch {
    cache = null;
  }
  return cache;
}

function saveStored(value: Stored): void {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify(value, null, 2), 'utf8');
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
  if (!stored || stored.key !== briefKey(snapshot, settings)) {
    // The fleet has moved since this was written, so the reasoning is about a state that
    // no longer exists. Showing it anyway would be confidently out of date.
    snapshot.brief = null;
    return;
  }

  snapshot.brief = {
    text: stored.brief,
    generatedAt: stored.generatedAt,
    model: stored.model,
    promptVersion: BRIEF_PROMPT_VERSION,
  };

  for (const goal of snapshot.goals) {
    goal.judgement = stored.judgements[goal.id] ?? null;
  }

  // Overtaken is a fleet-level finding, applied over the per-branch verdict.
  for (const finding of stored.overtaken) {
    const branch = snapshot.branches.find(
      (b) => b.repoKey === finding.ref.repoKey && b.name === finding.ref.branch,
    );
    if (branch?.assessment) {
      branch.assessment = { ...branch.assessment, verdict: 'overtaken', because: finding.why, overtakenBy: finding.by };
    }
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
  saveStored({
    key,
    brief: written.brief,
    generatedAt: new Date().toISOString(),
    model: settings.llmModel,
    judgements: Object.fromEntries(written.judgements),
    overtaken: written.overtaken,
  });
  applyAssist(snapshot, settings);
}

/** The brief on disk was written about this exact fleet, vision for vision, verdict for verdict. */
export function isBriefed(snapshot: Snapshot, settings: Settings): boolean {
  const stored = loadStored();
  return stored !== null && stored.key === briefKey(snapshot, settings);
}
