/**
 * The one place a worker's world is assembled.
 *
 * One function rather than four call sites, because this is where the secrets are taken
 * out (D77) and where the GitHub door is made narrow — and a rule enforced in four places
 * is a rule that holds in three of them.
 */

import type { Branch, Settings, Snapshot } from '../../shared/types.ts';
import { toSafe } from '../settings.ts';
import { readerFor } from './evidence.ts';
import type { ToolContext } from './types.ts';

export function contextFor(
  snapshot: Snapshot,
  settings: Settings,
  branch: Branch | null,
  now = new Date(),
): ToolContext {
  return {
    snapshot,
    // Not decoration: a tool's output goes into a prompt that goes to a provider, so it is
    // never handed the GitHub token or the provider key to put there.
    settings: toSafe(settings),
    branch,
    now,
    // No token is a real state — the advisor can be configured before the repos are. It
    // reads as "cannot reach GitHub", which a worker can say, rather than as a crash.
    github: settings.token ? readerFor(settings.token) : null,
    // A station never changes anything. The advisor adds its own door on top of this.
    act: null,
  };
}
