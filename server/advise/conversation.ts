/**
 * What was said, so a follow-up means something.
 *
 * **There is no advisor sitting there to keep alive.** Every question is one stateless
 * HTTPS request; nothing lives between them on the provider's side, so there is no process
 * to hold open for thirty seconds and no warm agent to talk to. What a chatbot actually
 * does is send the conversation again each turn — so "context" here is a transcript we
 * keep and resend, and the idle timer is on *what we remember*, not on anything running.
 *
 * Three rules, and the middle one is the load-bearing one:
 *
 *   **Bounded.** The whole register already goes into every prompt; an unbounded
 *   transcript on top of it grows the bill every turn and eventually crowds out the state
 *   it is supposed to be about. Recent turns only, each trimmed.
 *
 *   **Never the source of truth.** The snapshot is re-read fresh on every turn and the
 *   transcript holds only what was *said*. A fact that matters lives in Plane B — a goal,
 *   a vision, a note — never in the conversation, because a conversation is the worst
 *   database there is (docs/design/agent-shapes.html ⑤).
 *
 *   **It ends.** After `advisorMemoryMinutes` of quiet the thread is dropped and the next
 *   question starts clean, which is what stops yesterday's tangent steering today's
 *   answer. In memory only: closing the program ends the conversation, by design.
 */

import { randomUUID } from 'node:crypto';

import type { Answer } from './ask.ts';

/**
 * Kept per turn: what was asked, what was said, and — so a follow-up can act on them —
 * what it changed and what it proposed (audit finding 2). `shown` is the whole answer as
 * the page drew it, so a reload can draw it again (finding 6).
 */
export type Turn = {
  question: string;
  answer: string;
  at: number;
  did: string[];
  proposed: string | null;
  /** Settings it suggested. Only the owner can apply them, so a follow-up is told so. */
  suggested: string[];
  /** Its words claimed a change that was not made — so the next turn does not believe them. */
  unbacked: boolean;
  shown: Answer | null;
};

export type TurnExtras = { answer?: Answer; did?: string[]; proposed?: string | null; suggested?: string[]; unbacked?: boolean };

/** How many of one answer's changes the transcript lists before saying how many more. */
const MAX_DID = 40;

/**
 * How many exchanges are carried. Six is enough for a real back-and-forth and still small
 * beside a sixty-branch register; past that the oldest are dropped rather than summarised,
 * because summarising the conversation is a second thing that can be wrong.
 */
const MAX_TURNS = 6;

/** What one remembered answer may occupy. Enough for four sentences and a little more. */
const MAX_ANSWER_CHARS = 700;

let turns: Turn[] = [];
let lastAt = 0;
/**
 * One id for the whole conversation, which is exactly what the provider's session header
 * is for (D66): every turn shares a long identical prefix — the register — and routing them
 * together keeps it cached. A new thread gets a new id.
 */
let sessionId = randomUUID();

/** Milliseconds of quiet after which the thread is dropped. */
const windowMs = (minutes: number): number => Math.max(0, minutes) * 60_000;

/**
 * The turns still in play, oldest first. Expiry is checked here rather than on a timer:
 * nothing needs to happen at the moment a conversation goes cold, only the next time
 * someone speaks.
 */
export function recall(memoryMinutes: number, now = Date.now()): Turn[] {
  if (turns.length === 0) return [];
  if (memoryMinutes <= 0 || now - lastAt > windowMs(memoryMinutes)) {
    forget();
    return [];
  }
  // A copy: the caller holds this across its own `remember`, and handing out the live
  // array had it count the turn it was in the middle of saving.
  return [...turns];
}

export function remember(question: string, answer: string, extras: TurnExtras = {}, now = Date.now()): void {
  turns.push({
    question,
    answer: answer.slice(0, MAX_ANSWER_CHARS),
    at: now,
    did: extras.did ?? [],
    proposed: extras.proposed ?? null,
    suggested: (extras.suggested ?? []).slice(0, 3),
    unbacked: extras.unbacked ?? false,
    shown: extras.answer ?? null,
  });
  if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
  lastAt = now;
}

/** Start again: the owner asked for a fresh thread, or the old one went cold. */
export function forget(): void {
  turns = [];
  lastAt = 0;
  sessionId = randomUUID();
}

/**
 * The answers still in the thread, newest first, as the page drew them — so a reload shows
 * the conversation the server is still carrying, instead of hiding it (audit finding 6).
 */
export function thread(memoryMinutes: number, now = Date.now()): Answer[] {
  return recall(memoryMinutes, now)
    .map((turn) => turn.shown)
    .filter((answer): answer is Answer => answer !== null)
    .reverse();
}

/**
 * The owner accepted an answer's proposed regrouping: what that filed joins the answer, in
 * the transcript and in the copy a reload draws — which would otherwise offer the proposal
 * again and leave out what accepting it changed.
 */
export function amend(turnId: string, changes: Answer['changes'], texts: string[]): void {
  const turn = turns.find((t) => t.shown?.turn === turnId);
  if (!turn?.shown) return;
  const known = new Set(turn.shown.changes.map((c) => c.id));
  turn.shown = { ...turn.shown, groupsFiled: true, changes: [...turn.shown.changes, ...changes.filter((c) => !known.has(c.id))] };
  turn.did = [...turn.did, ...texts];
  turn.proposed = null;
}

/** The batch this conversation belongs to. Stable while it lives (D66). */
export const threadId = (): string => sessionId;

/**
 * The transcript as the model sees it. Plain and labelled, so it cannot be mistaken for
 * the state below it — and it says outright that the state is the current one, because the
 * likeliest way this goes wrong is the model answering from a branch list three turns old.
 */
export function transcript(list: Turn[]): string {
  if (list.length === 0) return '';
  const lines = list.map((turn) =>
    [
      `You were asked: ${turn.question}`,
      `You answered: ${turn.answer}`,
      ...(turn.unbacked ? ['(That answer claimed a change, but nothing was changed.)'] : []),
      ...(turn.did.length > 0
        ? [`You changed: ${turn.did.slice(0, MAX_DID).join('; ')}${turn.did.length > MAX_DID ? `; and ${turn.did.length - MAX_DID} more` : ''}`]
        : []),
      ...(turn.proposed ? [`You proposed filing, not yet done: ${turn.proposed}`] : []),
      ...(turn.suggested.length > 0
        ? [`You suggested settings, which only the owner can apply: ${turn.suggested.join('; ')}`]
        : []),
    ].join('\n'),
  );
  return [
    'EARLIER IN THIS CONVERSATION (oldest first). This is only what was said — the state',
    'below is current and is what you must answer from.',
    '',
    lines.join('\n\n'),
  ].join('\n');
}
