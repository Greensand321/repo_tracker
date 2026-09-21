/**
 * Building the request and reading the reply. Pure — no network, no clock.
 *
 * This file is where the LLM's output stops being text and becomes data. Everything it
 * returns is treated as untrusted: the shape is checked, the enum is checked, and the
 * commit SHAs it cites are checked against the branch's own commits. A model that
 * invents evidence gets that evidence dropped, not rendered.
 */

import type { Branch, Progress, Recap } from '../../shared/types.ts';

/** Bump when the prompt changes meaningfully — it is part of the cache key, so old
 *  summaries are re-generated rather than silently mixed with new ones.
 *  v2: the summary became a recap — last / done / open — written to be picked up from (D89).
 *  v3: `open` became `next` — a fragment or nothing at all, short enough for the one line
 *      the band now prints (D91). */
export const PROMPT_VERSION = 'v3';

const PROGRESS_VALUES: Progress[] = ['progressing', 'stalled', 'blocked', 'done'];

/**
 * The budget for `next` is the line's cap less the longest lead ("Not what it was for:",
 * five words) — so a fragment written to the number still fits the line it ends up on.
 */
const LEAD_WORDS = 5;

/** The system prompt with the owner's word budget in it (rule 7: no number is hardcoded). */
export const systemPrompt = (nowLineWords: number): string =>
  SYSTEM_PROMPT.replace('NEXT_WORDS', String(Math.max(3, nowLineWords - LEAD_WORDS)));

export const SYSTEM_PROMPT = `You read one git branch and write the note a developer reads to pick the work back up.

The reader has ~100 branches, nearly all written by AI coding agents in week-long sessions. They open a branch cold and need to know, in seconds: what it was doing last, what it got done, and whether anything is half-finished — so they can carry on where it left off.

Write these, each as plain English, like a colleague, no preamble, no markdown, never restating the branch name:

- title: a short noun phrase, at most 60 characters, no trailing period. The OUTCOME the work is after, not the commits. "Stopping duplicate webhook charges", not "Added idempotency test and dedupe table".
- last: one sentence. What the newest commits were doing — the thing the branch was in the middle of when it was last touched. Name the concrete piece: the feature, the file, the test. Never "made improvements".
- done: one sentence. What is finished and landed: merged, passing, complete. If the pull request is merged, say what it delivered. If nothing is clearly finished yet, say so.
- next: the ONE thing left, as a short fragment — not a sentence, no leading capital, no full stop. "the drain worker never re-sends", "CI red since the rename", "four templates unported". At most NEXT_WORDS words, and fewer is better. Read the history for the signs: messages saying WIP, TODO, "part 1", "start", "scaffold", "stub"; a test added with no implementation behind it; the same piece touched again and again without a closing commit; CI failing; an open or draft pull request; a final commit that reads like an intermediate step. Name the piece, not the evidence for it. **If nothing is left, write null** — not a sentence saying so. Where several things are open, write the one that blocks the rest.
- progress: judge honestly —
    progressing: recent commits that move the work forward
    stalled: nothing has happened for a while and nothing is obviously blocking it
    blocked: something concrete is in the way (CI failing, an unresolved problem named in the commits)
    done: the work looks finished, or its PR is merged and nothing is left open
- evidence: the short SHAs your reading rests on, most important first, at most 4.

Never invent facts. You only know what is in the commits, the pull request and the CI state. If the history is too thin to tell, say so in the field it affects.

Reply with ONLY a JSON object, no prose around it, no markdown fence:
{"title": "...", "last": "...", "done": "...", "next": "..." or null, "progress": "progressing|stalled|blocked|done", "evidence": ["sha", ...]}`;

/** How much of one branch we are willing to spend tokens on. */
const MAX_COMMITS = 25;
const MAX_BODY_CHARS = 400;

