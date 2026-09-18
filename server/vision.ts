/**
 * Visions and assessments — Plane B.
 *
 * A vision is what a branch is FOR: one falsifiable sentence, in the owner's words or
 * drafted and confirmed. It is the yardstick, and it is the one thing no amount of
 * reading commits can produce, because inference gives the *is* and only the owner gives
 * the *ought* (docs/plans/vision-ux.md §1).
 *
 * An assessment is that vision compared against what the branch actually did. It is
 * cached on **head SHA plus the vision text**, because either one moving makes the
 * comparison stale — the same reasoning as D39, with one more term.
 *
 * Both live in `data/visions.json` and are never written into a git repo (rule 1).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  refKey,
  type Assessment,
  type BranchRef,
  type Snapshot,
  type Vision,
  type VisionState,
} from '../shared/types.ts';
import { DATA_DIR, ensureDirs } from './paths.ts';

const FILE = join(DATA_DIR, 'visions.json');

type Entry = {
  vision: Vision | null;
  assessment: Assessment | null;
  /**
   * The head SHA at which the assistant looked at this branch and said it could not write
   * a falsifiable vision for it. Declining is a correct outcome, not a failure — but it
   * has to be *written down*, or the job to draft one is derived again on the very next
   * read and paid for again, every minute, forever (D70).
   *
   * Keyed on the SHA, so the branch moving is what makes the question worth asking again.
   */
  declinedAt?: string | null;
  /** When that decline was made, so a re-ask can tell an old refusal from a new one. */
  declinedWhen?: string | null;
};
type VisionFile = Record<string, Entry>;

let cache: VisionFile | null = null;

function load(): VisionFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(FILE, 'utf8')) as VisionFile;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(all: VisionFile): void {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  cache = all;
}

const entry = (all: VisionFile, key: string): Entry =>
  all[key] ?? { vision: null, assessment: null, declinedAt: null };

// ---------------------------------------------------------------------------
// Visions
// ---------------------------------------------------------------------------

export function getVision(ref: BranchRef): Vision | null {
  return entry(load(), refKey(ref.repoKey, ref.branch)).vision;
}

/**
 * Writes a vision.
 *
 * Changing the text always invalidates the assessment — the yardstick moved, so the
 * comparison drawn against the old one says nothing. Merely *confirming* a proposal does
 * not, because the words did not change.
 */
export function setVision(
  ref: BranchRef,
  text: string,
  state: VisionState,
  options: { from?: string; draftedAt?: string | null } = {},
): Vision {
  const trimmed = text.trim();
  if (!trimmed) throw new VisionError('a vision needs some words');

  const all = load();
  const key = refKey(ref.repoKey, ref.branch);
  const existing = entry(all, key);
  const now = new Date().toISOString();

  const vision: Vision = {
    text: trimmed,
    state,
    from: options.from ?? existing.vision?.from ?? '',
    draftedAt: options.draftedAt === undefined ? (existing.vision?.draftedAt ?? null) : options.draftedAt,
    createdAt: existing.vision?.createdAt ?? now,
    updatedAt: now,
  };

  const textChanged = existing.vision?.text !== trimmed;
  all[key] = { vision, assessment: textChanged ? null : existing.assessment, declinedAt: null };
  persist(all);
  return vision;
}

/** Accepting a draft as-is. The words are unchanged, so the assessment stands. */
export function confirmVision(ref: BranchRef): Vision {
  const current = getVision(ref);
  if (!current) throw new VisionError('there is no vision to confirm');
  return setVision(ref, current.text, 'confirmed');
}

/** Clearing is a real answer — "I do not want to say" beats a vision nobody believes. */
export function clearVision(ref: BranchRef): void {
  const all = load();
  const key = refKey(ref.repoKey, ref.branch);
  if (!all[key]) return;
  // Clearing also clears the decline: saying "I do not want to say" is the owner's answer,
  // and the assistant should be free to offer a draft again once the branch moves.
  all[key] = { vision: null, assessment: null, declinedAt: null };
  persist(all);
}

// ---------------------------------------------------------------------------
// Declines — the assistant looked and could not be specific
// ---------------------------------------------------------------------------

