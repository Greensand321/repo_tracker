/**
 * Building the request and reading the reply. Pure — no network, no clock.
 *
 * This file is where the LLM's output stops being text and becomes data. Everything it
 * returns is treated as untrusted: the shape is checked, the enum is checked, and the
 * commit SHAs it cites are checked against the branch's own commits. A model that
 * invents evidence gets that evidence dropped, not rendered.
 */

import type { Branch, Progress } from '../../shared/types.ts';

/** Bump when the prompt changes meaningfully — it is part of the cache key, so old
 *  summaries are re-generated rather than silently mixed with new ones. */
export const PROMPT_VERSION = 'v1';

const PROGRESS_VALUES: Progress[] = ['progressing', 'stalled', 'blocked', 'done'];

export const SYSTEM_PROMPT = `You read git branch history and explain, in plain English, what a thread of work is actually doing.

You are writing for one developer who has ~100 branches across several repos, nearly all of them created by AI coding agents. They cannot hold it all in their head. Your job is to let them glance at a card and know what this branch is.

Rules:
- Write like a colleague answering "what's this branch?", not like a changelog.
- The title is a short noun phrase, at most 60 characters, no trailing period. Describe the OUTCOME the work is after, not the commits. "Stopping duplicate webhook charges", not "Added idempotency test and dedupe table".
- The summary is 1-3 sentences. Say what the thread is doing, where it got to, and what is in the way if anything. No preamble, no restating the branch name.
- Never invent facts. You only know what is in the commits, the PR title and the CI state. If the history is too thin to tell, say so plainly in the summary.
- Judge progress honestly:
  - progressing: recent commits that move the work forward
  - stalled: nothing has happened for a while and nothing is obviously blocking it
  - blocked: something concrete is in the way (CI failing, an unresolved problem named in the commits)
  - done: the work looks finished, or its PR is merged
- Cite evidence: the short SHAs of the commits your summary is based on, most important first, at most 4.

Reply with ONLY a JSON object, no prose around it, no markdown fence:
{"title": "...", "summary": "...", "progress": "progressing|stalled|blocked|done", "evidence": ["sha", ...]}`;

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
    '',
    'Commits, newest first:',
  ];

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
  summary: string;
  progress: Progress;
  evidence: string[];
};

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
  const summary = cleanText(record['summary']);
  if (!title) throw new InsightParseError('reply had no usable title', raw);
  if (!summary) throw new InsightParseError('reply had no usable summary', raw);

  const progress = PROGRESS_VALUES.find((value) => value === record['progress']);
  if (!progress) {
    throw new InsightParseError(`reply had an unknown progress value: ${String(record['progress'])}`, raw);
  }

  return { title, summary, progress, evidence: validEvidence(record['evidence'], branch) };
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
