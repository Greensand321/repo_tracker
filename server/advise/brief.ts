/**
 * The brief, the goal judgements, and the one verdict that needs the whole fleet.
 *
 * These are one call rather than three because they need the same thing: every branch,
 * its vision, and its verdict, all at once. In particular **overtaken** — a branch made
 * pointless because another branch satisfied its purpose first — cannot be seen from
 * inside a single branch, and nothing in git records it. Only stated intent, compared
 * across the fleet, can find it. It is the verdict that pays for the whole mechanism.
 *
 * Cached on everything it looked at, so an unmoved fleet regenerates nothing.
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  refKey,
  type Branch,
  type BriefParts,
  type BranchRef,
  type Goal,
  type GoalJudgement,
  type GoalState,
  type Settings,
  type Snapshot,
} from '../../shared/types.ts';
import { complete } from './client.ts';
import { extractJson } from './prompt.ts';

/** v2: three parts — done, next, now (D89). v4: no branch names in the prose; they sit beside it (D90). */
export const BRIEF_PROMPT_VERSION = 'v4';

const GOAL_STATES: GoalState[] = ['progressing', 'at-risk', 'stalled', 'looks-done', 'needs-you'];

const SYSTEM = `You are a personal assistant to one developer whose branches are all pushed by AI coding agents running week-long sessions. They have big ideas and many threads and cannot hold it all in their head. You can.

You are given every branch: what it is FOR (its vision, where one has been stated), what it DID and what is still OPEN on it, and how the two compare. Plus the goals the owner has authored and which branches sit under each.

Produce three things.

1. THE BRIEF, in three parts. Each is ONE sentence, at most 35 words, of plain English — no lists, no headings, no markdown. Write like a colleague leaning over, not a status report.
     done   what has landed or looks finished, and what it delivered.
     next   the one thing most in their way — red CI, work that has drifted, something half-finished, a decision only the owner can make — and what to do about it.
     now    what is actually going on: what moved most recently and what it is mid-way through.
   NEVER write a branch name inside a sentence. Branch names are identifiers, not words; the owner reads the sentence and the names sit beside it. Say what the work is ("the assignee repaint", "the webhook retries", "five merged branches under the webhook goal"), never which branch. Then, for each part, list the literal git names of the branches that sentence rests on — at most four per part, the ones that matter most — in "branches".
   If something has no vision and you cannot tell what it is for, say so in a few words rather than filling the gap.

2. GOAL JUDGEMENTS — for each goal, one of:
     progressing   branches are moving toward it
     at-risk       something concrete is in the way (red CI, a blocked branch)
     stalled       nothing has moved for a while and nothing is obviously blocking it
     looks-done    every branch under it looks finished. PROPOSE this; never assume it.
     needs-you     it cannot progress without a decision from the owner
   with one sentence of reasoning and the branches it rests on.
   Be conservative with looks-done. A wrong "done" is the one mistake they will never
   catch, because they will not go back and check it.

3. OVERTAKEN — branches whose stated purpose has already been achieved somewhere else.
   Only report one when you can name the branch that did it and say why. This is rare;
   an empty list is the normal answer. Never report a branch as overtaken by itself.

Reply with ONLY a JSON object, no prose around it, no markdown fence:
{
  "done": "...",
  "next": "...",
  "now": "...",
  "branches": {"done": ["branch-name", ...], "next": ["branch-name", ...], "now": ["branch-name", ...]},
  "goals": [{"id": "...", "state": "progressing|at-risk|stalled|looks-done|needs-you", "because": "...", "branches": ["branch-name", ...]}],
  "overtaken": [{"repo": "owner/name", "branch": "...", "byRepo": "owner/name", "byBranch": "...", "why": "..."}]
}`;

export type BriefResult = {
  /** The parts joined. Empty when the model wrote none of them. */
  brief: string;
  /** Null when the reply was in the old one-paragraph shape. */
  parts: BriefParts | null;
  judgements: Map<string, GoalJudgement>;
  overtaken: { ref: BranchRef; by: BranchRef; why: string }[];
};