/**
 * True when the assistant already declined to describe this exact state of the branch,
 * with the evidence it has now.
 *
 * Both halves matter. The SHA, so a branch that moves is worth asking about again. The
 * version, because "I could not be specific" was only ever true of what it could see —
 * give the station the README and the question is a different question.
 */
export function wasDeclined(ref: BranchRef, headSha: string, version: string): boolean {
  return entry(load(), refKey(ref.repoKey, ref.branch)).declinedAt === `${headSha}@${version}`;
}

export function recordDecline(ref: BranchRef, headSha: string, version: string): void {
  const all = load();
  const key = refKey(ref.repoKey, ref.branch);
  all[key] = {
    ...entry(all, key),
    declinedAt: `${headSha}@${version}`,
    declinedWhen: new Date().toISOString(),
  };
  persist(all);
}

/**
 * When this branch last had its purpose settled either way — written, or declined.
 *
 * What a re-ask turns on: nothing about the branch has changed, so "is it described" is
 * still true and only "was it looked at again since I asked" can decide (D81).
 */
export function describedAt(ref: BranchRef): string | null {
  const stored = entry(load(), refKey(ref.repoKey, ref.branch));
  const times = [stored.vision?.updatedAt, stored.declinedWhen].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return times.sort().pop() ?? null;
}

/** The stored assessment as it is, with no freshness check. See `describedAt`. */
export function assessedAt(ref: BranchRef, headSha: string): string | null {
  const stored = entry(load(), refKey(ref.repoKey, ref.branch)).assessment;
  return stored && stored.headSha === headSha ? stored.generatedAt : null;
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

/**
 * Returns the stored assessment only if it still describes this exact state. An
 * assessment of a head you have moved past, or of a vision you have since rewritten, is
 * worse than none — it is confidently about something that no longer exists.
 */
export function getAssessment(
  ref: BranchRef,
  headSha: string,
  visionText: string,
  promptVersion: string,
  model: string,
): Assessment | null {
  const stored = entry(load(), refKey(ref.repoKey, ref.branch)).assessment;
  if (!stored) return null;
  if (stored.headSha !== headSha) return null;
  if (stored.visionText !== visionText) return null;
  if (stored.promptVersion !== promptVersion) return null;
  if (stored.model !== model) return null;
  return stored;
}

export function putAssessment(ref: BranchRef, assessment: Assessment): void {
  const all = load();
  const key = refKey(ref.repoKey, ref.branch);
  all[key] = { ...entry(all, key), assessment };
  persist(all);
}

// ---------------------------------------------------------------------------
// Merging into the snapshot
// ---------------------------------------------------------------------------

/**
 * Attaches visions and assessments at the edge, beside `applyGoals` and `applyCached`,
 * so `buildSnapshot` stays a pure transform of GitHub data (rule 5) and editing a vision
 * costs no GitHub call.
 *
 * An assessment that no longer matches its branch's head or its vision is dropped rather
 * than shown: the honest answer to "how is this branch doing against its vision" while
 * the branch is moving is "not assessed yet".
 */
export function applyVisions(snapshot: Snapshot, promptVersion: string, model: string): void {
  const all = load();
  for (const branch of snapshot.branches) {
    const stored = entry(all, refKey(branch.repoKey, branch.name));
    branch.vision = stored.vision;
    branch.assessment =
      stored.vision && stored.assessment
        ? getAssessment(
            { repoKey: branch.repoKey, branch: branch.name },
            branch.headSha,
            stored.vision.text,
            promptVersion,
            model,
          )
        : null;
  }
}

/** Drops entries for branches that no longer exist, so they do not accrete forever. */
export function pruneVisions(liveKeys: Set<string>): number {
  const all = load();
  let removed = 0;
  for (const key of Object.keys(all)) {
    if (!liveKeys.has(key)) {
      delete all[key];
      removed++;
    }
  }
  if (removed > 0) persist(all);
  return removed;
}

/** Tests and the debug CLI need a fresh file rather than a warm module. */
export function resetVisionCache(): void {
  cache = null;
}

export class VisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionError';
  }
}
