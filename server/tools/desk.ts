/**
 * The desk's one write: put a job on the board.
 *
 * This is the whole of shape ⑤ (docs/design/agent-shapes.html): the advisor answers in
 * seconds from what it can already see, and when something needs *doing* it queues the
 * work rather than doing it while you wait. One way out, never blocking — the result lands
 * on the page, on the floor, in the brief, and the advisor is told to say so rather than
 * to pretend it is done.
 *
 * What it may queue is exactly what the page's buttons may queue, decided by the same
 * function (`cannotAsk`), so it cannot start work the board would only drop. It is handed
 * a door, never the board: a tool that imported the dispatcher would be a tool that could
 * reach everything the dispatcher can.
 */

import type { JobKind } from '../../shared/types.ts';
import { cannotAsk } from '../work/asks.ts';
import { str, ToolError, type Tool } from './types.ts';

const KINDS: JobKind[] = ['summarise', 'assess', 'draft-vision', 'brief'];

export const dispatchWork: Tool = {
  name: 'dispatch',
  description:
    'Start a piece of work in the background: "summarise" reads a branch again, "assess" checks it against what it is for again, "draft-vision" proposes what it is for, "brief" rewrites the brief. It QUEUES the work — you will not see the result; it lands on the page later. Say that in your answer. Free.',
  cost: 'free',
  args: [
    { name: 'kind', type: 'string', required: true, about: 'summarise | assess | draft-vision | brief' },
    { name: 'repo', type: 'string', required: false, about: 'owner/name, exactly as given. Not for brief' },
    { name: 'branch', type: 'string', required: false, about: 'the literal git branch name, exactly as given. Not for brief' },
  ],

  run(args, ctx) {
    if (!ctx.dispatch) throw new ToolError('this job may not start other work');

    const kind = str(args, 'kind').toLowerCase() as JobKind;
    if (!KINDS.includes(kind)) throw new ToolError(`"${kind}" is not a kind of work. The kinds are: ${KINDS.join(', ')}`);

    if (kind === 'brief') {
      ctx.dispatch('brief', { kind: 'fleet' });
      return 'Queued: writing the brief again. It lands on the page when it is done — you cannot read it now.';
    }

    const repoKey = str(args, 'repo');
    const name = str(args, 'branch');
    const branch = ctx.snapshot.branches.find((b) => b.repoKey === repoKey && b.name === name);
    if (!branch) {
      throw new ToolError(`there is no branch "${name}" in ${repoKey}. Use the exact repo and branch names you were given.`);
    }
    const refused = cannotAsk(kind, branch);
    if (refused) throw new ToolError(refused);

    ctx.dispatch(kind, { kind: 'branch', repoKey, branch: name });
    return `Queued: ${describe(kind, name)}. It runs in the background and lands on the page — you cannot see its result now, so do not describe one.`;
  },
};

function describe(kind: JobKind, name: string): string {
  switch (kind) {
    case 'summarise': return `reading ${name} again`;
    case 'assess': return `checking ${name} against what it is for, again`;
    case 'draft-vision': return `working out what ${name} is for`;
    default: return 'writing the brief again';
  }
}
