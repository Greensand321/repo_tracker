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

/** Kept per turn. The answer is the text only — proposals and rankings are on the page. */
export type Turn = { question: string; answer: string; at: number };

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

export function remember(question: string, answer: string, now = Date.now()): void {
  turns.push({ question, answer: answer.slice(0, MAX_ANSWER_CHARS), at: now });
  if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
  lastAt = now;
}

/** Start again: the owner asked for a fresh thread, or the old one went cold. */
export function forget(): void {
  turns = [];
  lastAt = 0;
  sessionId = randomUUID();
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
  const lines = list.map((turn) => `You were asked: ${turn.question}\nYou answered: ${turn.answer}`);
  return [
    'EARLIER IN THIS CONVERSATION (oldest first). This is only what was said — the state',
    'below is current and is what you must answer from.',
    '',
    lines.join('\n\n'),
  ].join('\n');
}
