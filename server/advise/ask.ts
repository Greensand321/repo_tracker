/**
 * The agent: one question, one answer, and whatever changes the owner asked for (D94).
 *
 * It answers from the snapshot already on screen — every goal, the most recent branches in
 * full and every other branch in one line — and it may look further and change things with
 * its tools. Everything it changes is Plane B, through one action door built for this
 * answer; nothing it can reach writes to GitHub.
 *
 * **It must not be able to say it did something it did not do** (audit finding 1). So the
 * page's list of what changed comes from the action door, never from the model's words;
 * the prompt says exactly what it can and cannot do; and an answer that claims a change
 * with none recorded is flagged.
 *
 * Two kinds of ask come back as something the page can act on rather than prose: a
 * **ranking** (an answer; nothing is written) and a **regrouping** proposal, for when the
 * owner asked to see it first.
 */

import { randomUUID } from 'node:crypto';

import { coerceTunable, tunable, type TunableKey } from '../../shared/settings.ts';
import { refKey, type BranchRef, type Settings, type Snapshot } from '../../shared/types.ts';
import { agentTools } from '../tools/catalog.ts';
import { contextFor } from '../tools/context.ts';
import type { AgentActions } from '../tools/types.ts';
import { LlmError } from './client.ts';
import { recall, remember, threadId, transcript } from './conversation.ts';
import { converse } from './converse.ts';
import { listNotes } from '../notebook.ts';
import { describeGoal, register } from './describe.ts';
import { extractJson } from './prompt.ts';

export type Ranked = { ref: BranchRef; why: string };
export type ProposedGroup = { title: string; branches: BranchRef[] };

/** One thing an answer changed. `id` is its entry in the record, when it has one. */
export type AnswerChange = { id: string | null; text: string };

/**
 * A setting it thinks should change (Q79). Never applied by the agent: the page shows it
 * with an apply button, and pressing it is the owner changing the setting.
 */
export type SettingSuggestion = { setting: TunableKey; label: string; from: number | boolean; to: number | boolean; why: string };

export type Answer = {
  question: string;
  text: string;
  /** Which answer this was. Every change it made carries the same id, so they undo together. */
  turn: string;
  /** In order, when the question asked for one. Real branches only. */
  ranking: Ranked[];
  /** A regrouping, when the owner asked to see it first. Nothing is filed until accepted. */
  groups: ProposedGroup[];
  /** Settings it suggests. Only the owner applies them. */
  suggestions: SettingSuggestion[];
  /** What it changed, from the action door — never from its own words. */
  changes: AnswerChange[];
  /** It claims a change and none was made. Shown on the page as a warning. */
  unbacked: boolean;
  /** It ran out of calls or time before it finished; `text` says what it did and what is left. */
  unfinished: boolean;
  /** What it looked up before answering, by tool name. */
  looked: string[];
  /** How many earlier exchanges it had in front of it. 0 means this began a new thread. */
  inThread: number;
  askedAt: string;
  /** What the model was actually shown, so a wrong answer is debuggable. */
  sawBranches: number;
  sawGoals: number;
  model: string;
  ms: number;
};

/**
 * What it is told about itself. Built per answer because what it may do depends on the
 * owner's settings — and an agent told it can do something it cannot is the one that
 * says it did.
 */
