/**
 * The leader column: what is happening now, then the list.
 *
 * The list is the same branches either way — grouped under their goals, or read one by
 * one. That is a grouping of one structure, not two views over two datasets.
 *
 * No diffstats here. How many lines changed is not what this column is for; it is for
 * what the work is, in plain English (rule 3).
 */

import { refKey, type Branch, type BranchRef, type Goal, type Snapshot } from '../../shared/types.ts';
import { esc, relativeTime } from '../format.ts';
import { byRecency, glyph, groupByGoal, headline, matches, nowThread, threads, verdictChip, verdictLabel, visionLine } from '../derive.ts';

export type Grouping = 'goal' | 'branch';

/**
 * The identity written into `data-` attributes. `refKey` is shared with the server so
 * there is one answer to "is this the same branch", and it survives branch names with
 * slashes, quotes or hashes in them.
 */
export const branchKey = (branch: Branch): string => refKey(branch.repoKey, branch.name);

export function parseBranchKey(key: string): BranchRef | null {
  try {
    const [repoKey, branch] = JSON.parse(key) as [string, string];
    return typeof repoKey === 'string' && typeof branch === 'string' ? { repoKey, branch } : null;
  } catch {
    return null;
  }
}

export const shortRepo = (key: string): string => key.split('/')[1] ?? key;

// ---------------------------------------------------------------------------
// The brief — the standing answer to what is done, what is left, what is going on
// ---------------------------------------------------------------------------

export function renderBrief(snapshot: Snapshot): string {
  if (!snapshot.brief || !snapshot.brief.text) {
    // Said plainly rather than shown as an empty space. Nothing here is faked while the
    // assistant is still reading, or while it is switched off.
    const why = snapshot.llm.enabled
      ? 'The assistant has not written a brief for this state yet.'
      : 'The assistant is off, so there is no brief. Turn it on in settings.';
    return `<div class="eyebrow">The brief</div><div class="waiting">${esc(why)}</div>`;
  }
  return `
    <div class="eyebrow">The brief</div>
    <div class="brief-text">${esc(snapshot.brief.text)}</div>
    <div class="brief-prov">${esc(snapshot.brief.model)} · ${relativeTime(snapshot.brief.generatedAt)}</div>`;
}

// ---------------------------------------------------------------------------
// Happening now
// ---------------------------------------------------------------------------

