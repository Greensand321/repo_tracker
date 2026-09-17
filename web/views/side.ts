/**
 * The standing column: the register, the conditions, the notices.
 *
 * The register is grouped by goal because that is how the work is actually organised —
 * the owner reads down it to check whether the filing is right. It is a listing, not a
 * summary: literal branch names, ahead/behind, age, nothing else. No diffstats.
 */

import type { Branch, Snapshot } from '../../shared/types.ts';
import { esc, relativeTime } from '../format.ts';
import { dotClass, groupByGoal, matches, questions, tallies, threads, type Question } from '../derive.ts';
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
