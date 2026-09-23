/**
 * The advisor's action door: every change it can make, in one place (D94).
 *
 * Built once per answer, so each change knows which answer made it and what the owner said.
 * Everything here writes Plane B only — goals, visions, the program's own queue — through
 * the same stores the page's buttons use, and checks what the page's buttons check.
 */

import type { JobKind, JobSubject, Snapshot } from '../../shared/types.ts';
import type { AnswerChange } from '../advise/ask.ts';
import type { ActResult, AgentActions } from '../tools/types.ts';
import { cannotAsk } from '../work/asks.ts';

export type ActionDeps = {
  snapshot: Snapshot;
  /** Put a job on the board — the same door as the page's "read it again". */
  dispatch: (kind: JobKind, subject: JobSubject) => void;
};

export type BoundActions = AgentActions & {
  /** Everything this answer changed, in the order it happened. */
  did(): AnswerChange[];
};

export function actionsFor(deps: ActionDeps): BoundActions {
  const did: AnswerChange[] = [];

  const words: Record<'summarise' | 'assess' | 'draft-vision', string> = {
    summarise: 'read again',
    assess: 'checked against its purpose again',
    'draft-vision': 'what it is for, drafted again',
  };

  return {
    did: () => [...did],

    queue(kind, branches): ActResult {
      const out: ActResult = { done: [], refused: [] };
      for (const branch of branches) {
        // The page's rule, so the advisor can queue nothing the board would only drop.
        const refused = cannotAsk(kind, branch);
        if (refused) {
          out.refused.push(refused);
          continue;
        }
        deps.dispatch(kind, { kind: 'branch', repoKey: branch.repoKey, branch: branch.name });
        out.done.push(`${branch.name}: ${words[kind]} (queued)`);
      }
      did.push(...out.done.map((text) => ({ id: null, text })));
      return out;
    },

    queueBrief(): ActResult {
      deps.dispatch('brief', { kind: 'fleet' });
      const line = 'the brief: written again (queued)';
      did.push({ id: null, text: line });
      return { done: [line], refused: [] };
    },
  };
}
