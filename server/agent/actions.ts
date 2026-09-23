/**
 * The advisor's action door: every change it can make, in one place (D94).
 *
 * Built once per answer, so each change knows which answer made it and what the owner said.
 * Every method does the same four things, and the order matters:
 *
 *   check it — the same rules the page's own buttons follow, so nothing the owner could
 *              not do by hand is done for them;
 *   apply it — through the store that owns the data (`goals.ts`, `vision.ts`), never around it;
 *   record it — before and after, so it can be listed, found in the feed, and undone;
 *   refresh — so the next tool call in the same answer, and the page, see it at once.
 *
 * Everything here writes Plane B only. There is no method that writes to GitHub.
 */

import { randomUUID } from 'node:crypto';

import { refKey, type Branch, type Goal, type JobKind, type JobSubject, type Snapshot, type Vision } from '../../shared/types.ts';
import type { AnswerChange } from '../advise/ask.ts';
import * as goals from '../goals.ts';
import * as notebook from '../notebook.ts';
import type { ActResult, AgentActions, GoalPatch } from '../tools/types.ts';
import * as visions from '../vision.ts';
import { cannotAsk } from '../work/asks.ts';
import { record, turnEntries, type Entry } from './record.ts';

export type ActionDeps = {
  snapshot: Snapshot;
  /** Put a job on the board — the same door as the page's "read it again". */
  dispatch: (kind: JobKind, subject: JobSubject) => void;
  /** The answer this door belongs to, and what the owner said in it. */
  turn: string;
  words: string;
  /** How many changes the record keeps (Q80). */
  keep: number;
  /** Re-merge Plane B into the snapshot on screen and tell the page. */
  refresh: () => void;
  /** Take a parked job off the shelf — the page's own "try again". */
  retry?: (id: string) => boolean;
};

export type BoundActions = AgentActions & {
  /** Everything this answer changed, from the record — the only source the page lists. */
  did(): AnswerChange[];
};

const q = (text: string): string => `"${text}"`;

