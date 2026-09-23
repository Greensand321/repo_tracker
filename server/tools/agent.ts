/**
 * The advisor's tools (D94). Reads it may always make; changes only through the action door,
 * which exists only when the owner has allowed changes.
 *
 * Batch by design: "re-read these twelve" is one call, not twelve round trips each resending
 * the register (audit finding 3). A list that names a branch that does not exist does the
 * rest and says which were not found, rather than failing the whole call.
 */

import type { Branch } from '../../shared/types.ts';
import { describeBranch } from '../advise/describe.ts';
import type { ActResult, Tool, ToolContext } from './types.ts';
import { str, ToolError } from './types.ts';
import { resolveBranch, resolveBranches } from './resolve.ts';

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

// ---------------------------------------------------------------------------
// Goals and filing (phase 3). Every one goes through the action door, so every one is
// recorded, listed under the answer, in the feed, and undoable.
// ---------------------------------------------------------------------------

/** true / "true" / "yes" → true; false / "false" / "no" → false; anything else → undefined. */
function bool(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|done)$/i.test(value.trim())) return true;
    if (/^(false|no|not done)$/i.test(value.trim())) return false;
  }
  return undefined;
}

const optional = (args: Record<string, unknown>, name: string): string | undefined =>
  typeof args[name] === 'string' ? (args[name] as string) : undefined;

export const createGoal: Tool = {
  name: 'create_goal',
  description: 'Make a new goal. Refused if one of that title exists — use file to put branches under an existing one. Free; undoable.',
  cost: 'free',
  args: [
    { name: 'title', type: 'string', required: true, about: 'a short title' },
    { name: 'note', type: 'string', required: false, about: "the owner's note, if they gave one" },
    { name: 'milestone', type: 'string', required: false, about: 'a milestone label, if they gave one' },
  ],
  run(args, ctx) {
    return report(door(ctx).createGoal(str(args, 'title'), optional(args, 'note'), optional(args, 'milestone')), []);
  },
};

export const updateGoal: Tool = {
  name: 'update_goal',
  description:
    'Change a goal: rename it, change its note or milestone, or mark it done or not done. Give only what changes. Marking done is flagged for the owner to check. Free; undoable.',
  cost: 'free',
  args: [
    { name: 'goal', type: 'string', required: true, about: 'the goal, by its exact title or id' },
    { name: 'title', type: 'string', required: false, about: 'the new title' },
    { name: 'note', type: 'string', required: false, about: 'the new note ("" clears it)' },
    { name: 'milestone', type: 'string', required: false, about: 'the new milestone label ("" clears it)' },
    { name: 'done', type: 'boolean', required: false, about: 'true to mark it done, false to mark it not done' },
  ],
  run(args, ctx) {
    const done = bool(args, 'done');
    const patch = {
      ...(optional(args, 'title') !== undefined ? { title: optional(args, 'title')! } : {}),
      ...(optional(args, 'note') !== undefined ? { note: optional(args, 'note')! } : {}),
      ...(optional(args, 'milestone') !== undefined ? { milestone: optional(args, 'milestone')! } : {}),
      ...(done !== undefined ? { done } : {}),
    };
    if (Object.keys(patch).length === 0) throw new ToolError('say what to change: title, note, milestone or done');
    return report(door(ctx).updateGoal(str(args, 'goal'), patch), []);
  },
};

export const deleteGoal: Tool = {
  name: 'delete_goal',
  description: 'Delete a goal. Its branches become unfiled; nothing on GitHub is touched. Free; undoable, members and all.',
  cost: 'free',
  args: [{ name: 'goal', type: 'string', required: true, about: 'the goal, by its exact title or id' }],
  run(args, ctx) {
    return report(door(ctx).deleteGoal(str(args, 'goal')), []);
  },
};

export const fileBranches: Tool = {
  name: 'file',
  description:
    'File branches under a goal — moving them from wherever they were. A title no goal has yet makes that goal. Do a whole regrouping as one call per goal. Free; undoable.',
  cost: 'free',
  args: [
    { name: 'goal', type: 'string', required: true, about: 'the goal, by its exact title or id — or a new title' },
    { name: 'branches', type: 'list', required: true, about: 'the branches, as "owner/repo name" or just the name' },
  ],
  run(args, ctx) {
    const act = door(ctx);
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`name the branches to file${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.file(str(args, 'goal'), found), missing);
  },
};

export const unfileBranches: Tool = {
  name: 'unfile',
  description: 'Take branches out of whatever goal holds them. Free; undoable.',
  cost: 'free',
  args: [{ name: 'branches', type: 'list', required: true, about: 'the branches, as "owner/repo name" or just the name' }],
  run(args, ctx) {
    const act = door(ctx);
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`name the branches to unfile${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.unfile(found), missing);
  },
};

// ---------------------------------------------------------------------------
// Visions (phase 4)
// ---------------------------------------------------------------------------

export const setVision: Tool = {
  name: 'set_purpose',
  description:
    'Say what branches are FOR — one falsifiable sentence each. yours=true only when the owner told you the purpose in this conversation; otherwise it is saved as your guess, marked for the owner to confirm, and it never replaces the owner\'s own words. Free; undoable.',
  cost: 'free',
  args: [
    { name: 'items', type: 'list', required: true, about: 'a list of {"branch": "owner/repo name", "purpose": "..."}' },
    { name: 'yours', type: 'boolean', required: false, about: "true only when these are the owner's stated purposes" },
  ],
  run(args, ctx) {
    const act = door(ctx);
    const yours = bool(args, 'yours') ?? false;
    const raw = Array.isArray(args['items']) ? (args['items'] as unknown[]) : [];
    const items: { branch: Branch; text: string; yours: boolean }[] = [];
    const missing: string[] = [];
    for (const row of raw) {
      const item = (row ?? {}) as { branch?: unknown; repo?: unknown; purpose?: unknown; vision?: unknown; text?: unknown };
      const text = [item.purpose, item.vision, item.text].find((v): v is string => typeof v === 'string') ?? '';
      // A string goes through the resolver whole, so "owner/repo name" splits as it should.
      const hit = resolveBranch(typeof item.repo === 'string' ? { repo: item.repo, branch: item.branch } : item.branch, ctx.snapshot);
      if (typeof hit === 'string') missing.push(hit);
      else items.push({ branch: hit, text, yours });
    }
    if (items.length === 0) throw new ToolError(`give items as {"branch": "...", "purpose": "..."}${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.setVision(items), missing);
  },
};

export const confirmVision: Tool = {
  name: 'confirm_purpose',
  description: "Accept guesses at what branches are for, as they stand — when the owner says they are right. Free; undoable.",
  cost: 'free',
  args: [{ name: 'branches', type: 'list', required: true, about: 'the branches, as "owner/repo name" or just the name' }],
  run(args, ctx) {
    const act = door(ctx);
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`name the branches${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.confirmVision(found), missing);
  },
};

export const clearVision: Tool = {
  name: 'clear_purpose',
  description: 'Clear what branches are said to be for. Free; undoable.',
  cost: 'free',
  args: [{ name: 'branches', type: 'list', required: true, about: 'the branches, as "owner/repo name" or just the name' }],
  run(args, ctx) {
    const act = door(ctx);
    const { found, missing } = resolveBranches(args, ctx.snapshot);
    if (found.length === 0) throw new ToolError(`name the branches${missing.length ? ` — not found: ${missing.join(', ')}` : ''}`);
    return report(act.clearVision(found), missing);
  },
};
