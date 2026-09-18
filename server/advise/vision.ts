/**
 * The three things the model does with visions: draft one, assess against one, and split
 * a paragraph into several.
 *
 * Every prompt here is single-turn and tool-free, like the rest of the advisor (D60).
 * Everything the model returns is treated as untrusted — shape checked, enum checked,
 * cited SHAs checked against the branch's own commits, branch names checked against the
 * fleet. A model that invents a branch gets that line dropped, not applied.
 */

import { randomUUID } from 'node:crypto';

import { refKey, type Branch, type BranchRef, type Settings, type Verdict } from '../../shared/types.ts';
import { toolSetTag, toolsFor } from '../tools/catalog.ts';
import type { ToolContext } from '../tools/types.ts';
import { complete } from './client.ts';
import { converse } from './converse.ts';
import { extractJson, shortSha, validEvidence } from './prompt.ts';

/** Part of every assessment cache key: bumping it re-judges everything rather than
 *  leaving a silent mix of old reasoning and new. */
export const VISION_PROMPT_VERSION = 'v1';

/**
 * The version an assessment is cached under, **including the tools the station had**
 * (D74). An assessment written with the fleet in view is a different thing from one
 * written from commit subjects alone, and the store must not hold both under one key with
 * no way to tell them apart.
 */
export function assessVersion(settings: Settings): string {
  return VISION_PROMPT_VERSION + toolSetTag(toolsFor('assess', settings));
}

const VERDICTS: Verdict[] = ['on-track', 'drifted', 'done', 'overtaken', 'unclear'];

const MAX_COMMITS = 25;
const MAX_BODY = 300;

// ---------------------------------------------------------------------------
// Drafting a vision
// ---------------------------------------------------------------------------

/**
 * The falsifiability rule is the whole of this prompt.
 *
 * A vision that cannot be contradicted by anything — "improve the UI", "make it better"
 * — can never detect drift, can never be satisfied, and is therefore worse than no
 * vision at all, because it looks like the owner said something. So the model is told to
 * decline rather than pad.
 */
const DRAFT_SYSTEM = `You read a git branch and propose what it is FOR — the outcome it is trying to reach.

This is a proposal, not a description. The owner will confirm, edit or reject it.

It must be FALSIFIABLE: specific enough that future commits could contradict it.
  GOOD  "Replace the native select with a searchable picker that filters as you type."
  GOOD  "Find out whether mmap is faster for large files than the current read path."
  BAD   "Improve the user interface."          (nothing could ever contradict this)
  BAD   "Work on the advisor."                 (says nothing)
  BAD   "Add keyboard navigation and filtering and a status line and tests."  (a list of commits, not a purpose)

Rules:
- One or two sentences. Plain English. No trailing period on a fragment.
- Say the OUTCOME, not the commits. If you find yourself listing what was done, you are
  writing a summary, not a vision.
- If the history is too thin or too scattered to name one purpose, DECLINE. Returning
  nothing is correct and useful; a vague vision is neither.
- An experiment's purpose is the question it answers, not a result. "Find out whether X"
  is a good vision and it is satisfied either way.

Reply with ONLY a JSON object, no prose, no markdown fence:
{"vision": "...", "from": "what you drew it from, one short phrase"}
or, if you cannot be specific:
{"vision": null, "why": "one short phrase"}`;

export type Draft = { text: string; from: string } | { text: null; why: string };

export async function draftVision(branch: Branch, settings: Parameters<typeof complete>[0], sessionId?: string): Promise<Draft> {
  const raw = await complete(settings, {
    system: DRAFT_SYSTEM,
    user: describeBranch(branch),
    maxTokens: 300,
    ...(sessionId ? { sessionId } : {}),
  });
  return parseDraft(raw);
}

export function parseDraft(raw: string): Draft {
  const json = extractJson(raw);
  if (!json) return { text: null, why: 'the model did not reply with JSON' };
  try {
    const parsed = JSON.parse(json) as { vision?: unknown; from?: unknown; why?: unknown };
    if (typeof parsed.vision !== 'string' || !parsed.vision.trim()) {
      return { text: null, why: typeof parsed.why === 'string' ? parsed.why : 'not specific enough to say' };
    }
    return {
      text: parsed.vision.trim(),
      from: typeof parsed.from === 'string' ? parsed.from.trim() : '',
    };
  } catch {
    return { text: null, why: 'the model’s reply was not valid JSON' };
  }
}

