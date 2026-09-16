/**
 * The Timeline — the mockup's strands view. One lane per branch across the last four
 * weeks, with a dot for every day that had a commit.
 *
 * Everything here comes from `branch.activity`, which is real commit dates, so this
 * view is fully populated in Stage 1.
 */

import type { Branch, Snapshot } from '../../shared/types.ts';
import { esc, relativeTime, repoColor } from '../format.ts';

const WINDOW_DAYS = 28;

export function renderTimeline(
  el: HTMLElement,
  branches: Branch[],
  snapshot: Snapshot,
  now: Date = new Date(),
): void {
  const withActivity = branches.filter((b) => b.activity.length > 0);
  if (withActivity.length === 0) {
    el.innerHTML = `<div class="empty"><b>No commits in range</b>Nothing in these repos has moved in the last four weeks.</div>`;
    return;
  }

  const repoKeys = snapshot.repos.map((r) => r.key);
  el.innerHTML = withActivity.map((branch) => rowHtml(branch, repoKeys, now)).join('');
}

export function renderLegend(el: HTMLElement, snapshot: Snapshot): void {
  const repoKeys = snapshot.repos.map((r) => r.key);
  el.innerHTML = snapshot.repos
    .map((repo) => `<span><i style="background:${esc(repoColor(repo.key, repoKeys))}"></i>${esc(repo.name)}</span>`)
    .join('');
}

function rowHtml(branch: Branch, repoKeys: string[], now: Date): string {
  const colour = repoColor(branch.repoKey, repoKeys);
  const positions = branch.activity
    .map((day) => ({ day, pct: dayToPercent(day, now) }))
    .filter((p) => p.pct !== null) as { day: string; pct: number }[];

  if (positions.length === 0) return '';

  const first = positions[0]!.pct;
  const last = positions[positions.length - 1]!.pct;

  const dots = positions
    .map(
      (p) =>
        `<div class="dot${p.pct === last ? ' big' : ''}" style="left:${p.pct}%;background:${esc(colour)}" title="${esc(branch.name)} · ${esc(p.day)}"></div>`,
    )
    .join('');

  return `<div class="srow${branch.relevance === 'quiet' ? ' faded' : ''}">
    <div class="slabel">
      <div class="sname">${esc(branch.name)}</div>
      <div class="spath">${esc(branch.commits[0]?.message ?? relativeTime(branch.lastActivity))}</div>
    </div>
    <div class="slane">
      <div class="stoday" style="left:100%"></div>
      <div class="span-bar" style="left:${first}%;width:${Math.max(last - first, 0.4)}%;background:${esc(colour)}"></div>
      ${dots}
    </div>
  </div>`;
}

/** 0% is four weeks ago, 100% is today. Anything older falls outside the window. */
function dayToPercent(day: string, now: Date): number | null {
  const time = new Date(`${day}T12:00:00Z`).getTime();
  if (Number.isNaN(time)) return null;
  const daysAgo = (now.getTime() - time) / 86_400_000;
  if (daysAgo > WINDOW_DAYS || daysAgo < -1) return null;
  const pct = ((WINDOW_DAYS - daysAgo) / WINDOW_DAYS) * 100;
  return Math.min(100, Math.max(0, Number(pct.toFixed(2))));
}
