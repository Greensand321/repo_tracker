/**
 * The assistant's paid pass: draft the visions nobody has stated, compare each branch
 * against its vision, then read the whole fleet once and write the brief.
 *
 * Runs in the background after the snapshot is already being served, like `enrich`. The
 * deterministic snapshot never waits for a model, and a provider that is down costs you
 * the assistant, not the dashboard.
 *
 * Order matters and is not arbitrary: **vision before judgement**. A goal called done on
 * the strength of branches whose purpose was never stated is the assistant marking its
 * own inference as the owner's intent.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { refKey, type Assessment, type BranchRef, type Settings, type Snapshot } from '../../shared/types.ts';
import { DATA_DIR, ensureDirs } from '../paths.ts';
import {
  applyVisions,
  getAssessment,
  putAssessment,
  pruneVisions,
  setVision,
} from '../vision.ts';
import { LlmError } from './client.ts';
import { BRIEF_PROMPT_VERSION, briefKey, worthAVision, writeBrief, type BriefResult } from './brief.ts';
import { llmReady } from './enrich.ts';
import { VISION_PROMPT_VERSION, assessBranch, draftVision } from './vision.ts';

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
  applyVisions(snapshot, VISION_PROMPT_VERSION, settings.llmModel);

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
// Paid pass
// ---------------------------------------------------------------------------

export type AssistResult = {
  drafted: number;
  declined: number;
  assessed: number;
  briefed: boolean;
  failed: number;
  errors: string[];
};

export async function assist(
  snapshot: Snapshot,
  settings: Settings,
  onProgress?: () => void,
): Promise<AssistResult> {
  const result: AssistResult = { drafted: 0, declined: 0, assessed: 0, briefed: false, failed: 0, errors: [] };
  if (!llmReady(settings)) return result;

  pruneVisions(new Set(snapshot.branches.map((b) => refKey(b.repoKey, b.name))));

  const sessionId = randomUUID();
  let fatal = false;

  const fail = (what: string, err: unknown): void => {
    result.failed++;
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`${what}: ${message}`);
    if (err instanceof LlmError && isFatal(err)) {
      fatal = true;
      result.errors.push('stopped early — this failure will repeat');
    }
  };

  // --- 1. Draft a vision for branches nobody has described -----------------
  if (settings.visionAutoDraft) {
    const needsOne = snapshot.branches
      .filter((b) => worthAVision(b) && b.vision === null)
      .sort((a, b) => Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0'))
      .slice(0, settings.llmMaxPerRun);

    for (const branch of needsOne) {
      if (fatal) break;
      try {
        const draft = await draftVision(branch, settings, sessionId);
        if (draft.text === null) {
          // Declining is a correct outcome, not a failure. A vision that cannot be
          // contradicted is worse than none, so nothing is written.
          result.declined++;
          continue;
        }
        branch.vision = setVision(
          { repoKey: branch.repoKey, branch: branch.name },
          draft.text,
          'proposed',
          { from: draft.from, draftedAt: branch.headSha },
        );
        result.drafted++;
        onProgress?.();
      } catch (err) {
        fail(`${branch.repoKey}/${branch.name} (draft)`, err);
      }
    }
  }

  // --- 2. Compare each vision against what the branch actually did ---------
  const toAssess = snapshot.branches.filter(
    (b) => !b.isBase && b.vision !== null && b.assessment === null,
  );

  for (const branch of toAssess) {
    if (fatal) break;
    const ref: BranchRef = { repoKey: branch.repoKey, branch: branch.name };
    const vision = branch.vision!;

    const cached = getAssessment(ref, branch.headSha, vision.text, VISION_PROMPT_VERSION, settings.llmModel);
    if (cached) {
      branch.assessment = cached;
      continue;
    }

    try {
      const verdict = await assessBranch(branch, vision.text, settings, sessionId);
      const assessment: Assessment = {
        verdict: verdict.verdict,
        because: verdict.because,
        evidence: verdict.evidence,
        overtakenBy: null,
        model: settings.llmModel,
        promptVersion: VISION_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
        headSha: branch.headSha,
        visionText: vision.text,
      };
      putAssessment(ref, assessment);
      branch.assessment = assessment;
      result.assessed++;
      onProgress?.();
    } catch (err) {
      fail(`${branch.repoKey}/${branch.name} (assess)`, err);
    }
  }

  // --- 3. Read the whole fleet once and write the brief --------------------
  if (!fatal) {
    const key = briefKey(snapshot, settings);
    const stored = loadStored();
    if (!stored || stored.key !== key) {
      try {
        const written = await writeBrief(snapshot, settings);
        saveStored({
          key,
          brief: written.brief,
          generatedAt: new Date().toISOString(),
          model: settings.llmModel,
          judgements: Object.fromEntries(written.judgements),
          overtaken: written.overtaken,
        });
        applyAssist(snapshot, settings);
        result.briefed = true;
        onProgress?.();
      } catch (err) {
        fail('the brief', err);
      }
    }
  }

  return result;
}

/** Auth, billing and a bad model are settings problems; retrying cannot fix them. */
function isFatal(err: LlmError): boolean {
  if (err.status === 401 || err.status === 402 || err.status === 403) return true;
  return /no API key|no model chosen|did not answer on any known endpoint/i.test(err.message);
}