// ---------------------------------------------------------------------------
// Assessing against a vision
// ---------------------------------------------------------------------------

const ASSESS_SYSTEM = `You are given what a branch was FOR, and what it actually did. Compare them.

Verdicts:
  on-track  the work matches the stated purpose
  drifted   it is doing something real, but not this. You MUST name what it is doing instead.
  done      the purpose is satisfied. This is NOT the same as merged — a branch can be
            done and unmerged, or merged and not done. An experiment whose question has
            been answered is done, even if the answer was "no".
  unclear   you cannot tell. Usually the vision is too vague to test, or the history is
            too thin. Say which.

Rules:
- Judge against the stated purpose, not against what you would have done.
- Wandering is not automatically a fault: a branch can satisfy its purpose AND do other
  things. Only call it drifted if the purpose is being neglected.
- One sentence for "because". No hedging, no restating the vision back.
- Cite the short SHAs your reading rests on, most important first, at most 4.

Reply with ONLY a JSON object, no prose, no markdown fence:
{"verdict": "on-track|drifted|done|unclear", "because": "...", "evidence": ["sha", ...]}`;

export type AssessResult = {
  verdict: Verdict;
  because: string;
  evidence: string[];
  /** What it looked up to decide, so a wrong verdict is debuggable rather than mysterious. */
  looked: string[];
};

/**
 * The one station with tools so far, and the reason is its verdicts.
 *
 * *Drifted* is a claim about intent, and the fleet-level *overtaken* it feeds is a claim
 * that another branch got there first — neither is knowable from one branch's commit
 * subjects. `sibling_branches` is what that actually needs; `what_changed` is what tells a
 * stall from a pause. Without them the honest answer to most of this is "unclear", which
 * is what it has been returning.
 */
export async function assessBranch(
  branch: Branch,
  visionText: string,
  settings: Settings,
  options: {
    sessionId?: string;
    ctx?: ToolContext;
    onTool?: (name: string | null) => void;
    spend?: () => boolean;
  } = {},
): Promise<AssessResult> {
  const tools = options.ctx ? toolsFor('assess', settings) : [];
  const user = `It is FOR: ${visionText}\n\n${describeBranch(branch)}`;
  const sessionId = options.sessionId ?? randomUUID();

  if (tools.length === 0 || !options.ctx) {
    const raw = await complete(settings, { system: ASSESS_SYSTEM, user, maxTokens: 350, sessionId });
    return parseAssessment(raw, branch);
  }

  const result = await converse(settings, {
    system: ASSESS_SYSTEM,
    user,
    tools,
    ctx: options.ctx,
    sessionId,
    maxTokens: 350,
    ...(options.onTool ? { onTool: options.onTool } : {}),
    ...(options.spend ? { spend: options.spend } : {}),
  });

  return {
    ...parseAssessment(result.text, branch),
    looked: result.uses.map((use) => use.name),
  };
}

export function parseAssessment(raw: string, branch: Branch): AssessResult {
  const json = extractJson(raw);
  if (!json) {
    return { verdict: 'unclear', because: 'the model did not reply with JSON', evidence: [], looked: [] };
  }
  try {
    const parsed = JSON.parse(json) as { verdict?: unknown; because?: unknown; evidence?: unknown };
    const verdict = VERDICTS.includes(parsed.verdict as Verdict) ? (parsed.verdict as Verdict) : 'unclear';
    // `overtaken` is never a per-branch judgement: it can only be seen by comparing
    // against the rest of the fleet, which this prompt is not shown. See brief.ts.
    const safe: Verdict = verdict === 'overtaken' ? 'unclear' : verdict;
    return {
      verdict: safe,
      because: typeof parsed.because === 'string' ? parsed.because.trim() : '',
      evidence: validEvidence(parsed.evidence, branch),
      looked: [],
    };
  } catch {
    return { verdict: 'unclear', because: 'the model’s reply was not valid JSON', evidence: [], looked: [] };
  }
}

