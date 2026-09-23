/**
 * The standing column: the register, the conditions, the notices.
 *
 * The register is grouped by goal because that is how the work is actually organised —
 * the owner reads down it to check whether the filing is right. It is a listing, not a
 * summary: literal branch names, ahead/behind, age, nothing else. No diffstats.
 */

import type { Branch, Change, Snapshot } from '../../shared/types.ts';
import { elapsed, esc, plural, relativeTime } from '../format.ts';
import {
  dotClass,
  floor,
  groupByGoal,
  jobKindLabel,
  matches,
  questions,
  tallies,
  threads,
  toolLabel,
  type Question,
} from '../derive.ts';
import { branchKey, shortRepo } from './leader.ts';

export function renderRegister(snapshot: Snapshot, search: string, selected: string | null): string {
  const visible = threads(snapshot).filter((b) => matches(b, search));
  const groups = groupByGoal(snapshot, visible);

  if (groups.length === 0) {
    return `<div class="quietnote">Nothing to list yet. Once a read completes, every branch
      in every repo lands here.</div>`;
  }

  return groups
    .map((group) => {
      const title = group.goal ? esc(group.goal.title) : 'Unfiled';
      const done = group.goal?.done ? ' · done' : '';
      return `<div class="gsec ${group.goal ? '' : 'unfiled'}">
        <div class="ghead">
          <span class="nm">${title}</span>
          <span class="n">${group.branches.length}${done}</span>
        </div>
        ${
          group.branches.length === 0
            ? '<div class="quietnote" style="padding:4px 0">empty</div>'
            : group.branches
                .map(
                  (branch) => `<button class="listing ${branchKey(branch) === selected ? 'sel' : ''}"
                    data-file="${esc(branchKey(branch))}"
                    title="${esc(branch.repoKey)} — click to file under a different goal">
                    <span class="dot ${dotClass(branch)}"></span>
                    <span class="nm">${esc(branch.name)}</span>
                    <span class="v ${branch.behind > branch.ahead ? 'dn' : ''}">${branch.ahead}/${branch.behind}</span>
                    <span class="t">${relativeTime(branch.lastActivity)}</span>
                  </button>`,
                )
                .join('')
        }
      </div>`;
    })
    .join('');
}

export function renderConditions(snapshot: Snapshot): string {
  const t = tallies(snapshot);
  const rows: string[] = [
    `<div><b>${t.active}</b> branches moving</div>`,
    `<div class="${t.failing > 0 ? 'bad' : ''}"><b>${t.failing}</b> with red CI</div>`,
    `<div><b>${t.openPrs}</b> pull requests open</div>`,
    `<div><b>${t.quiet}</b> gone quiet</div>`,
    `<div><b>${t.goals}</b> goals in play</div>`,
    `<div><b>${t.unfiled}</b> branches unfiled</div>`,
  ];
  if (t.folded > 0) rows.push(`<div><b>${t.folded}</b> folded away, still tracked</div>`);
  return rows.join('');
}

export function renderNotices(snapshot: Snapshot, response: { error: string | null }): string {
  const out: string[] = [];

  if (response.error) out.push(`<div class="notice">${esc(response.error)}</div>`);
  for (const warning of snapshot.warnings) out.push(`<div class="notice">${esc(warning)}</div>`);
  for (const error of snapshot.llm.errors.slice(0, 3)) {
    out.push(`<div class="notice">advisor: ${esc(error)}</div>`);
  }

  const t = tallies(snapshot);
  if (t.awaitingSummary > 0) {
    out.push(`<div class="quietnote">${t.awaitingSummary} ${t.awaitingSummary === 1 ? 'branch is' : 'branches are'}
      still waiting on a summary. They are listed with their newest commit instead.</div>`);
  }
  if (!snapshot.llm.enabled) {
    out.push(`<div class="quietnote">The advisor is off, so every headline is the newest
      commit message rather than a written one.</div>`);
  }
  if (t.folded > 0) {
    out.push(`<div class="quietnote">${t.folded} branches exist on GitHub that this read is not
      carrying. Nothing is ever deleted — raise “commits per branch” or add the repo in settings
      if one you want is missing.</div>`);
  }

  return out.length > 0 ? out.join('') : '<div class="quietnote">Nothing to report.</div>';
}

// ---------------------------------------------------------------------------
// The floor — who is working, on what, and what is queued behind them
// ---------------------------------------------------------------------------

/**
 * The honest view of what the assistant is doing (D73).
 *
 * The headline of every row is the job's own plain-English title; the kind and the clock
 * are supporting metadata (rule 3). Nothing is computed here — `floor()` groups what the
 * Snapshot already carries.
 *
 * "Nothing to do" is the most common state and the correct one, so it says that rather
 * than rendering an empty box that looks broken.
 */