export function renderNow(snapshot: Snapshot): string {
  const branch = nowThread(snapshot);
  if (!branch) {
    return `<div class="eyebrow">Happening now</div>
      <div class="empty">Nothing is moving. Every branch has gone quiet — which is a fine
      place to be, and none of them have been deleted.</div>`;
  }

  const head = headline(branch);
  const goal = snapshot.goals.find((g) => g.id === branch.goalId) ?? null;

  return `
    <div class="eyebrow now">Happening now</div>
    <h1>${head.generated ? esc(head.text) : `<span class="raw">${esc(head.text)}</span>`}</h1>
    <div class="byline">
      <b>${esc(branch.repoKey)}</b> · ${esc(branch.name)} · ${statusWords(branch)}
      ${goal ? ` · toward <b>${esc(goal.title)}</b>` : ''}
    </div>
    ${forNow(branch)}
    <div class="acts">
      ${chips(branch)}
      <a class="act" href="${esc(branch.url)}" target="_blank" rel="noreferrer noopener">open on GitHub &#8599;</a>
      ${branch.pr ? `<a class="act" href="${esc(branch.pr.url)}" target="_blank" rel="noreferrer noopener">PR #${branch.pr.number} &#8599;</a>` : ''}
      <button class="act" data-file="${esc(branchKey(branch))}">${goal ? 'refile' : 'file under a goal'}</button>
    </div>`;
}

/**
 * The yardstick and the reality, on two lines. The comparison needs no explaining once
 * they sit next to each other — which is the whole argument for stating a vision at all.
 */
export function forNow(branch: Branch): string {
  const vision = visionLine(branch);
  const out: string[] = [];

  out.push(
    vision.known
      ? `<div class="fn"><span class="k">For</span><span class="v reflect">${esc(vision.text)}` +
        (vision.proposed ? ' <span class="proposed">my guess — not confirmed</span>' : '') +
        `</span></div>`
      : `<div class="fn"><span class="k">For</span><span class="v unsaid">${esc(vision.text)}
          <button class="link" data-say="${esc(branchKey(branch))}">say what it is for</button></span></div>`,
  );

  const now = branch.assessment
    ? `<span class="verdict v-${branch.assessment.verdict}">${verdictLabel(branch.assessment.verdict)}</span> ${esc(branch.assessment.because)}`
    : branch.summary
      ? esc(branch.summary)
      : '';
  if (now) out.push(`<div class="fn"><span class="k">Now</span><span class="v">${now}</span></div>`);

  return `<div class="fornow">${out.join('')}</div>`;
}

/** Plain English first; the counts are supporting metadata and stay small (rule 3). */
function statusWords(branch: Branch): string {
  const bits: string[] = [];
  bits.push(branch.ahead === 0 ? 'level with main' : `${branch.ahead} ahead`);
  if (branch.behind > 0) bits.push(`${branch.behind} behind`);
  bits.push(`last commit ${relativeTime(branch.lastActivity)}`);
  return bits.join(' · ');
}

function chips(branch: Branch): string {
  const out: string[] = [];
  if (branch.assessment) {
    out.push(
      `<span class="chip verd-${branch.assessment.verdict}" title="${esc(branch.assessment.because)}">${verdictChip(branch.assessment.verdict)}</span>`,
    );
  } else if (branch.progress) {
    out.push(`<span class="chip prog-${branch.progress}">${branch.progress}</span>`);
  }
  if (branch.ci.state !== 'none') out.push(`<span class="chip ci-${branch.ci.state}">CI ${branch.ci.state}</span>`);
  if (branch.pr) {
    out.push(
      `<span class="chip pr-${branch.pr.state}">#${branch.pr.number} ${branch.pr.state}${branch.pr.draft ? ' · draft' : ''}</span>`,
    );
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function renderLeaderList(snapshot: Snapshot, grouping: Grouping, search: string): string {
  const visible = threads(snapshot).filter((b) => matches(b, search));

  if (visible.length === 0) {
    return `<div class="item"><div class="reflect">Nothing here matches
      <span class="mono">${esc(search)}</span>. The literal branch name is always searchable —
      try part of it.</div></div>`;
  }

  return grouping === 'goal' ? byGoal(snapshot, visible) : byBranch(visible);
}

function byGoal(snapshot: Snapshot, visible: Branch[]): string {
  return groupByGoal(snapshot, visible)
    .map((group) => (group.goal ? goalItem(group.goal, group.branches) : unfiledItem(group.branches)))
    .join('');
}

const GOAL_WORDS: Record<string, string> = {
  progressing: 'In progress',
  'at-risk': 'At risk',
  stalled: 'Stalled',
  'looks-done': 'Looks done',
  'needs-you': 'Needs you',
};

function goalItem(goal: Goal, branches: Branch[]): string {
  const red = branches.filter((b) => b.ci.state === 'failing').length;
  const judged = goal.judgement;

  // The assistant's read leads when it has one — but `looks-done` stays a proposal in
  // the kicker and is only ever accepted from the questions panel, never silently.
  const kicker = goal.done
    ? '<span class="eyebrow">Done</span>'
    : judged
      ? `<span class="eyebrow ${judged.state === 'at-risk' || judged.state === 'needs-you' ? 'bad' : ''}">${GOAL_WORDS[judged.state] ?? judged.state}</span>`
      : red > 0
        ? `<span class="eyebrow bad">${red} red</span>`
        : branches.length === 0
          ? '<span class="eyebrow">No branches yet</span>'
          : '<span class="eyebrow">In progress</span>';

  return `<article class="goal-item ${goal.done ? 'is-done' : ''}">
    ${kicker}
    <h2>${esc(goal.title)}</h2>
    <div class="byline">
      ${goal.milestone ? `<b>${esc(goal.milestone)}</b> · ` : ''}${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}
      · <button class="act" style="padding:2px 8px" data-edit-goal="${esc(goal.id)}">edit</button>
    </div>
    ${goal.note ? `<div class="reflect note">${esc(goal.note)}</div>` : ''}
    ${judged?.because ? `<div class="judged">${esc(judged.because)}</div>` : ''}
    <div class="members">
      ${
        branches.length === 0
          ? '<div class="empty">Nothing filed under this yet — use “file” on any branch.</div>'
          : branches.map(memberRow).join('')
      }
    </div>
  </article>`;
}

