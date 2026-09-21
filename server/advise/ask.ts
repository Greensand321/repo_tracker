/**
 * The desk: one question, one answer, and the advisor may set work going.
 *
 * It answers in seconds from the snapshot already on screen — every branch, its vision,
 * its verdict, every goal — written into the prompt. Two things it cannot know from that
 * it may look up or do (D84): how the fleet moved over the last days (`what_changed`, free,
 * from the dated history), and putting a job on the board (`dispatch`, free, and the only
 * write any tool has). It queues; it does not do. The result lands on the page, and the
 * advisor is told to say so rather than to describe a result it cannot have seen.
 *
 * Two kinds of ask come back as something the page can act on rather than prose:
 *
 *   a **ranking** — "which of these matter most, by X" — is an ordered list of real
 *   branches with one reason each. It is an answer, not a change; nothing is written.
 *
 *   a **regrouping** — "organise the register by Y" — is a proposal: goals by title, the
 *   branches under each. Nothing is filed until the owner accepts it, in one click. Goals
 *   are Plane B and reversible, but "file everything differently" is the largest write in
 *   the program, and D64's rule holds for it too: the assistant proposes, the owner decides.
 *
 * Everything the model returns is untrusted: branch names are checked against the fleet
 * and an invented one is dropped, not shown.
 */

import { randomUUID } from 'node:crypto';

import { refKey, type Branch, type BranchRef, type Goal, type JobKind, type JobSubject, type Settings, type Snapshot } from '../../shared/types.ts';
import { deskTools } from '../tools/catalog.ts';
import { contextFor } from '../tools/context.ts';
import { LlmError } from './client.ts';
import { converse } from './converse.ts';
import { extractJson } from './prompt.ts';

export type Ranked = { ref: BranchRef; why: string };
export type ProposedGroup = { title: string; branches: BranchRef[] };

export type Answer = {
  question: string;
  text: string;
  /** In order, when the question asked for one. Real branches only. */
  ranking: Ranked[];
  /** A regrouping of the register, when asked for. Nothing is filed until accepted. */
  groups: ProposedGroup[];
  /** Work it set going, in plain English. It lands on the floor, not here. */
  started: string[];
  /** What it looked up before answering, by tool name. */
  looked: string[];
  askedAt: string;
  /** What the model was actually shown, so a wrong answer is debuggable. */
  sawBranches: number;
  sawGoals: number;
  model: string;
  ms: number;
};

const SYSTEM = `You are the advisor inside Bearing, a dashboard the owner uses to see what
every branch across their GitHub repos is doing. The branches are pushed by AI coding
agents and are never checked out locally, so commits, pull requests and CI are the only
evidence that exists.

You will be given the current state of every branch: what it is FOR (where anyone has
said), what it DID, how the two COMPARE, and the goals the owner filed them under. Answer
the question from that state and nothing else.

Rules:
- Answer in plain English, in at most four sentences. No headings, no markdown.
- Refer to branches by their literal git branch name, exactly as given. Never invent one.
- If the state does not contain the answer, say exactly what is missing. Do not guess.
- Lead with the answer, not with a restatement of the question.
- If you started work with the dispatch tool, say so and say it will land on the page.
  You have NOT seen its result. Never describe one.

Two kinds of question get an extra field alongside the sentences:
- Asked to RANK or pick the most important/urgent/risky branches by some criteria: put
  the order in "ranking", best first, one short reason each. Only real branch names.
- Asked to GROUP, ORGANISE, REORGANISE or FILE branches: put your proposal in "groups" —
  a short title for each group and the branches under it. A group titled "Unfiled" means
  leave those out of any goal. Existing goal titles may be reused. The owner will accept
  or refuse the whole proposal; nothing is filed until they do.

Reply with ONLY a JSON object, no prose around it, no markdown fence:
{"answer": "...", "ranking": [{"repo": "owner/name", "branch": "...", "why": "..."}], "groups": [{"title": "...", "branches": [{"repo": "owner/name", "branch": "..."}]}]}
Leave "ranking" and "groups" out, or empty, when the question did not ask for them.`;