const MAX_PARKED_ROWS = 6;

export function renderFloor(snapshot: Snapshot, now = new Date()): string {
  const board = floor(snapshot);

  if (
    board.working.length === 0 &&
    board.waiting.length === 0 &&
    board.parked.length === 0 &&
    board.finished.length === 0
  ) {
    return `<div class="quietnote">${
      snapshot.llm.enabled
        ? 'Nothing to do — everything on screen is up to date.'
        : 'The advisor is off, so there is nothing for the room to do.'
    }</div>`;
  }

  const rows: string[] = [];

  for (const job of board.working) {
    // What it is doing right now beats what kind of job it is: "reading the branches next
    // to it" is the answer to the question the panel exists to answer.
    const meta = [
      job.doing ? toolLabel(job.doing) : jobKindLabel(job.kind),
      job.toolCalls > 0 && !job.doing ? plural(job.toolCalls, 'lookup') : '',
      job.origin === 'dispatched' ? 'you asked for this' : '',
    ].filter(Boolean);

    rows.push(`<div class="jrow live">
      <span class="jglyph">&#9670;</span>
      <span class="jbody">
        <span class="jtitle">${esc(job.title)}</span>
        <span class="jmeta">${esc(meta.join(' \u00b7 '))}</span>
      </span>
      <span class="jclock">${esc(elapsed(job.startedAt, now))}</span>
    </div>`);
  }

  if (board.waiting.length > 0) {
    const detail = board.queued
      .map((q) => `${esc(jobKindLabel(q.kind))} ${q.count}`)
      .join(' · ');
    rows.push(`<div class="jrow">
      <span class="jglyph dim">&middot;</span>
      <span class="jbody">
        <span class="jtitle dim">${plural(board.waiting.length, 'job')} waiting</span>
        <span class="jmeta">${detail}</span>
      </span>
    </div>`);
  }

  // What you asked for, now done. You are told because the point of asking was to stop
  // watching; it ages out rather than needing dismissal (Q71).
  for (const job of board.finished) {
    rows.push(`<div class="jrow done">
      <span class="jglyph">&#10003;</span>
      <span class="jbody">
        <span class="jtitle">${esc(job.title)}</span>
        <span class="jmeta">you asked for this &middot; done</span>
      </span>
      <span class="jclock">${esc(relativeTime(job.finishedAt ?? null, now))}</span>
    </div>`);
  }

  // A provider outage can park a great many at once, and forty identical rows is a wall
  // rather than a panel. The first few say what is wrong; the count says how wide it is.
  for (const job of board.parked.slice(0, MAX_PARKED_ROWS)) {
    rows.push(`<div class="jrow bad">
      <span class="jglyph">&#9873;</span>
      <span class="jbody">
        <span class="jtitle">${esc(job.title)}</span>
        <span class="jmeta">${esc(job.error ?? 'failed twice')}</span>
      </span>
      <span class="jclock">parked</span>
    </div>`);
  }

  if (board.parked.length > MAX_PARKED_ROWS) {
    rows.push(`<div class="jrow bad">
      <span class="jglyph">&#9873;</span>
      <span class="jbody"><span class="jtitle dim">${plural(board.parked.length - MAX_PARKED_ROWS, 'more')} parked</span></span>
    </div>`);
  }

  return rows.join('');
}

// ---------------------------------------------------------------------------
// Waiting on you
// ---------------------------------------------------------------------------

/**
 * The assistant's questions, answerable in place.
 *
 * Each one is concrete — "is this what it is for?", "new plan or wandered?" — rather than
 * an open-ended ask for context, which is the difference between an assistant and a form.
 * Capped: an unasked question is not a failure.
 */
export function renderQuestions(snapshot: Snapshot, cap: number): string {
  const list = questions(snapshot, cap);
  if (list.length === 0) {
    return `<div class="quietnote">Nothing is waiting on you.</div>`;
  }
  return list.map((q) => card(q)).join('');
}

