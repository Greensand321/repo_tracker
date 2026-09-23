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
import { branchDetail, queueWork } from './agent.ts';
import { siblingBranches, whatChanged } from './free.ts';
import { commitFiles, repoReadme } from './github.ts';
import type { Tool } from './types.ts';

/**
 * Each station gets what changes its answer, and nothing else. A longer menu is a longer
 * deliberation, and every item on it is a thing that can be chosen wrongly.
 *
 *   summarise     what the commits actually touched. The messages are written by the same
 *                 agent whose work is in question, so the files are the independent record.
 *   draft-vision  everything: what the software IS (the README), what this branch did to
 *                 it, and what the branches beside it are for. Purpose is the hardest of
 *                 the four to infer and the one worth paying most for.
 *   assess        the files, how things moved, and the siblings — because *drifted* and
 *                 *overtaken* are claims that cannot be checked from one branch alone.
 *   brief         nothing yet. It already reads every branch, every vision and every
 *                 verdict; `pr_reviews` is the one addition worth making and it waits.
 */
const BY_KIND: Record<JobKind, Tool[]> = {
  summarise: [commitFiles],
  'draft-vision': [repoReadme, commitFiles, siblingBranches],
  assess: [commitFiles, whatChanged, siblingBranches],
  brief: [],
  // The combined per-branch job: each step inside asks for its own station's tools.
  branch: [],
};

export function toolsFor(kind: JobKind, settings: Settings): Tool[] {
  if (!settings.toolsEnabled) return [];
  if (settings.toolCallsPerJob <= 0) return [];
  return BY_KIND[kind] ?? [];
}

/**
 * What the advisor has (D94). Reads whenever it may make a call at all; changes only when
 * the owner allows them (`agentEnabled`), and the action door exists only then too.
 *
 * Its own settings, not the stations': turning off the stations' lookups used to take the
 * advisor's ability to act with it, while the page still said it could (audit finding 5).
 * Nothing that costs a GitHub call — an answer comes back in seconds, and anything slower
 * goes on the board.
 */
export function agentTools(settings: Settings): Tool[] {
  if (settings.agentCallsPerQuestion <= 0) return [];
  const reads = [branchDetail, whatChanged];
  return settings.agentEnabled ? [...reads, queueWork] : reads;
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
