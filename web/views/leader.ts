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
import { byRecency, glyph, groupByGoal, headline, matches, nowLine, nowThread, threads, toolLabel, trimTo, verdictChip } from '../derive.ts';

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
  if (!snapshot.brief || (!snapshot.brief.text && !snapshot.brief.parts)) {
    // Said plainly rather than shown as an empty space. Nothing here is faked while the
    // assistant is still reading, or while it is switched off.
    const why = snapshot.llm.enabled
      ? 'The assistant has not written a brief for this state yet.'
      : 'The assistant is off, so there is no brief. Turn it on in settings.';
    return `<div class="eyebrow">The brief</div><div class="waiting">${esc(why)}</div>`;
  }
  // Dated, and honest when the fleet has moved since: the routine rewrite waits its
  // interval, and a brief from ten minutes ago beats a blank space for those ten minutes.
  const stale = snapshot.brief.stale ? ' · the fleet has moved since' : '';
  // Three parts when it was written in three (D89): done, next, now. The three questions
  // the brief exists to answer, each findable without reading the others.
  // The sentences carry no branch names (D90). The branches a part rests on sit under it
  // as chips — identifiers beside the prose, not inside it — and a click finds the task.
  const parts = snapshot.brief.parts;
  const refs = (list: BranchRef[] | undefined): string =>
    list && list.length > 0
      ? `<span class="refs">${list.map((r) => `<button class="ref" data-find="${esc(r.branch)}" title="${esc(r.repoKey)} — find it in the list">${esc(r.branch)}</button>`).join('')}</span>`
      : '';
  const part = (k: string, text: string, list: BranchRef[] | undefined): string =>
    text ? `<div class="fn"><span class="k">${k}</span><span class="v">${esc(text)}${refs(list)}</span></div>` : '';
  const body = parts
    ? `<div class="brief-parts">
        ${part('Done', parts.done, parts.refs?.done)}
        ${part('Next', parts.next, parts.refs?.next)}
        ${part('Now', parts.now, parts.refs?.now)}
      </div>`
    : `<div class="brief-text">${esc(snapshot.brief.text)}</div>`;
  return `
    <div class="eyebrow">The brief</div>
    ${body}
    <div class="brief-prov">${esc(snapshot.brief.model)} · ${relativeTime(snapshot.brief.generatedAt)}${stale}
      <button class="link" data-ask="brief">write it again</button></div>`;
}

// ---------------------------------------------------------------------------
// Happening now
// ---------------------------------------------------------------------------

