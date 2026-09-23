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
import { ToolError, type ActResult, type AgentActions, type GoalPatch } from '../tools/types.ts';
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

/** Where a guess the agent wrote says it came from — and how undo tells it from a station's. */
export const AGENT_GUESS = 'the agent, when asked';

export function actionsFor(deps: ActionDeps): BoundActions {
  /** What this door recorded — so an answer lists its own changes, not its turn's. */
  const mine = new Set<string>();

  const entry = (
    kind: Entry['kind'],
    subject: string,
    text: string,
    before: unknown,
    after: unknown,
    extra: Partial<Pick<Entry, 'undoable' | 'flag' | 'assessment'>> = {},
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
    ...(extra.assessment ? { assessment: extra.assessment } : {}),
  });

  /**
   * Every method runs here: check, apply, record, refresh.
   *
   * If a store cannot be written part-way through a batch — a locked file on Windows, a
   * full disk — what was applied before it is still recorded and still put on screen, and
   * the failure goes back to the model as something it can say, rather than an exception
   * that loses the whole answer and hides what it had already changed.
   */
  const run = (body: (entries: Entry[], refused: string[]) => void): ActResult => {
    const entries: Entry[] = [];
    const refused: string[] = [];
    let failure: unknown = null;
    try {
      body(entries, refused);
    } catch (err) {
      failure = err;
    }
    let unrecorded = false;
    try {
      record(entries, deps.keep);
      for (const e of entries) mine.add(e.id);
    } catch (err) {
      unrecorded = true;
      failure ??= err;
    } finally {
      if (entries.length > 0) deps.refresh();
    }
    if (failure) {
      const why = failure instanceof Error ? failure.message : String(failure);
      const made = entries.length > 0
        ? unrecorded
          ? ` ${entries.length} change(s) were made but could not be written to the record, so they cannot be undone from here: ${entries.map((e) => e.text).join('; ')}.`
          : ` The ${entries.length} change(s) before it were made: ${entries.map((e) => e.text).join('; ')}.`
        : ' Nothing was changed.';
      throw new ToolError(`could not save that (${why}).${made}`);
    }
    return { done: entries.map((e) => e.text), refused };
  };

  const findGoal = (ref: string): Goal | string => {
    const all = goals.listGoals();
    const byId = all.find((g) => g.id === ref.trim());
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
    did: () =>
      turnEntries(deps.turn)
        .filter((e) => mine.has(e.id))
        .map((e) => ({ id: e.id, text: e.text, undoable: e.undoable, undone: e.undone !== null })),

    // -------------------------------------------------------------- the board

    queue(kind, branches) {
      return run((entries, refused) => {
        for (const branch of branches) {
          // The page's rule, so the advisor can queue nothing the board would only drop.
          const why = cannotAsk(kind, branch);
          if (why) { refused.push(why); continue; }
          deps.dispatch(kind, { kind: 'branch', repoKey: branch.repoKey, branch: branch.name });
          entries.push(entry('queue', refKey(branch.repoKey, branch.name), `${branch.name}: ${queueWords[kind]}`, null, kind, { undoable: false }));
        }
      });
    },

    queueBrief() {
      return run((entries) => {
        deps.dispatch('brief', { kind: 'fleet' });
        entries.push(entry('queue', 'brief', 'The brief: queued to be written again', null, 'brief', { undoable: false }));
      });
    },

    // -------------------------------------------------------------- goals

    createGoal(title, note, milestone) {
      return run((entries, refused) => {
        const clean = oneLine(title);
        if (!clean) { refused.push('a goal needs a title'); return; }
        if (goals.listGoals().some((g) => g.title.trim().toLowerCase() === clean.toLowerCase())) {
          refused.push(`a goal called ${q(clean)} already exists`);
          return;
        }
        const goal = goals.createGoal({ title: clean, note, milestone });
        const after = { title: goal.title, note: goal.note, milestone: goal.milestone, done: goal.done };
        entries.push(entry('goal.create', goal.id, `Goal ${q(goal.title)} created`, null, after));
      });
    },

    updateGoal(goalRef, patch) {
      return run((entries, refused) => {
        const goal = findGoal(goalRef);
        if (typeof goal === 'string') { refused.push(goal); return; }
        const before: GoalPatch = {};
        const after: GoalPatch = {};
        const said: string[] = [];
        const title = patch.title !== undefined ? oneLine(patch.title) : '';
        if (title && title !== goal.title) {
          before.title = goal.title; after.title = title; said.push(`renamed to ${q(title)}`);
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
        if (said.length === 0) { refused.push(`goal ${q(goal.title)} is already like that`); return; }
        if (after.title && goals.listGoals().some((g) => g.id !== goal.id && g.title.trim().toLowerCase() === after.title!.toLowerCase())) {
          refused.push(`another goal is already called ${q(after.title)}`);
          return;
        }
        goals.updateGoal(goal.id, after);
        // Marked done is flagged: the change the owner asked to be told about (Q78).
        const flag = after.done === true ? 'goal-done' : null;
        entries.push(entry('goal.update', goal.id, `Goal ${q(goal.title)}: ${said.join(', ')}`, before, after, { flag }));
      });
    },

    deleteGoal(goalRef) {
      return run((entries, refused) => {
        const goal = findGoal(goalRef);
        if (typeof goal === 'string') { refused.push(goal); return; }
        // All of it, members included, so undo can put it back exactly.
        const before = goals.getGoal(goal.id);
        goals.deleteGoal(goal.id);
        const members = goal.branches.length;
        entries.push(entry('goal.delete', goal.id, `Goal ${q(goal.title)} deleted${members ? ` (${members} branch${members === 1 ? '' : 'es'} now unfiled)` : ''}`, before, null));
      });
    },

    // -------------------------------------------------------------- filing

    file(goalRef, branches) {
      return run((entries, refused) => {
        let goal = findGoal(goalRef);
        if (typeof goal === 'string') {
          if (goal.startsWith('more than one')) { refused.push(goal); return; }
          const why = notATitle(goalRef);
          if (why) { refused.push(why); return; }
          // A title nobody has used: filing under it is how a new goal is made.
          const made = goals.createGoal({ title: oneLine(goalRef) });
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
      });
    },

    unfile(branches) {
      return run((entries, refused) => {
        for (const branch of branches) {
          const before = goals.goalOf(ref(branch));
          if (!before) { refused.push(`${branch.name} is not filed`); continue; }
          goals.assignBranch(ref(branch), null);
          entries.push(entry('file', refKey(branch.repoKey, branch.name), `${branch.name}: taken out of ${q(titleOf(before))}`, before, null));
        }
      });
    },

    // -------------------------------------------------------------- visions

    setVision(items) {
      return run((entries, refused) => {
        for (const item of items) {
          const { branch } = item;
          const clean = item.text.trim();
          if (!clean) { refused.push(`${branch.name}: a purpose needs some words`); continue; }
          // "The owner's words" means words the owner used in this message. The model's say-so
          // is not enough: a line in a commit message could otherwise talk it into writing a
          // guess as if the owner had said it — and a guess never replaces the owner's words.
          const yours = item.yours && inTheirWords(clean, deps.words);
          const demoted = item.yours && !yours;
          const before = visions.getVision(ref(branch));
          // A guess never replaces the owner's words (D61). Only what they said may.
          if (!yours && before && before.state !== 'proposed') {
            refused.push(`${branch.name}: the owner already said what it is for — change it only in their words${demoted ? ' (these are not the words they used)' : ''}`);
            continue;
          }
          // Nor after clearing them in the same answer, which would be the same thing in two steps.
          if (!yours && clearedTheirs(branch)) {
            refused.push(`${branch.name}: its purpose was the owner's until this answer cleared it — a guess cannot take its place`);
            continue;
          }
          if (before?.text === clean && before.state === (yours ? 'yours' : 'proposed')) {
            refused.push(`${branch.name}: already says that`);
            continue;
          }
          const judged = before && before.text !== clean ? visions.assessmentOf(ref(branch)) : null;
          const after = visions.setVision(ref(branch), clean, yours ? 'yours' : 'proposed', {
            from: yours ? '' : AGENT_GUESS,
            draftedAt: yours ? null : branch.headSha,
          });
          const said = yours ? 'purpose set' : demoted ? 'purpose written as a guess (not the owner\'s words)' : 'purpose guessed';
          entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: ${said} — ${q(clean)}`, before, after, { assessment: judged }));
        }
      });
    },

    confirmVision(branches) {
      return run((entries, refused) => {
        for (const branch of branches) {
          const before = visions.getVision(ref(branch));
          if (!before) { refused.push(`${branch.name}: nobody has said what it is for`); continue; }
          if (before.state !== 'proposed') { refused.push(`${branch.name}: already the owner's words`); continue; }
          const after = visions.confirmVision(ref(branch));
          entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: purpose confirmed`, before, after));
        }
      });
    },

    clearVision(branches) {
      return run((entries, refused) => {
        for (const branch of branches) {
          const before: Vision | null = visions.getVision(ref(branch));
          if (!before) { refused.push(`${branch.name}: nobody has said what it is for`); continue; }
          const judged = visions.assessmentOf(ref(branch));
          visions.clearVision(ref(branch));
          entries.push(entry('vision', refKey(branch.repoKey, branch.name), `${branch.name}: purpose cleared`, before, null, { assessment: judged }));
        }
      });
    },

    // -------------------------------------------------------------- the notebook

    remember(kind, text) {
      return run((entries, refused) => {
        const clean = notebook.oneLine(text);
        if (!clean) { refused.push('nothing to write down'); return; }
        if (notebook.listNotes(kind).some((n) => n.text.toLowerCase() === clean.toLowerCase())) {
          refused.push('that is already in the notebook');
          return;
        }
        const note = notebook.addNote(kind, clean);
        entries.push(entry('note', note.id, `${kind === 'brief' ? 'For the brief' : 'Remembered'}: ${q(clean)}`, null, note));
        if (kind === 'brief') {
          // An instruction for the brief means little until the brief follows it.
          deps.dispatch('brief', { kind: 'fleet' });
          entries.push(entry('queue', 'brief', 'The brief: queued to be written again with it', null, 'brief', { undoable: false }));
        }
      });
    },

    forget(noteRef) {
      return run((entries, refused) => {
        const all = notebook.listNotes();
        const want = noteRef.trim();
        const note = all.find((n) => n.id === want) ?? all.find((n) => n.text.toLowerCase() === want.toLowerCase());
        if (!note) { refused.push(`no note ${q(noteRef)} — the notebook lists each with its id`); return; }
        notebook.removeNote(note.id);
        entries.push(entry('note', note.id, `${note.kind === 'brief' ? 'Brief instruction' : 'Note'} removed: ${q(note.text)}`, note, null));
        if (note.kind === 'brief') {
          deps.dispatch('brief', { kind: 'fleet' });
          entries.push(entry('queue', 'brief', 'The brief: queued to be written again without it', null, 'brief', { undoable: false }));
        }
      });
    },

    // -------------------------------------------------------------- the board

    retry(jobs) {
      return run((entries, refused) => {
        if (!deps.retry) { refused.push('retrying is not available here'); return; }
        const parked = deps.snapshot.work.jobs.filter((j) => j.state === 'parked');
        const wanted = jobs === 'all' ? parked : parked.filter((j) => jobs.includes(j.id));
        if (jobs !== 'all') for (const id of jobs) if (!parked.some((j) => j.id === id)) refused.push(`${id} is not parked`);
        for (const job of wanted) {
          if (deps.retry(job.id)) entries.push(entry('queue', job.id, `Tried again: ${job.title}`, null, 'retry', { undoable: false }));
        }
        if (wanted.length === 0 && refused.length === 0) refused.push('nothing is parked');
      });
    },
  };

  /** This answer already cleared the owner's own words from this branch. */
  function clearedTheirs(branch: Branch): boolean {
    const key = refKey(branch.repoKey, branch.name);
    return turnEntries(deps.turn).some((e) =>
      e.kind === 'vision' && e.subject === key && e.undone === null && e.after === null
      && (e.before as Vision | null)?.state !== undefined && (e.before as Vision).state !== 'proposed');
  }
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Why this is not a title to make a new goal from, or null. The prompt shows goal ids, and
 * a model that mistypes one would otherwise create a goal called "71d9ce5f-b640-462a"; and
 * "unfiled" is how a proposal says "no goal", not a goal's name.
 */
function notATitle(ref: string): string | null {
  const text = ref.trim();
  if (/^(unfiled|no goal|none|nothing)$/i.test(text)) return 'to take branches out of their goal, use unfile';
  if (/^[0-9a-f]{6,}(?:-[0-9a-f]*)*$/i.test(text) && /\d/.test(text)) {
    return `no goal has the id ${q(text)} — use an id or a title from the goal list, or a new title to make one`;
  }
  return null;
}

/**
 * Whether a purpose is in the owner's words from this message: most of its meaningful
 * words appear in what they said. Paraphrase fails, and is written as a guess — which they
 * confirm with one click — rather than as something they said.
 */
export function inTheirWords(purpose: string, said: string): boolean {
  const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? [];
  const theirs = new Set(words(said));
  const mine = [...new Set(words(purpose))];
  if (mine.length === 0) return false;
  return mine.filter((w) => theirs.has(w)).length * 2 >= mine.length;
}
