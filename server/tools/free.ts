/**
 * The free tools: one reads memory, one reads this program's own records. Neither costs a
 * GitHub call, and neither can write anything anywhere.
 *
 * These two first because they answer the questions the assistant is currently guessing
 * at. `sibling_branches` is what filing and overtaken-detection actually need — you cannot
 * tell whether a branch has been superseded without seeing the ones next to it.
 * `what_changed` is the feature the dated history was written for (D31), unread since
 * Stage 1.
 */

import { readSince } from '../history.ts';
import { num, type Tool, type ToolContext } from './types.ts';

const MAX_SIBLINGS = 12;
const MAX_LINES = 40;

export const siblingBranches: Tool = {
  name: 'sibling_branches',
  description:
    'The other branches around this one — those under the same goal first, then the rest of the same repo. Use it to tell whether another branch has already done this one’s job. Free: nothing is fetched.',
  cost: 'free',
  args: [{ name: 'limit', type: 'number', required: false, about: `how many, at most ${MAX_SIBLINGS}` }],

  run(args, ctx) {
    const limit = num(args, 'limit', 8, 1, MAX_SIBLINGS);
    const subject = ctx.branch;

    const others = ctx.snapshot.branches.filter(
      (b) => !b.isBase && !(subject && b.repoKey === subject.repoKey && b.name === subject.name),
    );
    if (others.length === 0) return 'There are no other branches.';

    // Same goal first — that is the set this branch is actually being compared against —
    // then the same repo, then everything else, each by recency.
    const rank = (b: (typeof others)[number]): number => {
      if (subject?.goalId && b.goalId === subject.goalId) return 0;
      if (subject && b.repoKey === subject.repoKey) return 1;
      return 2;
    };
    const goalTitle = new Map(ctx.snapshot.goals.map((g) => [g.id, g.title] as const));

    const chosen = [...others]
      .sort(
        (a, b) =>
          rank(a) - rank(b) || Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0'),
      )
      .slice(0, limit);

    const lines = chosen.map((b) => {
      const bits = [`${b.repoKey} ${b.name}`];
      const goal = b.goalId ? goalTitle.get(b.goalId) : null;
      if (goal) bits.push(`goal "${goal}"`);
      if (b.vision) bits.push(`FOR: ${b.vision.text}${b.vision.state === 'proposed' ? ' (unconfirmed)' : ''}`);
      else if (b.summary) bits.push(`did: ${b.summary}`);
      if (b.relevance === 'quiet') bits.push('gone quiet');
      if (b.pr) bits.push(`PR #${b.pr.number} ${b.pr.state}`);
      if (b.lastActivity) bits.push(`last commit ${b.lastActivity.slice(0, 10)}`);
      return `- ${bits.join(' · ')}`;
    });

    const omitted = others.length - chosen.length;
    return [
      `${chosen.length} of ${others.length} other branches${omitted > 0 ? `, nearest first` : ''}:`,
      ...lines,
    ].join('\n');
  },
};

export const whatChanged: Tool = {
  name: 'what_changed',
  description:
    'How things moved over the last few days, from the dated record this program keeps. Says what gained commits, what went red, what stood still. Free: reads local disk, never GitHub.',
  cost: 'disk',
  args: [{ name: 'days', type: 'number', required: false, about: 'how far back, 1 to 90' }],

  run(args, ctx) {
    const days = num(args, 'days', 7, 1, 90);
    const since = new Date(ctx.now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = readSince(since, ctx.now);

    if (rows.length === 0) {
      // A fresh install has no history, and that is a fact about the tool rather than
      // about the fleet. Saying "nothing changed" here would be a lie.
      return `Nothing was recorded in the last ${days} days. This program only knows about days it was running.`;
    }

    type Seen = { first: (typeof rows)[number]; last: (typeof rows)[number] };
    const byBranch = new Map<string, Seen>();
    for (const row of rows) {
      const key = `${row.repo} ${row.branch}`;
      const seen = byBranch.get(key);
      if (seen) seen.last = row;
      else byBranch.set(key, { first: row, last: row });
    }

    const moved: { key: string; gained: number; line: string }[] = [];
    let still = 0;

    for (const [key, { first, last }] of byBranch) {
      const gained = last.commits - first.commits;
      const sameHead = first.sha === last.sha;
      if (gained === 0 && sameHead) {
        still++;
        continue;
      }
      const bits = [
        gained > 0 ? `+${gained} commits` : sameHead ? 'unchanged' : 'history rewritten',
        `${last.ahead} ahead / ${last.behind} behind`,
      ];
      if (last.ci !== first.ci) bits.push(`CI ${first.ci} → ${last.ci}`);
      else if (last.ci === 'failing') bits.push('CI still red');
      if (last.pr !== first.pr) bits.push(`PR ${first.pr} → ${last.pr}`);
      moved.push({ key, gained, line: `- ${key} · ${bits.join(' · ')}` });
    }

    moved.sort((a, b) => b.gained - a.gained);

    const subject = ctx.branch ? `${ctx.branch.repoKey} ${ctx.branch.name}` : null;
    const mine = subject ? moved.find((m) => m.key === subject) : undefined;
    const rest = moved.filter((m) => m !== mine).slice(0, MAX_LINES);

    const out = [`Since ${since} (${rows.length} daily records over ${byBranch.size} branches):`];
    if (subject) {
      out.push(mine ? `THIS BRANCH ${mine.line.slice(2)}` : `THIS BRANCH did not move in that window.`);
    }
    if (rest.length > 0) out.push(...rest.map((m) => m.line));
    if (moved.length - rest.length - (mine ? 1 : 0) > 0) {
      out.push(`(${moved.length - rest.length - (mine ? 1 : 0)} more moved, not listed)`);
    }
    if (still > 0) out.push(`${still} branches did not move at all.`);
    return out.join('\n');
  },
};
