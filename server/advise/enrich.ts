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
import { toolSetTag, toolsFor } from '../tools/catalog.ts';
import type { RunHandle } from '../work/handle.ts';
import { contextFor } from '../tools/context.ts';
import { LlmError } from './client.ts';
import { converse } from './converse.ts';
import { PROMPT_VERSION, buildUserPrompt, parseInsight, systemPrompt } from './prompt.ts';
import { getInsight, putInsight, type StoredInsight } from './store.ts';

/**
 * The version a summary is cached under, **including the tools the station had** (D74).
 * A summary written after reading which files a commit touched is a different thing from
 * one written from the messages alone, and the store must not hold both under one key.
 */
export function summariseVersion(settings: Settings): string {
  // The word budget is in the prompt, so it is in the key as well — the same reasoning as
  // the tool list (D74). Shorten the line and the summaries are rewritten to fit it rather
  // than kept at the old length and trimmed for ever.
  return `${PROMPT_VERSION}w${settings.nowLineWords}${toolSetTag(toolsFor('summarise', settings))}`;
}

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
      summariseVersion(settings),
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
  snapshot: Snapshot,
  settings: Settings,
  handle: RunHandle,
): Promise<void> {
  const { text: raw } = await converse(settings, {
    system: systemPrompt(settings.nowLineWords),
    user: buildUserPrompt(branch, new Date()),
    tools: toolsFor('summarise', settings),
    ctx: contextFor(snapshot, settings, branch),
    sessionId: handle.sessionId,
    onTool: handle.onTool,
    spend: handle.spend,
  });
  const insight = parseInsight(raw, branch);

  const stored: StoredInsight = {
    title: insight.title,
    summary: insight.summary,
    recap: insight.recap,
    progress: insight.progress,
    meta: {
      evidence: insight.evidence,
      model: settings.llmModel,
      promptVersion: summariseVersion(settings),
      generatedAt: new Date().toISOString(),
      headSha: branch.headSha,
    },
  };
  putInsight(branch.repoKey, branch.name, stored);
  assign(branch, stored);
}

/** The predicate for a summarise job: the summary really does exist at this head. */
export function isSummarised(branch: Branch, settings: Settings): boolean {
  return (
    getInsight(branch.repoKey, branch.name, branch.headSha, summariseVersion(settings), settings.llmModel) !==
    null
  );
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
  branch.recap = stored.recap ?? null;
  branch.progress = stored.progress;
  branch.insight = stored.meta;
}

/** Auth, billing and a bad model are settings problems; retrying cannot fix them. */
export function isFatal(err: LlmError): boolean {
  if (err.status === 401 || err.status === 402 || err.status === 403) return true;
  // A model that answers on no known endpoint will fail identically for every branch.
  return /no API key|no model chosen|did not answer on any known endpoint/i.test(err.message);
}