function unfiledItem(branches: Branch[]): string {
  return `<article class="goal-item">
    <span class="eyebrow">Unfiled</span>
    <h2 style="color:var(--dim)">Not yet under a goal</h2>
    <div class="byline">${branches.length} ${branches.length === 1 ? 'branch' : 'branches'} · normal, not a backlog</div>
    <div class="members">${branches.map(memberRow).join('')}</div>
  </article>`;
}

function memberRow(branch: Branch): string {
  const head = headline(branch);
  return `<div class="mrow">
    <span class="g">${glyph(branch)}</span>
    <span style="min-width:0">
      <span class="nm"><span class="repo">${esc(shortRepo(branch.repoKey))} /</span> ${esc(branch.name)}</span>
      <span class="tt">${esc(head.text)}</span>
    </span>
    <span class="num"><span class="up">&#8593;${branch.ahead}</span> <span class="down">&#8595;${branch.behind}</span></span>
    <span class="chips">${chips(branch)}</span>
    <span class="age">${relativeTime(branch.lastActivity)}</span>
    <button class="pull" title="File under a different goal" data-file="${esc(branchKey(branch))}">&#8646;</button>
  </div>`;
}

/** One branch as a broadsheet item: kicker, headline, byline, prose. */
function byBranch(visible: Branch[]): string {
  return [...visible]
    .sort(byRecency)
    .map((branch) => {
      const head = headline(branch);
      return `<article class="item ${branch.relevance === 'quiet' ? 'is-quiet' : ''}">
        ${kickerFor(branch)}
        <h2>${head.generated ? esc(head.text) : `<span class="raw">${esc(head.text)}</span>`}</h2>
        <div class="byline">
          <span><b>${esc(branch.repoKey)}</b> · ${esc(branch.name)}</span>
          <span>${statusWords(branch)}</span>
        </div>
        ${forNow(branch)}
        <div class="acts">
          ${chips(branch)}
          <a class="act" href="${esc(branch.url)}" target="_blank" rel="noreferrer noopener">open &#8599;</a>
          <button class="act" data-file="${esc(branchKey(branch))}">file</button>
        </div>
      </article>`;
    })
    .join('');
}

function kickerFor(branch: Branch): string {
  // A branch doing the wrong thing matters more than a branch failing at the right one.
  if (branch.assessment?.verdict === 'overtaken') return '<span class="eyebrow bad">Already done elsewhere</span>';
  if (branch.assessment?.verdict === 'drifted') return '<span class="eyebrow bad">Drifted from its vision</span>';
  if (branch.assessment?.verdict === 'done') return '<span class="eyebrow">Vision met</span>';
  if (branch.ci.state === 'failing') return '<span class="eyebrow bad">CI is red</span>';
  if (branch.progress === 'done') return '<span class="eyebrow">Finished</span>';
  if (branch.relevance === 'quiet') return '<span class="eyebrow">Gone quiet</span>';
  if (branch.pr?.state === 'open') return '<span class="eyebrow">Open pull request</span>';
  if (branch.progress === 'stalled') return '<span class="eyebrow">Stalled</span>';
  return '<span class="eyebrow">In progress</span>';
}