export function buildUserPrompt(branch: Branch, now: Date): string {
  const lines: string[] = [
    `Repo: ${branch.repoKey}`,
    `Branch: ${branch.name}`,
    `Ahead of base: ${branch.ahead} commits. Behind base: ${branch.behind}.`,
    `Changed: ${branch.diff.files} files, +${branch.diff.additions} -${branch.diff.deletions}.`,
    `Last activity: ${describeAge(branch.lastActivity, now)}.`,
    `CI: ${branch.ci.state}.`,
    branch.pr
      ? `Pull request #${branch.pr.number} "${branch.pr.title}" — ${branch.pr.state}${branch.pr.draft ? ' (draft)' : ''}.`
      : 'No pull request.',
  ];
  if (branch.commitsFrom === 'pull') {
    // Said plainly, or "0 ahead" beside a list of commits reads as a contradiction.
    lines.push('The commits below are the branch\'s own work as recorded on its pull request; they are already merged into the base, which is why it is 0 ahead.');
  }
  lines.push('', 'Commits, newest first:');

  if (branch.commits.length === 0) {
    lines.push('(none — this branch has nothing of its own ahead of the base)');
  } else {
    for (const commit of branch.commits.slice(0, MAX_COMMITS)) {
      const short = shortSha(commit.sha);
      lines.push(`- ${short} ${describeAge(commit.authoredAt, now)}: ${commit.message}`);
      if (commit.body) {
        lines.push(`  ${truncate(collapse(commit.body), MAX_BODY_CHARS)}`);
      }
    }
    if (branch.commits.length > MAX_COMMITS) {
      lines.push(`- (${branch.commits.length - MAX_COMMITS} older commits not shown)`);
    }
  }

  return lines.join('\n');
}

export type Insight = {
  title: string;
  /** The one-line gist: what it did last, plus what is open when something is. */
  summary: string;
  recap: Recap;
  progress: Progress;
  evidence: string[];
};

/**
 * v2's phrase for "nothing is unfinished". The model is no longer asked for it — it writes
 * null — but one that says it anyway is understood rather than believed, and nothing about
 * a non-event reaches the page.
 */
export const NOTHING_OPEN = /^nothing (looks|is) (unfinished|open|left)\.?$/i;

export class InsightParseError extends Error {
  raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = 'InsightParseError';
    this.raw = raw;
  }
}

/**
 * Reads the model's reply into an Insight, or throws.
 *
 * Deliberately lenient about the wrapper and strict about the contents: models wrap JSON
 * in prose or a markdown fence often enough that rejecting those wastes real money, while
 * a bad `progress` value or invented evidence would end up on screen as fact.
 */
export function parseInsight(raw: string, branch: Branch): Insight {
  const json = extractJson(raw);
  if (!json) throw new InsightParseError('no JSON object in the reply', raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InsightParseError(`reply was not valid JSON: ${(err as Error).message}`, raw);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InsightParseError('reply was not a JSON object', raw);
  }

  const record = parsed as Record<string, unknown>;
  const title = cleanTitle(record['title']);
  // The old shape — one `summary` — is still read as the `last` line, so a model that
  // ignores the new fields still yields something rather than a parked job.
  const last = cleanText(record['last']) || cleanText(record['summary']);
  const done = cleanText(record['done']);
  // A model that still answers in v2's shape is read, not parked — and its "Nothing looks
  // unfinished." becomes the null it means rather than a sentence about a non-event.
  const said = cleanText(record['next']) || cleanText(record['open']);
  const next = said && !NOTHING_OPEN.test(said) && !/^(null|none|n\/a)$/i.test(said) ? said : null;
  if (!title) throw new InsightParseError('reply had no usable title', raw);
  if (!last) throw new InsightParseError('reply said nothing about what the branch did', raw);

  const progress = PROGRESS_VALUES.find((value) => value === record['progress']);
  if (!progress) {
    throw new InsightParseError(`reply had an unknown progress value: ${String(record['progress'])}`, raw);
  }

  const recap: Recap = { last, done, next };
  const summary = next ? `${last} ${next}` : last;
  return { title, summary, recap, progress, evidence: validEvidence(record['evidence'], branch) };
}

/**
 * Keeps only SHAs that really are on this branch. A model that cites a commit it invented
 * loses that citation — the summary still shows, but nothing untrue is rendered as a link.
 */
export function validEvidence(value: unknown, branch: Branch): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Map(branch.commits.map((c) => [shortSha(c.sha), c.sha]));
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const short = shortSha(entry.trim());
    if (known.has(short) && !out.includes(short)) out.push(short);
    if (out.length === 4) break;
  }
  return out;
}

/** Finds the outermost {...}, so a fenced or chatty reply still parses. */
export function extractJson(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

function cleanTitle(value: unknown): string {
  const text = cleanText(value).replace(/[.\s]+$/, '');
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? collapse(value).trim() : '';
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ');

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Relative ages rather than timestamps — the model reasons better about "3 days ago". */
function describeAge(iso: string | null, now: Date): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} months ago` : `${Math.round(months / 12)} years ago`;
}
