/**
 * One question, one answer, over the snapshot already on screen.
 *
 * This is deliberately **not** the agent described in `docs/plans/agent-plan.md`. That
 * agent reaches for tools, takes several turns, and needs a model that can call one —
 * which `npm run probe` has not yet confirmed for the owner's plan. Building on an
 * unverified assumption is how the last five provider gates happened.
 *
 * So this is the floor, and the floor is honest: the current snapshot is written into
 * the prompt, the model answers from it in one turn, and the answer carries what it
 * cost. No tools, no pretending to fetch anything, nothing invented about branches that
 * were never sent. When the probe comes back, this becomes the fallback path rather
 * than being thrown away.
 */

import { randomUUID } from 'node:crypto';

import type { Branch, Goal, Settings, Snapshot } from '../../shared/types.ts';
import { LlmError, complete } from './client.ts';

export type Answer = {
  question: string;
  text: string;
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

You will be given the current state of every branch. Answer the question from that state
and nothing else.

Rules:
- Answer in plain English, in at most four sentences. No lists unless asked, no headings,
  no markdown formatting of any kind.
- Refer to branches by their literal git branch name. Never invent one.
- If the state does not contain the answer, say exactly what is missing. Do not guess,
  and do not describe what you would check.
- Lead with the answer, not with a restatement of the question.`;

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
  const summary = branch.summary ? `\n    summary: ${branch.summary}` : '';
  // Three messages is enough to tell what a branch is doing without paying for fifty.
  const recent = branch.commits
    .slice(0, 3)
    .map((c) => `\n    commit: ${c.message}`)
    .join('');
  return head + summary + recent;
}

export async function ask(snapshot: Snapshot, question: string, settings: Settings): Promise<Answer> {
  const text = question.trim();
  if (!text) throw new LlmError('ask something first');
  if (!settings.llmEnabled) throw new LlmError('the advisor is switched off in settings');
  if (!settings.llmApiKey) throw new LlmError('no provider API key — add one in settings');
  if (!settings.llmModel) throw new LlmError('no model chosen — pick one in settings');

  const threads = snapshot.branches.filter((b) => !b.isBase);
  const started = Date.now();

  const answer = await complete(settings, {
    system: SYSTEM,
    user: buildAskPrompt(snapshot, text, settings.askBranchCap),
    maxTokens: 500,
    // One question is one session. Nothing is carried between them, by design: a fresh
    // context per question is cheaper and cannot drift (agent-plan.md).
    sessionId: randomUUID(),
  });

  return {
    question: text,
    text: answer.trim(),
    askedAt: new Date().toISOString(),
    sawBranches: Math.min(threads.length, settings.askBranchCap),
    sawGoals: snapshot.goals.length,
    model: settings.llmModel,
    ms: Date.now() - started,
  };
}