export function actionsFor(deps: ActionDeps): BoundActions {
  const entry = (
    kind: Entry['kind'],
    subject: string,
    text: string,
    before: unknown,
    after: unknown,
    extra: Partial<Pick<Entry, 'undoable' | 'flag'>> = {},
  ): Entry => ({
    id: randomUUID(),
    at: new Date().toISOString(),
    turn: deps.turn,
    words: deps.words,
    kind,
    text,
    undoable: extra.undoable ?? true,
    undone: null,
    seen: false,
    flag: extra.flag ?? null,
    subject,
    before,
    after,
  });

  /** Record what was done, refresh once, and hand back the lines. */
  const finish = (entries: Entry[], refused: string[]): ActResult => {
    record(entries, deps.keep);
    if (entries.length > 0) deps.refresh();
    return { done: entries.map((e) => e.text), refused };
  };

  const findGoal = (ref: string): Goal | string => {
    const all = goals.listGoals();
    const byId = all.find((g) => g.id === ref);
    if (byId) return byId;
    const byTitle = all.filter((g) => g.title.trim().toLowerCase() === ref.trim().toLowerCase());
    if (byTitle.length === 1) return byTitle[0]!;
    if (byTitle.length > 1) return `more than one goal is called ${q(ref)} — use its id`;
    return `there is no goal ${q(ref)}`;
  };

  const titleOf = (id: string | null): string => (id ? (goals.getGoal(id)?.title ?? 'a goal since deleted') : 'nothing');
  const ref = (b: Branch) => ({ repoKey: b.repoKey, branch: b.name });

  const queueWords: Record<'summarise' | 'assess' | 'draft-vision', string> = {
    summarise: 'queued to be read again',
    assess: 'queued to be checked against its purpose again',
    'draft-vision': 'queued for a fresh guess at what it is for',
  };

  return {
    did: () => turnEntries(deps.turn).map((e) => ({ id: e.id, text: e.text })),

    // -------------------------------------------------------------- the board

    queue(kind, branches) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      for (const branch of branches) {
        // The page's rule, so the advisor can queue nothing the board would only drop.
        const why = cannotAsk(kind, branch);
        if (why) {
          refused.push(why);
          continue;
        }
        deps.dispatch(kind, { kind: 'branch', repoKey: branch.repoKey, branch: branch.name });
        entries.push(entry('queue', refKey(branch.repoKey, branch.name), `${branch.name}: ${queueWords[kind]}`, null, kind, { undoable: false }));
      }
      return finish(entries, refused);
    },

    queueBrief() {
      deps.dispatch('brief', { kind: 'fleet' });
      return finish([entry('queue', 'brief', 'The brief: queued to be written again', null, 'brief', { undoable: false })], []);
    },

    // -------------------------------------------------------------- goals

    createGoal(title, note, milestone) {
      const clean = title.trim();
      if (!clean) return finish([], ['a goal needs a title']);
      if (goals.listGoals().some((g) => g.title.trim().toLowerCase() === clean.toLowerCase())) {
        return finish([], [`a goal called ${q(clean)} already exists`]);
      }
      const goal = goals.createGoal({ title: clean, note, milestone });
      const after = { title: goal.title, note: goal.note, milestone: goal.milestone, done: goal.done };
      return finish([entry('goal.create', goal.id, `Goal ${q(goal.title)} created`, null, after)], []);
    },

    updateGoal(goalRef, patch) {
      const goal = findGoal(goalRef);
      if (typeof goal === 'string') return finish([], [goal]);
      const before: GoalPatch = {};
      const after: GoalPatch = {};
      const said: string[] = [];
      if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== goal.title) {
        before.title = goal.title; after.title = patch.title.trim(); said.push(`renamed to ${q(after.title)}`);
      }
      if (patch.note !== undefined && patch.note.trim() !== goal.note) {
        before.note = goal.note; after.note = patch.note.trim(); said.push(after.note ? 'note changed' : 'note cleared');
      }
      if (patch.milestone !== undefined && patch.milestone.trim() !== goal.milestone) {
        before.milestone = goal.milestone; after.milestone = patch.milestone.trim(); said.push(`milestone ${after.milestone ? q(after.milestone) : 'cleared'}`);
      }
      if (patch.done !== undefined && patch.done !== goal.done) {
        before.done = goal.done; after.done = patch.done; said.push(patch.done ? 'marked done' : 'marked not done');
      }
      if (said.length === 0) return finish([], [`goal ${q(goal.title)} is already like that`]);
      if (after.title && goals.listGoals().some((g) => g.id !== goal.id && g.title.trim().toLowerCase() === after.title!.toLowerCase())) {
        return finish([], [`another goal is already called ${q(after.title)}`]);
      }
      goals.updateGoal(goal.id, after);
      // Marked done is flagged: the change the owner asked to be told about (Q78).
      const flag = after.done === true ? 'goal-done' : null;
      return finish([entry('goal.update', goal.id, `Goal ${q(goal.title)}: ${said.join(', ')}`, before, after, { flag })], []);
    },

    deleteGoal(goalRef) {
      const goal = findGoal(goalRef);
      if (typeof goal === 'string') return finish([], [goal]);
      // All of it, members included, so undo can put it back exactly.
      const before = goals.getGoal(goal.id);
      goals.deleteGoal(goal.id);
      const members = goal.branches.length;
      return finish([entry('goal.delete', goal.id, `Goal ${q(goal.title)} deleted${members ? ` (${members} branch${members === 1 ? '' : 'es'} now unfiled)` : ''}`, before, null)], []);
    },

    // -------------------------------------------------------------- filing

    file(goalRef, branches) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      let goal = findGoal(goalRef);
      if (typeof goal === 'string') {
        if (goal.startsWith('more than one')) return finish([], [goal]);
        // A title nobody has used: filing under it is how a new goal is made.
        const made = goals.createGoal({ title: goalRef.trim() });
        entries.push(entry('goal.create', made.id, `Goal ${q(made.title)} created`, null, { title: made.title, note: '', milestone: '', done: false }));
        goal = made;
      }
      for (const branch of branches) {
        if (branch.isBase) { refused.push(`${branch.name} is the base branch and is never filed`); continue; }
        const before = goals.goalOf(ref(branch));
        if (before === goal.id) { refused.push(`${branch.name} is already under ${q(goal.title)}`); continue; }
        goals.assignBranch(ref(branch), goal.id);
        const text = before
          ? `${branch.name}: moved from ${q(titleOf(before))} to ${q(goal.title)}`
          : `${branch.name}: filed under ${q(goal.title)}`;
        entries.push(entry('file', refKey(branch.repoKey, branch.name), text, before, goal.id));
      }
      return finish(entries, refused);
    },

    unfile(branches) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      for (const branch of branches) {
        const before = goals.goalOf(ref(branch));
        if (!before) { refused.push(`${branch.name} is not filed`); continue; }
        goals.assignBranch(ref(branch), null);
        entries.push(entry('file', refKey(branch.repoKey, branch.name), `${branch.name}: taken out of ${q(titleOf(before))}`, before, null));
      }
      return finish(entries, refused);
    },

    // -------------------------------------------------------------- visions

    setVision(items) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      for (const { branch, text, yours } of items) {
        const clean = text.trim();
        if (!clean) { refused.push(`${branch.name}: a purpose needs some words`); continue; }
        const before = visions.getVision(ref(branch));
        // A guess never replaces the owner's words (D61). Only what they said may.
        if (!yours && before && before.state !== 'proposed') {
          refused.push(`${branch.name}: the owner already said what it is for — change it only if they tell you to`);
          continue;
        }
        if (before?.text === clean && before.state === (yours ? 'yours' : 'proposed')) {
          refused.push(`${branch.name}: already says that`);
          continue;
        }
        const after = visions.setVision(ref(branch), clean, yours ? 'yours' : 'proposed', {
          from: yours ? '' : 'the agent, when asked',
          draftedAt: yours ? null : branch.headSha,
        });
        entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: ${yours ? 'purpose set' : 'purpose guessed'} — ${q(clean)}`, before, after));
      }
      return finish(entries, refused);
    },

    confirmVision(branches) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      for (const branch of branches) {
        const before = visions.getVision(ref(branch));
        if (!before) { refused.push(`${branch.name}: nobody has said what it is for`); continue; }
        if (before.state !== 'proposed') { refused.push(`${branch.name}: already the owner's words`); continue; }
        const after = visions.confirmVision(ref(branch));
        entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: purpose confirmed`, before, after));
      }
      return finish(entries, refused);
    },

    clearVision(branches) {
      const entries: Entry[] = [];
      const refused: string[] = [];
      for (const branch of branches) {
        const before: Vision | null = visions.getVision(ref(branch));
        if (!before) { refused.push(`${branch.name}: nobody has said what it is for`); continue; }
        visions.clearVision(ref(branch));
        entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: purpose cleared`, before, null));
      }
      return finish(entries, refused);
    },

    // -------------------------------------------------------------- the notebook

    remember(kind, text) {
      const clean = text.trim();
      if (!clean) return finish([], ['nothing to write down']);
      if (notebook.listNotes(kind).some((n) => n.text.toLowerCase() === clean.toLowerCase())) {
        return finish([], ['that is already in the notebook']);
      }
      const note = notebook.addNote(kind, clean);
      const entries = [entry('note', note.id, `${kind === 'brief' ? 'For the brief' : 'Remembered'}: ${q(clean)}`, null, note)];
      if (kind === 'brief') {
        // An instruction for the brief means little until the brief follows it.
        deps.dispatch('brief', { kind: 'fleet' });
        entries.push(entry('queue', 'brief', 'The brief: queued to be written again with it', null, 'brief', { undoable: false }));
      }
      return finish(entries, []);
    },

    forget(ref) {
      const all = notebook.listNotes();
      const note = all.find((n) => n.id === ref.trim()) ?? all.find((n) => n.text.toLowerCase() === ref.trim().toLowerCase());
      if (!note) return finish([], [`no note ${q(ref)} — the notebook lists each with its id`]);
      notebook.removeNote(note.id);
      const entries = [entry('note', note.id, `${note.kind === 'brief' ? 'Brief instruction' : 'Note'} removed: ${q(note.text)}`, note, null)];
      if (note.kind === 'brief') {
        deps.dispatch('brief', { kind: 'fleet' });
        entries.push(entry('queue', 'brief', 'The brief: queued to be written again without it', null, 'brief', { undoable: false }));
      }
      return finish(entries, []);
    },

    // -------------------------------------------------------------- the board

    retry(jobs) {
      const parked = deps.snapshot.work.jobs.filter((j) => j.state === 'parked');
      const wanted = jobs === 'all' ? parked : parked.filter((j) => jobs.includes(j.id));
      const refused = jobs === 'all' ? [] : jobs.filter((id) => !parked.some((j) => j.id === id)).map((id) => `${id} is not parked`);
      if (!deps.retry) return finish([], ['retrying is not available here']);
      const entries: Entry[] = [];
      for (const job of wanted) {
        if (deps.retry(job.id)) {
          entries.push(entry('queue', job.id, `Tried again: ${job.title}`, null, 'retry', { undoable: false }));
        }
      }
      if (wanted.length === 0 && refused.length === 0) refused.push('nothing is parked');
      return finish(entries, refused);
    },
  };
}
