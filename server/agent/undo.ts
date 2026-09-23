/**
 * Taking a change back — one, or everything one prompt changed (Q81: never ask, undo instead).
 *
 * Every undo checks first that the thing it touched is still as the change left it. If the
 * owner, or a later change, has edited it since, reverting would silently throw that newer
 * work away — so it says what moved instead, and leaves it alone.
 */

import { refKey, type Goal, type Note, type Vision } from '../../shared/types.ts';
import * as goals from '../goals.ts';
import * as notebook from '../notebook.ts';
import type { GoalPatch } from '../tools/types.ts';
import * as visions from '../vision.ts';
import { findEntry, markUndone, turnEntries, type Entry } from './record.ts';

/** `brief` when the change was one of the brief's instructions — the brief should be rewritten. */
export type Undone = { id: string; ok: boolean; text: string; brief?: boolean };

const q = (text: string): string => `"${text}"`;

export function undoChange(id: string): Undone {
  const entry = findEntry(id);
  if (!entry) return { id, ok: false, text: 'that change is no longer in the record' };
  const result = revert(entry);
  if (result.ok) markUndone(id);
  return { id, ...result };
}

/** Everything one answer changed, newest first — the order that unpicks it cleanly. */
export function undoTurn(turn: string): Undone[] {
  return turnEntries(turn)
    .filter((e) => e.undoable && !e.undone)
    .reverse()
    .map((e) => undoChange(e.id));
}

function revert(entry: Entry): { ok: boolean; text: string; brief?: boolean } {
  if (entry.undone) return { ok: false, text: 'already undone' };
  if (!entry.undoable) return { ok: false, text: 'queued work runs whatever happens next, so it cannot be taken back' };

  switch (entry.kind) {
    case 'goal.create': {
      const goal = goals.getGoal(entry.subject);
      if (!goal) return { ok: true, text: `${entry.text} — it was already gone` };
      if (goal.branches.length > 0) {
        return { ok: false, text: `goal ${q(goal.title)} has branches in it now — undo the filing first, or delete it` };
      }
      if (!matches(goal, entry.after as GoalPatch)) return { ok: false, text: `goal ${q(goal.title)} has been changed since` };
      goals.deleteGoal(goal.id);
      return { ok: true, text: `Goal ${q(goal.title)} removed` };
    }

    case 'goal.update': {
      const goal = goals.getGoal(entry.subject);
      if (!goal) return { ok: false, text: 'that goal has been deleted since' };
      if (!matches(goal, entry.after as GoalPatch)) return { ok: false, text: `goal ${q(goal.title)} has been changed since` };
      goals.updateGoal(goal.id, entry.before as GoalPatch);
      return { ok: true, text: `Goal ${q(goal.title)} put back as it was` };
    }

    case 'goal.delete': {
      if (goals.getGoal(entry.subject)) return { ok: false, text: 'that goal exists again' };
      const { goal, skipped } = goals.restoreGoal(entry.before as Goal);
      const note = skipped.length > 0 ? ` (${skipped.map((b) => b.branch).join(', ')} filed elsewhere since, so left there)` : '';
      return { ok: true, text: `Goal ${q(goal.title)} restored${note}` };
    }

    case 'file': {
      const [repoKey, branch] = JSON.parse(entry.subject) as [string, string];
      const ref = { repoKey, branch };
      const now = goals.goalOf(ref);
      if (now !== (entry.after as string | null)) return { ok: false, text: `${branch} has been moved since` };
      const back = entry.before as string | null;
      if (back && !goals.getGoal(back)) return { ok: false, text: `${branch}: the goal it was in has been deleted since` };
      goals.assignBranch(ref, back);
      return { ok: true, text: `${branch}: put back` };
    }

    case 'vision': {
      const [repoKey, branch] = JSON.parse(entry.subject) as [string, string];
      const ref = { repoKey, branch };
      if (!sameVision(visions.getVision(ref), entry.after as Vision | null)) {
        return { ok: false, text: `${branch}: what it is for has been changed since` };
      }
      const before = entry.before as Vision | null;
      if (before) visions.setVision(ref, before.text, before.state, { from: before.from, draftedAt: before.draftedAt });
      else visions.clearVision(ref);
      return { ok: true, text: `${branch}: purpose put back` };
    }

    case 'note': {
      const added = entry.after as Note | null;
      const removed = entry.before as Note | null;
      if (added) {
        const now = notebook.listNotes().find((n) => n.id === added.id);
        if (!now) return { ok: true, text: `${q(added.text)} was already gone` };
        if (now.text !== added.text) return { ok: false, text: 'that note has been changed since' };
        notebook.removeNote(added.id);
        return { ok: true, text: `${q(added.text)} taken out of the notebook`, brief: added.kind === 'brief' };
      }
      if (removed) {
        notebook.restoreNote(removed);
        return { ok: true, text: `${q(removed.text)} put back in the notebook`, brief: removed.kind === 'brief' };
      }
      return { ok: false, text: 'nothing to undo' };
    }

    default:
      return { ok: false, text: 'this kind of change cannot be undone' };
  }
}

/** The goal still says what the change made it say, on every field the change touched. */
function matches(goal: Goal, after: GoalPatch): boolean {
  return (Object.keys(after) as (keyof GoalPatch)[]).every((key) => goal[key] === after[key]);
}

const sameVision = (a: Vision | null, b: Vision | null): boolean =>
  a === null || b === null ? a === b : a.text === b.text && a.state === b.state;

export const refOf = (repoKey: string, branch: string): string => refKey(repoKey, branch);