/** Everything the model is allowed to see, in the fewest tokens that stay unambiguous. */
export function buildAskPrompt(snapshot: Snapshot, question: string, cap: number): string {
  const goalOf = new Map(snapshot.goals.map((g) => [g.id, g] as const));

  const threads = snapshot.branches
    .filter((b) => !b.isBase)
    .sort((a, b) => Date.parse(b.lastActivity ?? '') - Date.parse(a.lastActivity ?? ''))
    .slice(0, cap);

  const lines = threads.map((b) => describeBranch(b, goalOf.get(b.goalId ?? '') ?? null));
  const omitted = snapshot.branches.filter((b) => !b.isBase).length - threads.length;

  return [
    `Today is ${snapshot.generatedAt.slice(0, 10)}. This state was read at ${snapshot.generatedAt}.`,
    '',
    `GOALS (the owner's own filing — not from GitHub):`,
    snapshot.goals.length > 0
      ? snapshot.goals.map((g) => describeGoal(g)).join('\n')
      : '  (none yet — every branch is unfiled)',
    '',
    `BRANCHES (${threads.length} shown${omitted > 0 ? `, ${omitted} older ones omitted` : ''}):`,
    ...lines,
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

function describeGoal(goal: Goal): string {
  const bits = [`  "${goal.title}"`, `${goal.branches.length} branches`];
  if (goal.milestone) bits.push(`milestone ${goal.milestone}`);
  if (goal.done) bits.push('marked done');
  if (goal.judgement) bits.push(`looks ${goal.judgement.state}: ${goal.judgement.because}`);
  if (goal.note) bits.push(`the owner's note: "${goal.note}"`);
  return bits.join(' · ');
}

function describeBranch(branch: Branch, goal: Goal | null): string {
  const bits = [
    `- ${branch.repoKey} ${branch.name}`,
    `${branch.ahead} ahead / ${branch.behind} behind`,
    branch.lastActivity ? `last commit ${branch.lastActivity.slice(0, 10)}` : 'no commits of its own',
  ];
  if (branch.relevance === 'quiet') bits.push('gone quiet');
  if (branch.ci.state !== 'none') bits.push(`CI ${branch.ci.state}`);
  if (branch.pr) bits.push(`PR #${branch.pr.number} ${branch.pr.state}${branch.pr.draft ? ' draft' : ''}`);
  if (goal) bits.push(`goal "${goal.title}"`);
  else bits.push('unfiled');

  const head = bits.join(' · ');
  const out = [head];
  // The vision and the verdict are what "does this matter" and "where does this belong"
  // actually turn on — a ranking or a regrouping drawn from commit subjects alone would be
  // the advisor guessing at what the owner has already written down.
  if (branch.vision) {
    out.push(`    FOR: ${branch.vision.text}${branch.vision.state === 'proposed' ? ' (my guess — not confirmed)' : ''}`);
  }
  if (branch.recap) {
    out.push(`    LAST: ${branch.recap.last}`);
    if (branch.recap.done) out.push(`    DONE: ${branch.recap.done}`);
    if (branch.recap.next) out.push(`    LEFT: ${branch.recap.next}`);
  } else if (branch.summary) {
    out.push(`    DID: ${branch.summary}`);
  }
  if (branch.assessment) out.push(`    COMPARED: ${branch.assessment.verdict} — ${branch.assessment.because}`);
  // Three messages is enough to tell what a branch is doing without paying for fifty.
  for (const commit of branch.commits.slice(0, 3)) out.push(`    commit: ${commit.message}`);
  return out.join('\n');
}

export type Doors = {
  /** The one write the desk has. Absent means it may answer but not start anything. */
  dispatch?: (kind: JobKind, subject: JobSubject) => void;
};

export async function ask(
  snapshot: Snapshot,
  question: string,
  settings: Settings,
  doors: Doors = {},
): Promise<Answer> {
  const text = question.trim();
  if (!text) throw new LlmError('ask something first');
  if (!settings.llmEnabled) throw new LlmError('the advisor is switched off in settings');
  if (!settings.llmApiKey) throw new LlmError('no provider API key — add one in settings');
  if (!settings.llmModel) throw new LlmError('no model chosen — pick one in settings');

  const threads = snapshot.branches.filter((b) => !b.isBase);
  const started = Date.now();

  const result = await converse(settings, {
    system: SYSTEM,
    user: buildAskPrompt(snapshot, text, settings.askBranchCap),
    tools: deskTools(settings),
    ctx: { ...contextFor(snapshot, settings, null), dispatch: doors.dispatch ?? null },
    // One question is one session. Nothing is carried between them, by design: a fresh
    // context per question is cheaper and cannot drift (agent-plan.md).
    sessionId: randomUUID(),
  });

  const parsed = parseAnswer(result.text, snapshot);
  return {
    question: text,
    ...parsed,
    started: result.uses.filter((use) => use.name === 'dispatch' && !use.failed).map((use) => use.result),
    looked: result.uses.filter((use) => use.name !== 'dispatch').map((use) => use.name),
    askedAt: new Date().toISOString(),
    sawBranches: Math.min(threads.length, settings.askBranchCap),
    sawGoals: snapshot.goals.length,
    model: settings.llmModel,
    ms: Date.now() - started,
  };
}

const MAX_RANKED = 20;
const MAX_GROUPS = 20;

/**
 * Reads the reply. Lenient about the wrapper, strict about the contents — and a reply
 * that is not JSON at all is still an answer: a model that ignores the shape has usually
 * still answered the question, and that is worth more than an error.
 */
export function parseAnswer(raw: string, snapshot: Snapshot): Pick<Answer, 'text' | 'ranking' | 'groups'> {
  const plain = { text: raw.trim(), ranking: [], groups: [] };
  const json = extractJson(raw);
  if (!json) return plain;

  let parsed: { answer?: unknown; ranking?: unknown; groups?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return plain;
  }
  if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) return plain;

  const known = new Map<string, BranchRef>();
  for (const b of snapshot.branches) if (!b.isBase) known.set(refKey(b.repoKey, b.name), { repoKey: b.repoKey, branch: b.name });
  const asRef = (row: unknown): BranchRef | null => {
    const item = row as { repo?: unknown; branch?: unknown } | null;
    if (!item || typeof item.repo !== 'string' || typeof item.branch !== 'string') return null;
    return known.get(refKey(item.repo, item.branch)) ?? null;
  };

  const ranking: Ranked[] = [];
  const ranked = new Set<string>();
  if (Array.isArray(parsed.ranking)) {
    for (const row of parsed.ranking) {
      const ref = asRef(row);
      if (!ref || ranked.has(refKey(ref.repoKey, ref.branch))) continue;
      ranked.add(refKey(ref.repoKey, ref.branch));
      const why = (row as { why?: unknown }).why;
      ranking.push({ ref, why: typeof why === 'string' ? why.trim() : '' });
      if (ranking.length === MAX_RANKED) break;
    }
  }

  const groups: ProposedGroup[] = [];
  const filed = new Set<string>();
  if (Array.isArray(parsed.groups)) {
    for (const row of parsed.groups) {
      const item = row as { title?: unknown; branches?: unknown } | null;
      if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
      const branches: BranchRef[] = [];
      for (const member of Array.isArray(item.branches) ? item.branches : []) {
        const ref = asRef(member);
        // A branch can be under one goal (D29). The first group to name it keeps it.
        if (!ref || filed.has(refKey(ref.repoKey, ref.branch))) continue;
        filed.add(refKey(ref.repoKey, ref.branch));
        branches.push(ref);
      }
      if (branches.length === 0) continue; // a group with nothing real in it proposes nothing
      groups.push({ title: item.title.trim().slice(0, 80), branches });
      if (groups.length === MAX_GROUPS) break;
    }
  }

  return { text: parsed.answer.trim(), ranking, groups };
}