export function systemFor(canAct: boolean): string {
  return `You are the agent inside Bearing, a dashboard the owner uses to see and organise
what every branch across their GitHub repos is doing. The branches are pushed by AI coding
agents and are never checked out locally, so commits, pull requests and CI are the only
evidence that exists.

You will be given the goals the owner filed branches under, and every branch: the most
recent in full — what it is FOR, what it DID, how the two COMPARE — and the rest one line
each. Use the "branch" tool to read any of those in full. You may also be given what was
said earlier in this conversation: use it to understand what the owner means ("that one",
"do it then"), and nothing more. The state is the current one; where the two disagree, the
state is right. Answer the LATEST message only.

WHAT YOU MAY DO
${
  canAct
    ? `- Read anything in the state, and use your tools to read further.
- Make the changes the owner asks for, with your tools. They take effect at once and the
  owner can undo any of them, so do it rather than describing it — never ask first.
- Queue slow work (re-reading or re-checking branches, rewriting the brief) with "queue".
  It runs in the background and lands on the page later: say it is queued, never describe
  its result.
- Asked to change how the brief reads ("lead with what's red", "leave X out"): write it in
  the notebook with remember, for "brief". Every brief follows it from then on, and the
  brief is rewritten with it at once.
- Asked to remember something: remember it, for "conversation".
- Read the settings with the "settings" tool. You cannot change one. If one is holding the
  owner back, or they ask for one to change, suggest it in "settings" — they apply it.`
    : `- Read anything in the state, and use your tools to read further.
- Changing things is switched off in the owner's settings. If you are asked to change
  something, say that it is switched off — do not describe it as done.
- Read the settings with the "settings" tool, and suggest a change in "settings" if one
  is holding the owner back — they apply it.`
}

WHAT YOU MUST NEVER DO
- Change anything on GitHub. You can only read it, and must never say you changed it.
- Change a setting. You may only suggest one, in "settings"; say it is a suggestion.
- Do anything the owner did not ask for in their latest message.
- Say you changed, filed, queued, created, deleted or marked anything unless a tool result
  above confirmed it. If you have no tool for what was asked, say so plainly.

Rules for the answer:
- Plain English, at most four sentences. No headings, no markdown.
- Refer to branches by their literal git branch name, exactly as given. Never invent one.
- If the state does not contain the answer, say exactly what is missing. Do not guess.
- Lead with what you did, or with the answer — not with a restatement of the question.

Two kinds of question get an extra field alongside the sentences:
- Asked to RANK or pick the most important/urgent/risky branches by some criteria: put
  the order in "ranking", best first, one short reason each. Only real branch names.
- Asked to GROUP, ORGANISE, REORGANISE or FILE branches and to SHOW it first: put your
  proposal in "groups" — a short title for each group and the branches under it. A group
  titled "Unfiled" means leave those out of any goal. Existing goal titles may be reused.

Reply with ONLY a JSON object, no prose around it, no markdown fence:
{"answer": "...", "ranking": [{"repo": "owner/name", "branch": "...", "why": "..."}], "groups": [{"title": "...", "branches": [{"repo": "owner/name", "branch": "..."}]}], "settings": [{"setting": "askBranchCap", "to": 120, "why": "..."}]}
Leave "ranking", "groups" and "settings" out, or empty, when they are not called for.
"settings" uses the names the settings tool lists, at most three.`;
}

/** Everything the model is allowed to see, in the fewest tokens that stay unambiguous. */
export function buildAskPrompt(snapshot: Snapshot, question: string, cap: number): string {
  const { full, index, total } = register(snapshot, cap);
  return [
    `Today is ${snapshot.generatedAt.slice(0, 10)}. This state was read at ${snapshot.generatedAt}.`,
    '',
    `GOALS (the owner's own filing — not from GitHub):`,
    snapshot.goals.length > 0
      ? snapshot.goals.map((g) => describeGoal(g)).join('\n')
      : '  (none yet — every branch is unfiled)',
    '',
    `BRANCHES — all ${total}: ${full.length} most recent in full${index.length > 0 ? `, ${index.length} more one line each` : ''}:`,
    ...full,
    ...(index.length > 0 ? ['', 'THE REST, ONE LINE EACH (use the "branch" tool for any of them in full):', ...index] : []),
    '',
    ...inFlight(snapshot),
    ...notebookLines(),
    `LATEST QUESTION: ${question}`,
  ].join('\n');
}

/**
 * The notebook: what the owner told it to remember, and the brief's instructions — with
 * ids, so "forget the second one" can be done.
 */
function notebookLines(): string[] {
  const notes = listNotes();
  if (notes.length === 0) return [];
  return [
    'THE NOTEBOOK (what the owner told you; remove one only when asked):',
    ...notes.map((n) => `  id ${n.id} · ${n.kind === 'brief' ? 'for the brief' : 'remember'} · ${n.text}`),
    '',
  ];
}

/**
 * What the owner asked for that is still running, or has just landed. Without it, "did
 * that finish?" one turn after the agent queued something is unanswerable.
 */
function inFlight(snapshot: Snapshot): string[] {
  const jobs = snapshot.work?.jobs ?? [];
  const mine = jobs.filter((job) => job.origin === 'dispatched' && job.state !== 'parked');
  const landed = snapshot.work?.finished ?? [];
  if (mine.length === 0 && landed.length === 0) return [];
  return [
    'WORK THE OWNER ASKED FOR:',
    ...mine.map((job) => `  still running: ${job.title}`),
    ...landed.map((job) => `  just finished: ${job.title}`),
    '',
  ];
}

/**
 * The door the route hands in, bound to this answer. `did` reads back what it changed —
 * the only source the page's list is built from.
 */
export type Doors = {
  act?: (turn: string, words: string) => AgentActions & { did(): AnswerChange[] };
};

/**
 * First-person claims of a change: "I've filed", "I have marked", "Done — …". Descriptions
 * of state ("a is filed under Webhooks") are deliberately not matched: a false alarm on
 * every answer about filing would teach the owner to ignore the flag.
 */