export function renderNow(snapshot: Snapshot, words: number): string {
  const branch = nowThread(snapshot);
  if (!branch) {
    return `<div class="eyebrow">Happening now</div>
      <div class="empty">Nothing is moving. Every branch has gone quiet — which is a fine
      place to be, and none of them have been deleted.</div>`;
  }

  const head = headline(branch);
  const goal = snapshot.goals.find((g) => g.id === branch.goalId) ?? null;
  // The line names the goal when it counts what is left under it. Once is enough.
  const towards = goal && !nowLine(snapshot, branch).namesGoal;

  return `
    <div class="eyebrow now">Happening now</div>
    <h1>${head.generated ? esc(head.text) : `<span class="raw">${esc(head.text)}</span>`}</h1>
    <div class="byline">
      <b>${esc(branch.repoKey)}</b> · ${esc(branch.name)} · ${statusWords(branch)}
      ${towards ? ` · toward <b>${esc(goal.title)}</b>` : ''}
    </div>
    ${theLine(snapshot, branch, words)}
    ${provenance(branch)}
    <div class="acts">
      ${chips(branch, { quiet: true })}
      <a class="act" href="${esc(branch.url)}" target="_blank" rel="noreferrer noopener">open on GitHub &#8599;</a>
      ${branch.pr ? `<a class="act" href="${esc(branch.pr.url)}" target="_blank" rel="noreferrer noopener"
        title="Pull request #${branch.pr.number}">pull request &#8599;</a>` : ''}
      <button class="act" data-file="${esc(branchKey(branch))}">${goal ? 'refile' : 'file under a goal'}</button>
    </div>`;
}

/**
 * The line (D91). `Done.` when it is done; where something is left, or the branch is one
 * piece of a larger job, that too — and never a word more.
 *
 * Every part of it is decided in `nowLine`; this only paints it. The word budget is the
 * owner's (rule 7), and only the tail is ever cut — a line clipped to "Done," would be
 * worse than one clipped to nothing.
 */
export function theLine(snapshot: Snapshot, branch: Branch, words: number): string {
  if (!branch.recap && !branch.assessment && branch.relevance !== 'quiet') {
    // Nothing read it yet. Said plainly rather than guessed at, and never faked as "Going."
    return `<div class="nowline"><span class="unread">not read yet</span></div>`;
  }

  const line = nowLine(snapshot, branch);
  const { rest, clipped } = trimTo(line, words);
  // Asking again is the only thing you can do about an answer you disagree with: the
  // branch has not moved, so nothing on its own will ever regenerate this (D81).
  const ask = line.ask
    ? ` <span class="unsaid">Nobody has said what it is for.</span>
        <button class="link" data-say="${esc(branchKey(branch))}">say</button>
        <button class="link" data-ask="draft-vision" data-on="${esc(branchKey(branch))}"
          title="Have the assistant look at the repo and the commits and propose one">or have a go</button>`
    : '';

  return `<div class="nowline"${clipped ? ` title="${esc(`${line.lead} ${line.rest}`)}"` : ''}>
    <span class="lead t-${line.tone}">${esc(line.lead)}</span>${
      rest ? ` <span class="rest${line.restIsOpen ? ' open' : ''}">${esc(rest)}</span>` : ''}${ask}</div>`;
}

/**
 * Where the line came from, and how to disagree with it. Small, grey, and under the line
 * rather than in it — the machinery is supporting metadata (rule 3).
 */
function provenance(branch: Branch): string {
  const looked = branch.assessment?.looked?.length ? ` · ${esc(lookedWords(branch.assessment.looked))}` : '';
  const why = branch.assessment?.because ? ` title="${esc(branch.assessment.because)}"` : '';
  const again = [
    `<button class="link" data-ask="summarise" data-on="${esc(branchKey(branch))}">read it again</button>`,
    // Only offered where there is a yardstick to check it against; without a vision an
    // assessment is a guess, and the band has already offered to get one.
    branch.vision ? `<button class="link" data-ask="assess" data-on="${esc(branchKey(branch))}">check it again</button>` : '',
  ].filter(Boolean);
  return `<div class="prov"${why}>read ${esc(relativeTime(branch.insight?.generatedAt ?? branch.lastActivity))}${looked}
    · ${again.join(' · ')}</div>`;
}

/** "after reading the branches next to it" — plain English, never a tool name (rule 3). */
function lookedWords(names: string[]): string {
  const unique = [...new Set(names)].map(toolLabel);
  return `after ${unique.join(' and ')}`;
}

/** Plain English first; the counts are supporting metadata and stay small (rule 3). */
function statusWords(branch: Branch): string {
  const bits: string[] = [];
  bits.push(branch.ahead === 0 ? 'level with main' : `${branch.ahead} ahead`);
  if (branch.behind > 0) bits.push(`${branch.behind} behind`);
  bits.push(`last commit ${relativeTime(branch.lastActivity)}`);
  return bits.join(' · ');
}

/**
 * `quiet` drops the verdict and progress chips: beside the line they are the same fact a
 * second time, and nothing is printed twice (D91). The register keeps them — there the
 * chips ARE the reading.
 *
 * The pull request number is gone from the chip either way. It is an identifier nobody
 * types (D90); it survives as the link, which is the only thing anyone does with it.
 */
function chips(branch: Branch, opts: { quiet?: boolean } = {}): string {
  const out: string[] = [];
  if (!opts.quiet) {
    if (branch.assessment) {
      out.push(
        `<span class="chip verd-${branch.assessment.verdict}" title="${esc(branch.assessment.because)}">${verdictChip(branch.assessment.verdict)}</span>`,
      );
    } else if (branch.progress) {
      out.push(`<span class="chip prog-${branch.progress}">${branch.progress}</span>`);
    }
  }
  if (branch.ci.state !== 'none') out.push(`<span class="chip ci-${branch.ci.state}">CI ${branch.ci.state}</span>`);
  if (branch.pr) {
    out.push(
      `<span class="chip pr-${branch.pr.state}" title="Pull request #${branch.pr.number}">${branch.pr.state}${branch.pr.draft ? ' · draft' : ''}</span>`,
    );
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function renderLeaderList(snapshot: Snapshot, grouping: Grouping, search: string, words: number): string {
  const visible = threads(snapshot).filter((b) => matches(b, search));

  if (visible.length === 0) {
    return `<div class="item"><div class="reflect">Nothing here matches
      <span class="mono">${esc(search)}</span>. The literal branch name is always searchable —
      try part of it.</div></div>`;
  }

  return grouping === 'goal' ? byGoal(snapshot, visible, words) : byBranch(snapshot, visible, words);
}

function byGoal(snapshot: Snapshot, visible: Branch[], words: number): string {
  return groupByGoal(snapshot, visible)
    .map((group) =>
      group.goal ? goalItem(snapshot, group.goal, group.branches, words) : unfiledItem(snapshot, group.branches, words))
    .join('');
}

const GOAL_WORDS: Record<string, string> = {
  progressing: 'In progress',
  'at-risk': 'At risk',
  stalled: 'Stalled',
  'looks-done': 'Looks done',
  'needs-you': 'Needs you',
};

function goalItem(snapshot: Snapshot, goal: Goal, branches: Branch[], words: number): string {
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
          : branches.map((b) => memberRow(snapshot, b, words)).join('')
      }
    </div>
  </article>`;
}

