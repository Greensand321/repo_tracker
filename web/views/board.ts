/**
 * The Board — the mockup's branch cards, filled with real commit history.
 *
 * Where the mockup showed data Stage 1 does not have, the card shows what it does have
 * rather than inventing a placeholder:
 *   mockup `name` (an LLM title)        → the newest commit message, which is real
 *                                          plain English and available today
 *   mockup `feature`                     → the PR title, when there is a PR
 *   mockup ring (steps done / total)     → commit count and ahead/behind
 *   mockup `note`                        → nothing, until notes exist in Stage 3
 * The literal branch name is in the card head either way (CLAUDE.md rule 6).
 */

import type { Branch, Snapshot } from '../../shared/types.ts';
import { activeDaysInWeek, esc, exactTime, heatCells, plural, relativeTime, repoColor } from '../format.ts';

export function renderBoard(
  el: HTMLElement,
  branches: Branch[],
  snapshot: Snapshot,
  openKey: string | null,
): void {
  if (branches.length === 0) {
    el.innerHTML = `<div class="empty"><b>Nothing to show</b>No branch matches what you are looking at.</div>`;
    return;
  }
  const repoKeys = snapshot.repos.map((r) => r.key);
  el.innerHTML = branches.map((b) => cardHtml(b, repoKeys, openKey)).join('');
}

export const branchKey = (branch: Branch): string => `${branch.repoKey}#${branch.name}`;

function cardHtml(branch: Branch, repoKeys: string[], openKey: string | null): string {
  const colour = repoColor(branch.repoKey, repoKeys);
  const key = branchKey(branch);
  const isOpen = key === openKey;
  const headline = branch.title ?? branch.commits[0]?.message ?? null;
  const activeDays = activeDaysInWeek(branch.activity);

  const classes = [
    'branch',
    isOpen ? 'open' : '',
    needsAttention(branch) ? 'needs' : '',
    branch.relevance === 'quiet' ? 'stale' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<article class="${classes}" data-card="${esc(key)}" style="--edge:${esc(colour)}">
    <div class="b-head">
      <span class="b-dot" style="background:${esc(colour)}"></span>
      <span class="b-proj">${esc(repoShortName(branch.repoKey))}</span>
      <span class="b-sep">/</span>
      <span class="b-path">${esc(branch.name)}</span>
      <span class="b-age" title="${esc(exactTime(branch.lastActivity))}">${esc(relativeTime(branch.lastActivity))}</span>
      <span class="b-chev"><svg><use href="#chev"/></svg></span>
    </div>

    <div class="b-main">
      <div class="b-left">
        <h3 class="b-name${headline ? '' : ' none'}">${esc(headline ?? 'No commits of its own yet')}</h3>
        <div class="b-feature">${tagsHtml(branch)}${esc(branch.pr?.title ?? '')}</div>
        <div class="b-activity">
          <div class="heat">${heatHtml(branch, colour)}</div>
          <span class="b-act">${activeDays > 0 ? `active ${activeDays} of last 7 days` : 'quiet all week'}</span>
        </div>
      </div>
      <div class="b-right">
        <div class="b-count">${branch.commits.length}<small>commits</small></div>
        <div class="b-delta">
          <span class="ahead">&uarr;${branch.ahead}</span>
          <span class="behind">&darr;${branch.behind}</span>
        </div>
      </div>
    </div>

    <div class="b-expand"><div class="b-expand-inner"><div class="ex-wrap">
      <div class="ex-grid">
        <div>
          <div class="ex-h">What was done</div>
          <ul class="commits">${commitsHtml(branch)}</ul>
        </div>
        <div>
          <div class="ex-h">Where it stands</div>
          <ul class="facts">${factsHtml(branch)}</ul>
        </div>
      </div>
      <div class="ex-actions">
        <a class="btn primary" href="${esc(branch.url)}" target="_blank" rel="noreferrer noopener">Open branch</a>
        ${branch.pr ? `<a class="btn ghost" href="${esc(branch.pr.url)}" target="_blank" rel="noreferrer noopener">Open PR #${branch.pr.number}</a>` : ''}
        <span class="ex-commits">${plural(branch.commits.length, 'commit')} &middot; ${plural(branch.activity.length, 'active day')}</span>
      </div>
    </div></div></div>
  </article>`;
}

/** Only ever shows state we actually fetched — never a guess. */
function tagsHtml(branch: Branch): string {
  const tags: string[] = [];
  if (branch.ci.state !== 'none') {
    tags.push(`<span class="tag ci-${branch.ci.state}">CI ${branch.ci.state}</span>`);
  }
  if (branch.pr) {
    const label = branch.pr.draft && branch.pr.state === 'open' ? 'draft' : branch.pr.state;
    tags.push(`<span class="tag pr-${esc(branch.pr.state)}">PR ${esc(label)}</span>`);
  }
  if (branch.isBase) tags.push('<span class="tag">base</span>');
  return tags.join('');
}

/**
 * Seven cells, one per day of the last week. The repo colour rides in as `--c`, which
 * is what the mockup's `.heat i.on` rule paints with — without it the cells render as
 * empty outlines.
 */
function heatHtml(branch: Branch, colour: string): string {
  const cells = heatCells(branch.activity);
  return cells
    .map((hot, index) => {
      const classes = hot ? (index === cells.length - 1 ? 'on now' : 'on') : '';
      return `<i class="${classes}" style="--c:${esc(colour)}"></i>`;
    })
    .join('');
}

/** The commit trail. This is the point of Stage 1, so it is the left-hand column. */
function commitsHtml(branch: Branch): string {
  if (branch.commits.length === 0) {
    return `<li><span class="msg more">Nothing ahead of the base branch.</span></li>`;
  }
  const shown = branch.commits.slice(0, 12);
  const rest = branch.commits.length - shown.length;

  const rows = shown.map((commit) => {
    const body = commit.body ? `<div class="body">${esc(truncate(commit.body, 240))}</div>` : '';
    return `<li>
      <span class="when" title="${esc(exactTime(commit.authoredAt))}">${esc(relativeTime(commit.authoredAt))}</span>
      <span>
        <a class="msg" href="${esc(commit.url)}" target="_blank" rel="noreferrer noopener">${esc(commit.message)}</a>
        <span class="who">— ${esc(commit.author)}</span>
        ${body}
      </span>
    </li>`;
  });

  if (rest > 0) {
    rows.push(`<li><span class="when"></span><span class="msg more">and ${plural(rest, 'earlier commit')}</span></li>`);
  }
  return rows.join('');
}

function factsHtml(branch: Branch): string {
  const facts: [string, string][] = [
    ['Branch', branch.name],
    ['Ahead of base', String(branch.ahead)],
    ['Behind base', String(branch.behind)],
    ['Changed', `${branch.diff.files} files, +${branch.diff.additions} −${branch.diff.deletions}`],
    ['Last activity', relativeTime(branch.lastActivity)],
    ['CI', branch.ci.state],
    ['Pull request', branch.pr ? `#${branch.pr.number} ${branch.pr.state}` : 'none'],
    ['Head', branch.headSha.slice(0, 7)],
  ];
  return facts.map(([label, value]) => `<li><span>${esc(label)}</span><b>${esc(value)}</b></li>`).join('');
}

/** "Needs you" is only ever things we can actually observe — no inference. */
export function needsAttention(branch: Branch): boolean {
  if (branch.isBase) return false;
  if (branch.ci.state === 'failing') return true;
  return Boolean(branch.pr && branch.pr.state === 'open' && !branch.pr.draft && branch.ci.state !== 'pending');
}

const repoShortName = (key: string): string => key.split('/')[1] ?? key;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