/**
 * Everything the brief looked at, hashed. Two reads over an unchanged fleet produce the
 * same key and the second costs nothing — the same economics that already make a hundred
 * branch summaries affordable (D39).
 */
export function briefKey(snapshot: Snapshot, settings: Settings): string {
  const parts = snapshot.branches
    .filter((b) => !b.isBase)
    .map((b) => `${b.repoKey}/${b.name}@${b.headSha}#${b.vision?.text ?? ''}#${b.assessment?.verdict ?? ''}`)
    .sort();
  for (const goal of [...snapshot.goals].sort((a, b) => a.id.localeCompare(b.id))) {
    // Which branches, not how many: moving one between two goals of equal size changes
    // what every judgement rests on and left the key exactly as it was.
    const members = goal.branches.map((b) => refKey(b.repoKey, b.branch)).sort().join(',');
    parts.push(`goal:${goal.id}:${goal.title}:${goal.done}:${members}`);
  }
  parts.push(BRIEF_PROMPT_VERSION, settings.llmModel);
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export function buildBriefPrompt(snapshot: Snapshot, cap: number): string {
  const threads = snapshot.branches
    .filter((b) => !b.isBase)
    .sort((a, b) => Date.parse(b.lastActivity ?? '0') - Date.parse(a.lastActivity ?? '0'))
    .slice(0, cap);

  const lines: string[] = [`Today is ${snapshot.generatedAt.slice(0, 10)}.`, '', 'BRANCHES:'];

  for (const branch of threads) {
    lines.push(`- ${branch.repoKey} ${branch.name}`);
    lines.push(
      `    ${branch.ahead} ahead / ${branch.behind} behind · CI ${branch.ci.state}` +
        (branch.pr ? ` · PR #${branch.pr.number} ${branch.pr.state}` : '') +
        (branch.relevance === 'quiet' ? ' · gone quiet' : '') +
        (branch.lastActivity ? ` · last commit ${branch.lastActivity.slice(0, 10)}` : ''),
    );
    lines.push(
      branch.vision
        ? `    FOR: ${branch.vision.text}${branch.vision.state === 'proposed' ? '  (only my guess — not confirmed)' : ''}`
        : '    FOR: nobody has said.',
    );
    // The recap, not the one-line gist: "next" turns on what is open, and "done" on what
    // landed, and the gist folds both into one sentence.
    if (branch.recap) {
      lines.push(`    DID: ${branch.recap.done || branch.recap.last}`);
      if (branch.recap.next) lines.push(`    LEFT: ${branch.recap.next}`);
    } else if (branch.summary) {
      lines.push(`    DID: ${branch.summary}`);
    }
    if (branch.assessment) lines.push(`    COMPARED: ${branch.assessment.verdict} — ${branch.assessment.because}`);
  }

  lines.push('', 'GOALS:');
  if (snapshot.goals.length === 0) {
    lines.push('  (none authored yet)');
  } else {
    for (const goal of snapshot.goals) {
      const members = goal.branches.map((b) => b.branch).join(', ') || 'no branches yet';
      lines.push(`- id ${goal.id} · "${goal.title}"${goal.done ? ' (owner marked done)' : ''}`);
      if (goal.note) lines.push(`    the owner's note: ${goal.note}`);
      lines.push(`    branches: ${members}`);
    }
  }

  return lines.join('\n');
}

export async function writeBrief(
  snapshot: Snapshot,
  settings: Settings,
  sessionId: string = randomUUID(),
): Promise<BriefResult> {
  const raw = await complete(settings, {
    system: SYSTEM,
    user: buildBriefPrompt(snapshot, settings.askBranchCap),
    // The read's own session: every job in one read is one batch of work, which is what
    // keeps a shared prompt prefix warm on one provider. A caller with no read behind it
    // gets a fresh one rather than no header at all (D66).
    sessionId,
  });
  return parseBrief(raw, snapshot, settings);
}

export function parseBrief(raw: string, snapshot: Snapshot, settings: Settings): BriefResult {
  const empty: BriefResult = { brief: '', parts: null, judgements: new Map(), overtaken: [] };
  const json = extractJson(raw);
  if (!json) return empty;

  let parsed: { brief?: unknown; done?: unknown; next?: unknown; now?: unknown; branches?: unknown; goals?: unknown; overtaken?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return empty;
  }

  const now = new Date().toISOString();
  const goalIds = new Set(snapshot.goals.map((g) => g.id));
  const branchNames = new Set<string>(
    snapshot.branches.filter((b) => !b.isBase).map((b) => refKey(b.repoKey, b.name)),
  );

  const judgements = new Map<string, GoalJudgement>();
  if (Array.isArray(parsed.goals)) {
    for (const row of parsed.goals) {
      const item = row as { id?: unknown; state?: unknown; because?: unknown; branches?: unknown };
      // A judgement about a goal that does not exist is dropped, not invented into one.
      if (typeof item.id !== 'string' || !goalIds.has(item.id)) continue;
      if (!GOAL_STATES.includes(item.state as GoalState)) continue;

      const goal = snapshot.goals.find((g) => g.id === item.id)!;
      const members = new Set(goal.branches.map((b) => b.branch));
      const evidence: BranchRef[] = Array.isArray(item.branches)
        ? (item.branches as unknown[])
            .filter((n): n is string => typeof n === 'string' && members.has(n))
            .map((n) => goal.branches.find((b) => b.branch === n)!)
        : [];

      judgements.set(item.id, {
        state: item.state as GoalState,
        because: typeof item.because === 'string' ? item.because.trim() : '',
        evidence,
        model: settings.llmModel,
        promptVersion: BRIEF_PROMPT_VERSION,
        generatedAt: now,
      });
    }
  }

  const overtaken: BriefResult['overtaken'] = [];
  if (Array.isArray(parsed.overtaken)) {
    for (const row of parsed.overtaken) {
      const item = row as Record<string, unknown>;
      const ref = asRef(item['repo'], item['branch']);
      const by = asRef(item['byRepo'], item['byBranch']);
      if (!ref || !by) continue;
      const a = refKey(ref.repoKey, ref.branch);
      const b = refKey(by.repoKey, by.branch);
      if (!branchNames.has(a) || !branchNames.has(b)) continue;
      if (a === b) continue; // a branch cannot overtake itself
      overtaken.push({ ref, by, why: typeof item['why'] === 'string' ? item['why'].trim() : '' });
    }
  }

  // Three parts when the model wrote them; the old single paragraph when it did not.
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  // The branches a part rests on: real ones only, by name, matched across the fleet.
  const byName = new Map<string, BranchRef>();
  for (const b of snapshot.branches) if (!b.isBase) byName.set(b.name, { repoKey: b.repoKey, branch: b.name });
  const refsOf = (value: unknown): BranchRef[] => {
    const seen = new Set<string>();
    const out: BranchRef[] = [];
    for (const name of Array.isArray(value) ? value : []) {
      const ref = typeof name === 'string' ? byName.get(name.trim()) : undefined;
      if (ref && !seen.has(ref.branch)) { seen.add(ref.branch); out.push(ref); }
      if (out.length === 4) break;
    }
    return out;
  };
  const named = (parsed.branches ?? {}) as { done?: unknown; next?: unknown; now?: unknown };
  const parts: BriefParts = {
    done: text(parsed.done), next: text(parsed.next), now: text(parsed.now),
    refs: { done: refsOf(named.done), next: refsOf(named.next), now: refsOf(named.now) },
  };
  const hasParts = Boolean(parts.done || parts.next || parts.now);
  const brief = hasParts ? [parts.done, parts.next, parts.now].filter(Boolean).join(' ') : text(parsed.brief);

  return { brief, parts: hasParts ? parts : null, judgements, overtaken };
}

function asRef(repo: unknown, branch: unknown): BranchRef | null {
  return typeof repo === 'string' && typeof branch === 'string' ? { repoKey: repo, branch } : null;
}

/** Only these branches deserve a question; the rest are noise at a hundred branches. */
export function worthAVision(branch: Branch): boolean {
  return !branch.isBase && branch.commits.length > 0 && branch.relevance === 'active';
}

export const goalTitle = (goal: Goal): string => goal.title;
