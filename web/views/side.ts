/**
 * The standing column: the register, the conditions, the notices.
 *
 * The register is grouped by goal because that is how the work is actually organised —
 * the owner reads down it to check whether the filing is right. It is a listing, not a
 * summary: literal branch names, ahead/behind, age, nothing else. No diffstats.
 */

import type { Snapshot } from '../../shared/types.ts';
import { esc, relativeTime } from '../format.ts';
import { dotClass, groupByGoal, matches, tallies, threads } from '../derive.ts';
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
