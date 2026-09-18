/**
 * Which tools each station gets, and the tag that makes a tool set part of its cache key.
 *
 * **A station's tool list is part of its prompt version (D74).** Adding a tool changes
 * what the station can see and therefore what it writes, so it has to invalidate the
 * cache exactly as editing the prompt text does. Without that the store silently mixes
 * answers drawn from different evidence, with no way to tell which is which — the precise
 * failure `PROMPT_VERSION` exists to prevent (D39).
 *
 * The sets are deliberately small. A station gets what changes its answer and nothing
 * else: a longer menu is a longer deliberation, and every item is a thing that can be
 * chosen wrongly.
 */

import { createHash } from 'node:crypto';

import type { JobKind, Settings } from '../../shared/types.ts';
import { siblingBranches, whatChanged } from './free.ts';
import type { Tool } from './types.ts';

/**
 * Only `assess` so far, and on purpose: it is the station whose verdicts are claims about
 * intent — *drifted*, and the fleet-level *overtaken* it feeds — which are exactly the
 * ones that should rest on evidence rather than on a reading of commit subjects.
 *
 * `summarise` and `draft-vision` want `repo_readme` and `commit_files`, which are GitHub
 * calls and new collection; they arrive with step 4.
 */
const BY_KIND: Record<JobKind, Tool[]> = {
  summarise: [],
  'draft-vision': [],
  assess: [siblingBranches, whatChanged],
  brief: [],
};

export function toolsFor(kind: JobKind, settings: Settings): Tool[] {
  if (!settings.toolsEnabled) return [];
  if (settings.toolCallsPerJob <= 0) return [];
  return BY_KIND[kind] ?? [];
}

/**
 * A short, stable tag for a set of tools, to append to a prompt version.
 *
 * Empty for no tools, so a station that has never had any keeps the version string it
 * always had and nothing is needlessly regenerated.
 */
export function toolSetTag(tools: Tool[]): string {
  if (tools.length === 0) return '';
  const names = tools.map((t) => t.name).sort().join(',');
  return `+t${createHash('sha256').update(names).digest('hex').slice(0, 4)}`;
}