const CLAIM =
  /\bI(?:'ve| have| just| also)?\s+(?:just\s+|now\s+|also\s+|gone ahead and\s+)?(?:filed|moved|renamed|created|deleted|removed|marked|set|cleared|confirmed|queued|started|updated|changed|rewrote|rewritten|reorganised|reorganized|regrouped|grouped|added|unfiled|retried|made)\b|^\s*done\b/i;

export const claimsChange = (text: string): boolean => CLAIM.test(text);

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
  const turn = randomUUID();

  // The door exists only when changes are allowed — so a model told it cannot change
  // anything also has no way to, whatever it says.
  const act = settings.agentEnabled && doors.act ? doors.act(turn, text) : null;

  // What was said, if the thread is still warm (D93). The state is re-read fresh below it
  // either way — the transcript carries the conversation, never the facts.
  const earlier = recall(settings.advisorMemoryMinutes);
  const preamble = transcript(earlier);
  const body = buildAskPrompt(snapshot, text, settings.askBranchCap);

  const result = await converse(settings, {
    system: systemFor(act !== null),
    user: preamble ? `${preamble}\n\n---\n\n${body}` : body,
    tools: act ? agentTools(settings) : agentTools({ ...settings, agentEnabled: false }),
    ctx: { ...contextFor(snapshot, settings, null), act },
    // One id for the whole conversation: every turn shares the register as its prefix,
    // and routing them together is what keeps it cached (D66).
    sessionId: threadId(),
    limits: { calls: settings.agentCallsPerQuestion, seconds: settings.agentSeconds },
    // Its tool calls may already have changed things; an error would hide that (finding 3).
    onExhausted: 'return',
  });

  const changes = act?.did() ?? [];
  const parsed = result.unfinished
    ? { text: unfinishedText(changes.length), ranking: [], groups: [], suggestions: [] }
    : parseAnswer(result.text, snapshot, settings);

  const answer: Answer = {
    question: text,
    ...parsed,
    turn,
    changes,
    unbacked: changes.length === 0 && claimsChange(parsed.text),
    unfinished: result.unfinished,
    looked: result.uses.filter((use) => READS.has(use.name)).map((use) => use.name),
    inThread: earlier.length,
    askedAt: new Date().toISOString(),
    sawBranches: threads.length,
    sawGoals: snapshot.goals.length,
    model: settings.llmModel,
    ms: Date.now() - started,
  };

  // Remembered with what it changed and what it proposed, so "yes, do that" and "undo the
  // second one" have something to refer to (finding 2).
  remember(text, parsed.text, {
    answer,
    did: changes.map((c) => c.text),
    proposed: describeProposal(parsed.groups),
    suggested: parsed.suggestions.map((x) => `${x.label} ${String(x.from)} → ${String(x.to)}`),
  });
  return answer;
}

/** It stopped before answering. Say so, and say what it got done, rather than failing. */
function unfinishedText(changed: number): string {
  return changed > 0
    ? `I ran out of steps before I finished. ${changed === 1 ? 'One change is' : `${changed} changes are`} listed below; ask me to carry on for the rest.`
    : 'I ran out of steps before I finished, and changed nothing. Ask again, or more narrowly.';
}

function describeProposal(groups: ProposedGroup[]): string | null {
  if (groups.length === 0) return null;
  return groups.map((g) => `${g.title} (${g.branches.map((b) => b.branch).join(', ')})`).join('; ');
}

const MAX_RANKED = 20;
const MAX_GROUPS = 20;
const MAX_SUGGESTIONS = 3;
/** The tools that only read. What it looked at goes under the answer; what it changed is listed apart. */
const READS = new Set(['branch', 'what_changed', 'board', 'settings']);

/**
 * Reads the reply. Lenient about the wrapper, strict about the contents — and a reply
 * that is not JSON at all is still an answer: a model that ignores the shape has usually
 * still answered the question, and that is worth more than an error.
 */
export function parseAnswer(
  raw: string,
  snapshot: Snapshot,
  current: Settings | null = null,
): Pick<Answer, 'text' | 'ranking' | 'groups' | 'suggestions'> {
  const plain = { text: raw.trim(), ranking: [], groups: [], suggestions: [] };
  const json = extractJson(raw);
  if (!json) return plain;

  let parsed: { answer?: unknown; ranking?: unknown; groups?: unknown; settings?: unknown };
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

  return { text: parsed.answer.trim(), ranking, groups, suggestions: current ? suggestionsFrom(parsed.settings, current) : [] };
}

/**
 * Its suggestions, checked against the one table of tunables: a name it made up, a secret,
 * the model or the repos are dropped; a value is clamped into range; and a suggestion to
 * set what is already set is no suggestion.
 */
function suggestionsFrom(raw: unknown, current: Settings): SettingSuggestion[] {
  const out: SettingSuggestion[] = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const item = row as { setting?: unknown; to?: unknown; why?: unknown } | null;
    const t = typeof item?.setting === 'string' ? tunable(item.setting.trim()) : null;
    if (!t || out.some((x) => x.setting === t.key)) continue;
    const to = coerceTunable(t, item?.to);
    const from = current[t.key];
    if (to === null || to === from) continue;
    out.push({ setting: t.key, label: t.label, from, to, why: typeof item?.why === 'string' ? item.why.trim().slice(0, 300) : '' });
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}