function card(q: Question): string {
  switch (q.kind) {
    case 'stuck':
      return `<div class="q">
        <div class="q-head"><span class="eyebrow bad">Could not finish</span></div>
        <div class="q-who">${esc(q.job.title)}</div>
        <div class="q-from">${esc(q.job.error ?? 'it failed twice and stopped trying')}</div>
        <div class="q-acts">
          <button class="q-btn yes" data-retry="${esc(q.job.id)}">try again</button>
        </div>
      </div>`;

    case 'drift':
      return ask(
        q.branch,
        'Drifted',
        `<div class="q-line"><span class="k">For</span><span class="v">${esc(q.branch.vision?.text ?? '')}</span></div>
         <div class="q-line"><span class="k">Doing</span><span class="v">${esc(q.branch.assessment?.because ?? '')}</span></div>`,
        [
          ['that’s the new plan', `data-newplan="${esc(branchKey(q.branch))}"`],
          ['it wandered', `data-wandered="${esc(branchKey(q.branch))}"`],
        ],
      );

    case 'overtaken':
      return ask(
        q.branch,
        'Already done elsewhere',
        `<div class="q-line"><span class="k">For</span><span class="v">${esc(q.branch.vision?.text ?? '')}</span></div>
         <div class="q-line"><span class="k">But</span><span class="v">${esc(q.branch.assessment?.because ?? '')}</span></div>`,
        [
          ['mark it done', `data-newplan="${esc(branchKey(q.branch))}" data-done="1"`],
          ['no, keep it', `data-wandered="${esc(branchKey(q.branch))}"`],
        ],
      );

    case 'confirm-vision':
      return ask(
        q.branch,
        'Is this what it is for?',
        `<div class="q-vision">${esc(q.branch.vision?.text ?? '')}</div>
         ${q.branch.vision?.from ? `<div class="q-from">from ${esc(q.branch.vision.from)}</div>` : ''}`,
        [
          ['that’s right', `data-confirm="${esc(branchKey(q.branch))}"`],
          ['edit', `data-say="${esc(branchKey(q.branch))}"`],
          ['no', `data-clearvision="${esc(branchKey(q.branch))}"`],
        ],
      );

    case 'no-vision':
      return ask(
        q.branch,
        'What is this for?',
        `<div class="q-from">Nobody has said, and I could not name one purpose from its commits.</div>`,
        [['say what it is for', `data-say="${esc(branchKey(q.branch))}"`]],
      );

    case 'goal-done':
      return `<div class="q">
        <div class="q-head"><span class="eyebrow">Looks done</span></div>
        <div class="q-who">${esc(q.goal.title)}</div>
        ${q.goal.judgement?.because ? `<div class="q-from">${esc(q.goal.judgement.because)}</div>` : ''}
        <div class="q-acts">
          <button class="q-btn yes" data-goaldone="${esc(q.goal.id)}">accept</button>
          <button class="q-btn" data-goalnotyet="${esc(q.goal.id)}">not yet</button>
        </div>
      </div>`;
  }
}

function ask(branch: Branch, head: string, body: string, actions: [string, string][]): string {
  return `<div class="q">
    <div class="q-head"><span class="eyebrow ${head === 'Drifted' || head.startsWith('Already') ? 'bad' : ''}">${esc(head)}</span></div>
    <div class="q-who">${esc(shortRepo(branch.repoKey))} / ${esc(branch.name)}</div>
    ${body}
    <div class="q-acts">
      ${actions.map(([label, attrs], i) => `<button class="q-btn ${i === 0 ? 'yes' : ''}" ${attrs}>${esc(label)}</button>`).join('')}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// The changes feed — what the agent did when asked, and how to take it back (D94)
// ---------------------------------------------------------------------------

/**
 * Every change the agent made, newest first, each with its own undo.
 *
 * It exists so autonomy never needs a click first: you look here afterwards instead. A
 * goal marked done is flagged — the change D64 warned is never gone back to, so it is the
 * one made hardest to miss (Q78). Unseen rows are marked until "mark all seen".
 */
export function renderChanges(snapshot: Snapshot, now = new Date()): string {
  const recent = snapshot.changes?.recent ?? [];
  if (recent.length === 0) return '';
  return recent.map((change) => changeRow(change, now)).join('');
}

function changeRow(change: Change, now: Date): string {
  const done = change.flag === 'goal-done';
  const state = change.undone
    ? '<span class="cstate">undone</span>'
    : change.undoable
      ? `<button class="cundo" data-undo="${esc(change.id)}" title="Put this back as it was">undo</button>`
      : '<span class="cstate" title="Queued work runs whatever happens next">queued</span>';
  const classes = ['crow', change.seen ? '' : 'unseen', done ? 'flag' : '', change.undone ? 'undone' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" title="You asked: ${esc(change.words)}">
    <span class="cglyph">${done ? '&#9873;' : change.undone ? '&#8630;' : '&#9670;'}</span>
    <span class="cbody">
      <span class="ctext">${esc(change.text)}</span>
      ${done && !change.undone ? '<span class="cmeta">marked done by the agent — check it</span>' : ''}
    </span>
    <span class="cclock">${esc(relativeTime(change.at, now))}</span>
    ${state}
  </div>`;
}
