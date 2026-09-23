/**
 * Every setting the owner tunes, in one table (rule 7, Q79).
 *
 * The server clamps to these ranges, the settings route accepts exactly these keys, the
 * agent reads them to suggest a change, its suggestions are checked against them, and
 * "reset to defaults" fills them. One table, so a new setting cannot be clamped in one
 * place and forgotten in another.
 *
 * Not here, on purpose: the token, the key, the repos, the provider and the model. Those
 * are who you are and what you pay for, not tuning — reset leaves them alone and the agent
 * may not suggest them.
 */

import type { Settings } from './types.ts';

export type TunableKey = {
  [K in keyof Settings]: Settings[K] extends number | boolean ? K : never;
}[keyof Settings];

export type Tunable =
  | { key: TunableKey; type: 'number'; min: number; max: number; label: string; about: string }
  | { key: TunableKey; type: 'boolean'; label: string; about: string };

const n = (key: TunableKey, min: number, max: number, label: string, about: string): Tunable =>
  ({ key, type: 'number', min, max, label, about });
const b = (key: TunableKey, label: string, about: string): Tunable => ({ key, type: 'boolean', label, about });

export const TUNABLES: readonly Tunable[] = [
  n('refreshSeconds', 0, 3600, 'Read every (s)', 'Seconds between background reads of GitHub; 0 turns background reading off.'),
  n('quietAfterDays', 1, 365, 'Quiet after (d)', 'Days without a commit before a branch folds away as quiet. It is never deleted.'),
  n('commitsPerBranch', 1, 300, 'Commits kept', 'How much history is kept per branch, and how much a summary may read.'),
  b('llmEnabled', 'The assistant', 'Whether the model is used at all.'),
  n('llmMaxPerRun', 0, 500, 'Calls per read', 'The most provider calls one read may make; work left over waits for the next read.'),
  n('llmReplyTokens', 256, 32_000, 'Reply tokens', 'How long one reply may run. A reasoning model thinks out of the same allowance, so too low gives empty replies.'),
  n('llmTimeoutSeconds', 15, 600, 'Call timeout (s)', 'How long one model call may take before it is abandoned.'),
  n('askBranchCap', 1, 400, 'Branches', 'How many of the most recent branches a question shows in full; the rest are one line each.'),
  b('visionAutoDraft', 'Propose what each branch is for', 'Whether the assistant drafts a purpose for branches nobody has described.'),
  n('maxOpenQuestions', 0, 40, 'Questions', 'How many questions may wait for the owner at once; 0 switches them off.'),
  // Four words is the longest lead the line can take ("Not what it was for:"), so below
  // five there is nothing left to say after it; above twenty it is a sentence again.
  n('nowLineWords', 5, 20, 'Line words', 'The most words the "happening now" line may use.'),
  n('briefEveryMinutes', 0, 1440, 'Brief (min)', 'Minutes between routine rewrites of the brief, the dearest call; 0 rewrites it on every change.'),
  n('advisorMemoryMinutes', 0, 1440, 'Memory (min)', 'Minutes of quiet before the advisor forgets the conversation; 0 remembers nothing.'),
  b('agentEnabled', 'Let the advisor make the changes I ask for', 'Off, the advisor answers and reads but changes nothing.'),
  n('agentCallsPerQuestion', 0, 40, 'Steps', 'Lookups and changes one answer may make, each one a model call; the answer itself is one call more. 0 leaves it no tools.'),
  n('agentSeconds', 15, 600, 'Answer time (s)', 'How long one answer may take, all its steps together — checked between steps, so a call already running finishes.'),
  n('agentHistory', 50, 5000, 'Changes kept', 'How many of the advisor\'s changes are kept in the record, and so can be undone.'),
  b('toolsEnabled', 'Look things up before answering', 'Whether background jobs may read READMEs, touched files and nearby branches.'),
  // The worst case for a read is llmMaxPerRun jobs times this plus one, so it is capped
  // well below anything that could run away quietly.
  n('toolCallsPerJob', 0, 20, 'Lookups', 'Lookups one background job may make before answering.'),
  n('toolSeconds', 5, 300, 'Lookup time (s)', 'How long one lookup may take.'),
  // Capped low on purpose: more workers make a runaway bill arrive faster, not later.
  n('workers', 1, 8, 'Jobs', 'How many background jobs run at once.'),
  n('dispatchWorkers', 1, 8, 'Asked', 'How many jobs the owner asked for run at once, in their own lane.'),
];

export function tunable(key: string): Tunable | null {
  return TUNABLES.find((t) => t.key === key) ?? null;
}

/**
 * A value as the owner could have typed it, or null if it cannot be one: a number in
 * range (rounded, clamped), or a real boolean. Used on the agent's suggestions, which are
 * never trusted to be well formed.
 */
export function coerceTunable(t: Tunable, value: unknown): number | boolean | null {
  if (t.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const word = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (word === 'true' || word === 'on' || word === 'yes') return true;
    if (word === 'false' || word === 'off' || word === 'no') return false;
    return null;
  }
  // A blank is "no value", not zero: `Number('')` is 0, which is the minimum of half the
  // table and switches things off.
  if (typeof value === 'string' && !value.trim()) return null;
  const num = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  return Math.min(t.max, Math.max(t.min, Math.round(num)));
}
