/**
 * The advisor's tools (D94). Reads it may always make; changes only through the action door,
 * which exists only when the owner has allowed changes.
 *
 * Batch by design: "re-read these twelve" is one call, not twelve round trips each resending
 * the register (audit finding 3). A list that names a branch that does not exist does the
 * rest and says which were not found, rather than failing the whole call.
 */

import { describeBranch } from '../advise/describe.ts';
import type { ActResult, Tool, ToolContext } from './types.ts';
import { str, ToolError } from './types.ts';
import { resolveBranches } from './resolve.ts';

const MAX_DETAIL = 8;

/** Any branch in full — the one-liners in the prompt are for finding, this is for reading. */
export const branchDetail: Tool = {
  name: 'branch',
  description:
    'Any branch in full: what it is for, what it did, what is left, how it compares, its last commits. Use it for a branch you were only given one line about. Free.',
  cost: 'free',
  args: [{ name: 'branches', type: 'list', required: true, about: `the branches, as "owner/repo name" or just the name — at most ${MAX_DETAIL}` }],

  run(args, ctx) {
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`no such branch: ${missing.join(', ') || 'none named'}`);
    const goalOf = new Map(ctx.snapshot.goals.map((g) => [g.id, g] as const));
    const shown = found.slice(0, MAX_DETAIL).map((b) => describeBranch(b, goalOf.get(b.goalId ?? '') ?? null));
    const notes = [
      found.length > MAX_DETAIL ? `(${found.length - MAX_DETAIL} more not shown — ask again for them)` : '',
      missing.length > 0 ? `Not found: ${missing.join(', ')}` : '',
    ].filter(Boolean);
    return [...shown, ...notes].join('\n');
  },
};

const QUEUE_KINDS = ['summarise', 'assess', 'draft-vision', 'brief'] as const;

/** Put work on the board. It runs in the background and lands on the page. */
export const queueWork: Tool = {
  name: 'queue',
  description:
    'Start work in the background: "summarise" reads branches again, "assess" checks them against what they are for again, "draft-vision" proposes what they are for, "brief" rewrites the brief (no branches). It QUEUES — the result lands on the page later, so never describe one. Free.',
  cost: 'free',
  args: [
    { name: 'kind', type: 'string', required: true, about: QUEUE_KINDS.join(' | ') },
    { name: 'branches', type: 'list', required: false, about: 'which branches, as "owner/repo name" or just the name. Not for brief' },
  ],

  run(args, ctx) {
    const act = door(ctx);
    const kind = str(args, 'kind').toLowerCase();
    if (!(QUEUE_KINDS as readonly string[]).includes(kind)) {
      throw new ToolError(`"${kind}" is not a kind of work. The kinds are: ${QUEUE_KINDS.join(', ')}`);
    }
    if (kind === 'brief') return report(act.queueBrief(), []);
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`name the branches to ${kind}${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.queue(kind as 'summarise' | 'assess' | 'draft-vision', found), missing);
  },
};

/** The action door, or a refusal the model can read and repeat to the owner. */
export function door(ctx: ToolContext): NonNullable<ToolContext['act']> {
  if (!ctx.act) throw new ToolError('changing things is switched off in settings — tell the owner you cannot do this');
  return ctx.act;
}

/** What happened, in the words the model passes on — including what did not. */
export function report(result: ActResult, missing: string[]): string {
  const lines: string[] = [];
  if (result.done.length > 0) lines.push(`Done (${result.done.length}):`, ...result.done.map((l) => `  ${l}`));
  if (result.refused.length > 0) lines.push(`Not done (${result.refused.length}):`, ...result.refused.map((l) => `  ${l}`));
  if (missing.length > 0) lines.push(`Not found (${missing.length}): ${missing.join(', ')}`);
  return lines.join('\n') || 'Nothing to do.';
}
