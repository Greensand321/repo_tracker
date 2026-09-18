/**
 * What a tool is.
 *
 * A tool is how a station stops guessing: it can go and look at the thing it is reasoning
 * about instead of inferring it from commit subjects. That is the whole of the argument
 * for them (docs/plans/workroom.md §4).
 *
 * Three rules hold for every tool here, permanently:
 *
 *   **No tool writes to a git repo.** Rule 1. There is no exception and there never will
 *   be one; the most destructive act available to any worker is mislabelling a goal.
 *
 *   **A tool reads the Snapshot, never GitHub directly.** If a tool needs a fact, the
 *   fact goes in the Snapshot (rule 4). Otherwise tools become a second, divergent way of
 *   reading GitHub, and the two will disagree.
 *
 *   **A tool says what it costs, in its own description.** Models respect that when you
 *   tell them, and it is the cheapest steering available.
 *
 *   **A tool never sees a secret.** Its context carries `SafeSettings`, not `Settings`.
 */

import type { Branch, SafeSettings, Snapshot } from '../../shared/types.ts';

/**
 * A failure the model is meant to see and recover from — "no such branch", "that is not a
 * number". It comes back as the tool's result rather than as an exception, because a
 * worker that can read the complaint can fix its own call. It still costs budget, so a
 * model that keeps getting it wrong still terminates.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Everything a tool may see — and deliberately **not** the settings, which hold the GitHub
 * token and the provider key. `SafeSettings` is the same object with both removed; it is
 * what the browser is allowed to know, and a tool is no more entitled than the browser.
 *
 * A tool cannot leak what it cannot see, and a tool's output goes straight into a prompt
 * that goes straight to a provider. When a tool eventually needs GitHub (step 4), it gets
 * a narrow reader passed to it, never the credentials to make its own calls.
 */
export type ToolContext = {
  snapshot: Snapshot;
  settings: SafeSettings;
  /** The branch this job is about, when it is about one. Null for fleet-level work. */
  branch: Branch | null;
  now: Date;
};

export type ToolArg = {
  name: string;
  type: 'string' | 'number';
  required: boolean;
  about: string;
};

export type Tool = {
  name: string;
  /** One line, shown to the model verbatim. Says what it is for and what it costs. */
  description: string;
  /** `free` reads memory, `disk` reads this program's own records, `github` is a call. */
  cost: 'free' | 'disk' | 'github';
  args: ToolArg[];
  /** Returns text, already shaped for a prompt. Capped by the caller, not by the tool. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string> | string;
};

// ---------------------------------------------------------------------------
// Argument coercion — everything from the model is untrusted
// ---------------------------------------------------------------------------

export function str(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new ToolError(`"${name}" is required and must be text`);
}

/**
 * Numbers arrive as strings about as often as numbers, so both are accepted — but
 * anything else, including a number outside the allowed range, is corrected rather than
 * used. A model asking for 10000 days of history should get 90, not a timeout.
 */
export function num(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = args[name];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
