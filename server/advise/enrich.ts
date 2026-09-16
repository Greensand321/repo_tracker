/**
 * Puts LLM summaries onto a Snapshot.
 *
 * Two passes, on purpose:
 *   applyCached()  — free, synchronous, runs before the snapshot is ever served.
 *   enrich()       — the paid pass, in the background, announcing as it goes.
 *
 * The deterministic snapshot is never held up waiting for a model, and a provider that
 * is down, out of credit or slow costs you nothing but the summaries. Everything the
 * page needs to be useful is already there without this file.
 */

import type { Branch, Settings, Snapshot } from '../../shared/types.ts';
import { LlmError, complete } from './client.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt, parseInsight } from './prompt.ts';
import { getInsight, insightKey, pruneInsights, putInsight, type StoredInsight } from './store.ts';

/** One at a time by default: this runs in the background and has all refresh cycle to work. */
const CONCURRENCY = 2;

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

export type EnrichResult = {
  summarised: number;
  failed: number;
  errors: string[];
};

/**
 * Summarises the branches that still need it, newest first — the ones you are most
 * likely to be looking at get their summary soonest.
 *
 * `onProgress` fires after each branch so the page can fill in as it goes rather than
 * sitting blank until every branch is done.
 */
export async function enrich(
  snapshot: Snapshot,
  settings: Settings,
  onProgress?: () => void,
): Promise<EnrichResult> {
  const result: EnrichResult = { summarised: 0, failed: 0, errors: [] };
  if (!llmReady(settings)) return result;

  // Housekeeping: branches that no longer exist should not keep their summaries forever.
  pruneInsights(new Set(snapshot.branches.map((b) => insightKey(b.repoKey, b.name))));

  const todo = snapshot.branches
    .filter((branch) => worthSummarising(branch) && branch.insight === null)
    .slice(0, settings.llmMaxPerRun);

  if (todo.length === 0) return result;

  let cursor = 0;
  let stop = false;

  const worker = async (): Promise<void> => {
    while (!stop && cursor < todo.length) {
      const branch = todo[cursor++];
      if (!branch) continue;
      try {
        const stored = await summariseBranch(branch, settings);
        putInsight(branch.repoKey, branch.name, stored);
        assign(branch, stored);
        result.summarised++;
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${branch.repoKey}/${branch.name}: ${message}`);
        // A bad key or an exhausted balance fails identically for every branch, so
        // burning through ninety-nine more requests to learn that is pure waste.
        if (err instanceof LlmError && isFatal(err)) {
          stop = true;
          result.errors.push('stopped early — this failure will repeat for every branch');
        }
      } finally {
        snapshot.llm.pending = Math.max(0, snapshot.llm.pending - 1);
        onProgress?.();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  snapshot.llm.errors = result.errors;
  return result;
}

async function summariseBranch(branch: Branch, settings: Settings): Promise<StoredInsight> {
  const raw = await complete(settings, {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(branch, new Date()),
  });
  const insight = parseInsight(raw, branch);

  return {
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
}

/**
 * The base branch is a reference point rather than a thread of work, and a branch with
 * no commits of its own has nothing to summarise. Quiet branches DO get summarised —
 * being able to see what a branch was about is most of the value of keeping a hundred.
 */
function worthSummarising(branch: Branch): boolean {
  return !branch.isBase && branch.commits.length > 0;
}

function assign(branch: Branch, stored: StoredInsight): void {
  branch.title = stored.title;
  branch.summary = stored.summary;
  branch.progress = stored.progress;
  branch.insight = stored.meta;
}

/** Auth, billing and a missing model are settings problems; retrying cannot fix them. */
function isFatal(err: LlmError): boolean {
  if (err.status === 401 || err.status === 402 || err.status === 403) return true;
  return /no API key|no model chosen/i.test(err.message);
}
