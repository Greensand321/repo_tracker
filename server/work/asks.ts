/**
 * Which requests apply to which branches. Pure, and a leaf: the page's buttons, the HTTP
 * door and the advisor's tool all ask this one question, and none of them may queue work
 * the board would only drop again.
 */

import type { Branch, JobKind } from '../../shared/types.ts';

/**
 * Why a request for this branch would not apply, or null when it would. One answer for
 * the page's buttons and for the advisor's tool, so neither can queue work that
 * `toSpec` would only drop again.
 */
export function cannotAsk(kind: JobKind, branch: Branch): string | null {
  if (kind === 'brief') return null;
  if (branch.isBase) return `${branch.name} is the base branch — there is nothing of its own to read`;
  if (kind === 'summarise' && branch.commits.length === 0) return `${branch.name} has no commits of its own to read`;
  if (kind === 'assess' && !branch.vision) return `nobody has said what ${branch.name} is for, so there is nothing to check it against`;
  if (kind === 'draft-vision' && branch.vision && branch.vision.state !== 'proposed') {
    return `you have already said what ${branch.name} is for — edit that instead`;
  }
  return null;
}

