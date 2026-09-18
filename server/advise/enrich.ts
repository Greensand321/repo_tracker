/**
 * The summarise station, and the free pass that applies what it already wrote.
 *
 * Two passes, on purpose:
 *   applyCached()      — free, synchronous, runs before the snapshot is ever served.
 *   summariseBranch()  — the paid one, run by a worker off the board (server/work/).
 *
 * The deterministic snapshot is never held up waiting for a model, and a provider that
 * is down, out of credit or slow costs you nothing but the summaries. Everything the
 * page needs to be useful is already there without this file.
 *
 * The loop that used to live here is gone: every station's work is now derived onto one
 * board and run by one dispatcher (D68), so the budget, the concurrency and the "is it
 * actually done" check are decided in one place rather than three.
 */

import type { Branch, Settings, Snapshot } from '../../shared/types.ts';
import { LlmError, complete } from './client.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt, parseInsight } from './prompt.ts';
import { getInsight, putInsight, type StoredInsight } from './store.ts';

export function llmReady(settings: Settings): boolean {
  return Boolean(settings.llmEnabled && settings.llmApiKey && settings.llmModel);
}

/** Applies whatever is already on disk. No network, no cost, no waiting. */
export function applyCached(snapshot: Snapshot, settings: Settings): void {
  if (!llmReady(settings)) {
    snapshot.llm = { enabled: false, pending: 0, errors: [] };
    return;
  }

  let pending = 0;
  for (const branch of snapshot.branches) {
    if (!worthSummarising(branch)) continue;
    const stored = getInsight(
      branch.repoKey,
      branch.name,
      branch.headSha,
      PROMPT_VERSION,
      settings.llmModel,
    );
    if (stored) {
      assign(branch, stored);
    } else {
      pending++;
    }
  }

  snapshot.llm = { enabled: true, pending, errors: [] };
}

/**
 * One branch, one call, one summary written to the store.
 *
 * Writing to the store is what makes this job checkable: the predicate is "an insight
 * exists at this head SHA", which reads the same file the cache reads and cannot be
 * satisfied by a model merely saying it is finished (D69).
 */
export async function summariseBranch(
  branch: Branch,
  settings: Settings,
  sessionId: string,
): Promise<void> {
  const raw = await complete(settings, {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(branch, new Date()),
    sessionId,
  });
  const insight = parseInsight(raw, branch);

  const stored: StoredInsight = {
    title: insight.title,
    summary: insight.summary,
    progress: insight.progress,
    meta: {
      evidence: insight.evidence,
      model: settings.llmModel,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      headSha: branch.headSha,
    },
  };
  putInsight(branch.repoKey, branch.name, stored);
  assign(branch, stored);
}

/** The predicate for a summarise job: the summary really does exist at this head. */
export function isSummarised(branch: Branch, settings: Settings): boolean {
  return getInsight(branch.repoKey, branch.name, branch.headSha, PROMPT_VERSION, settings.llmModel) !== null;
}

/**
 * The base branch is a reference point rather than a thread of work, and a branch with
 * no commits of its own has nothing to summarise. Quiet branches DO get summarised —
 * being able to see what a branch was about is most of the value of keeping a hundred.
 */
export function worthSummarising(branch: Branch): boolean {
  return !branch.isBase && branch.commits.length > 0;
}

function assign(branch: Branch, stored: StoredInsight): void {
  branch.title = stored.title;
  branch.summary = stored.summary;
  branch.progress = stored.progress;
  branch.insight = stored.meta;
}

/** Auth, billing and a bad model are settings problems; retrying cannot fix them. */
export function isFatal(err: LlmError): boolean {
  if (err.status === 401 || err.status === 402 || err.status === 403) return true;
  // A model that answers on no known endpoint will fail identically for every branch.
  return /no API key|no model chosen|did not answer on any known endpoint/i.test(err.message);
}