function unfiledItem(snapshot: Snapshot, branches: Branch[], words: number): string {
  return `<article class="goal-item">
    <span class="eyebrow">Unfiled</span>
    <h2 style="color:var(--dim)">Not yet under a goal</h2>
    <div class="byline">${branches.length} ${branches.length === 1 ? 'branch' : 'branches'} · normal, not a backlog</div>
    <div class="members">${branches.map((b) => memberRow(snapshot, b, words)).join('')}</div>
  </article>`;
}

function memberRow(snapshot: Snapshot, branch: Branch, words: number): string {
  const head = headline(branch);
  // The same line as the band (D91), and only when it is the thing standing in the way —
  // "Done." and "Going." are already carried here by the glyph and the chips.
  const line = nowLine(snapshot, branch);
  const open = line.restIsOpen ? `${line.lead} ${trimTo(line, words).rest}` : '';
  return `<div class="mrow">
    <span class="g">${glyph(branch)}</span>
    <span style="min-width:0">
      <span class="nm"><span class="repo">${esc(shortRepo(branch.repoKey))} /</span> ${esc(branch.name)}</span>
      <span class="tt">${esc(head.text)}</span>
      ${open ? `<span class="tt open">${esc(open)}</span>` : ''}
    </span>
    <span class="num"><span class="up">&#8593;${branch.ahead}</span> <span class="down">&#8595;${branch.behind}</span></span>
    <span class="chips">${chips(branch)}</span>
    <span class="age">${relativeTime(branch.lastActivity)}</span>
    <button class="pull" title="File under a different goal" data-file="${esc(branchKey(branch))}">&#8646;</button>
  </div>`;
}

/** One branch as a broadsheet item: kicker, headline, byline, prose. */
function byBranch(snapshot: Snapshot, visible: Branch[], words: number): string {
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
        ${theLine(snapshot, branch, words)}
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