// ---------------------------------------------------------------------------
// Splitting a paragraph across branches
// ---------------------------------------------------------------------------

/**
 * The route that does not scale with branch count: the owner talks about several
 * branches the way they would to a person, and this pulls it apart.
 *
 * Nothing is applied from this — it returns proposals for confirmation.
 */
const DISTRIBUTE_SYSTEM = `The owner has described what several branches are for, in their own words, all at once. Split it into one purpose per branch.

You are given the branches that exist. Use ONLY those exact branch names — never invent one, never guess at a branch not in the list.

Rules:
- Cover only the branches the owner actually referred to, by name or unmistakably by
  description. Leave the rest out; silence is better than a guess.
- Keep their words and their meaning. You are splitting, not rewriting.
- Each vision must be falsifiable — specific enough that future commits could contradict
  it. If what they said about a branch is too vague to be a yardstick, leave that branch
  out rather than padding it.
- If they said a branch is finished or dead, set "suggest" to "done" or "close".
  Otherwise omit it.

Reply with ONLY a JSON object, no prose, no markdown fence:
{"visions": [{"repo": "owner/name", "branch": "exact-branch-name", "vision": "...", "suggest": "done|close"}]}`;

export type Distributed = {
  ref: BranchRef;
  vision: string;
  suggest: 'done' | 'close' | null;
};

export async function distributeVisions(
  paragraph: string,
  branches: Branch[],
  settings: Parameters<typeof complete>[0],
): Promise<Distributed[]> {
  const list = branches
    .map((b) => `- ${b.repoKey} ${b.name}${b.title ? ` — currently: ${b.title}` : ''}`)
    .join('\n');

  const raw = await complete(settings, {
    system: DISTRIBUTE_SYSTEM,
    user: `Branches that exist:\n${list}\n\nWhat the owner said:\n${paragraph.trim()}`,
    maxTokens: 700,
    sessionId: randomUUID(),
  });
  return parseDistribution(raw, branches);
}

export function parseDistribution(raw: string, branches: Branch[]): Distributed[] {
  const json = extractJson(raw);
  if (!json) return [];

  // An object rather than a bare array: `extractJson` finds objects, and a model that
  // wraps its reply in a sentence is common enough to design around.
  let rows: unknown;
  try {
    rows = (JSON.parse(json) as { visions?: unknown }).visions;
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  const known = new Set<string>(branches.map((b) => refKey(b.repoKey, b.name)));
  const out: Distributed[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const item = row as { repo?: unknown; branch?: unknown; vision?: unknown; suggest?: unknown };
    if (typeof item.repo !== 'string' || typeof item.branch !== 'string') continue;
    if (typeof item.vision !== 'string' || !item.vision.trim()) continue;

    const key = refKey(item.repo, item.branch);
    // An invented branch is dropped rather than shown. The owner should never be asked to
    // confirm a vision for something that does not exist.
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);

    out.push({
      ref: { repoKey: item.repo, branch: item.branch },
      vision: item.vision.trim(),
      suggest: item.suggest === 'done' || item.suggest === 'close' ? item.suggest : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** What the model is shown about one branch. No diffstat — D59 keeps it out of sight,
 *  and it is not what "what is this for" turns on. */
export function describeBranch(branch: Branch): string {
  const lines = [
    `Repo: ${branch.repoKey}`,
    `Branch: ${branch.name}`,
    `${branch.ahead} ahead of base, ${branch.behind} behind.`,
    `CI: ${branch.ci.state}.`,
    branch.pr
      ? `Pull request #${branch.pr.number} "${branch.pr.title}" — ${branch.pr.state}${branch.pr.draft ? ' (draft)' : ''}.`
      : 'No pull request.',
    '',
    'Commits, newest first:',
  ];

  if (branch.commits.length === 0) {
    lines.push('(none of its own)');
  } else {
    for (const commit of branch.commits.slice(0, MAX_COMMITS)) {
      lines.push(`  ${shortSha(commit.sha)}  ${commit.message}`);
      if (commit.body) lines.push(`      ${commit.body.slice(0, MAX_BODY).replace(/\s+/g, ' ')}`);
    }
  }
  return lines.join('\n');
}
