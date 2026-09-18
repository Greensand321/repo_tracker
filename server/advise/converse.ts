/**
 * A worker that can look things up before it answers.
 *
 * **The JSON protocol, not native tool calling.** The model replies with
 * `{"tool": "...", "args": {...}}`; we run it, hand back the result, and ask again. This
 * needs no tool support from the provider at all — only the ability to return JSON, which
 * every one of the six prompts here already relies on. That matters because the provider
 * is swappable by design (D32): the floor has to work everywhere, and native tool calling
 * is an optimisation on top of it rather than the thing it rests on. `npm run probe` says
 * *which*, never *whether*.
 *
 * How a final answer is told apart from a tool call: a reply whose JSON has a `tool` key
 * naming a known tool is a call; anything else is the answer, passed back untouched to the
 * station's own parser. So no station's prompt or parser changes to gain tools — which is
 * what makes this safe to put behind a setting.
 *
 * Three things bound it, and it needs all three:
 *   the model stops asking · the call budget runs out · the clock runs out.
 */

import type { Settings } from '../../shared/types.ts';
import { ToolError, type Tool, type ToolContext } from '../tools/types.ts';
import { complete } from './client.ts';
import { extractJson } from './prompt.ts';

/** What one result may occupy in the next prompt. Beyond this it is cut. */
const MAX_RESULT_CHARS = 4000;

/**
 * And what all of them may occupy together. Eight results of four thousand characters is a
 * prompt several times the size of the branch it is about — at which point the evidence is
 * drowning the question. Past this, the worker is told to answer with what it has.
 */
const MAX_TRANSCRIPT_CHARS = 12_000;

export type ToolUse = {
  name: string;
  args: Record<string, unknown>;
  result: string;
  failed: boolean;
  ms: number;
};

export type ConverseResult = {
  /** The model's final reply, raw. The station parses it exactly as it always did. */
  text: string;
  uses: ToolUse[];
  /** True when it was cut off and told to answer with what it had. */
  hitBudget: boolean;
};

/**
 * Out of budget part-way through a conversation.
 *
 * Deliberately an error rather than a truncated answer: the station would otherwise write
 * down whatever the half-finished exchange produced — an "unclear" verdict that looks like
 * a judgement and is really an accounting limit. The job is simply not done, and the next
 * read, with a fresh budget, does it properly.
 */
export class BudgetError extends Error {
  constructor() {
    super('the read ran out of budget part-way through');
    this.name = 'BudgetError';
  }
}

export type ConverseRequest = {
  system: string;
  user: string;
  tools: Tool[];
  ctx: ToolContext;
  sessionId: string;
  maxTokens?: number;
  /** The tool's name as it starts, then null as it ends. Drives the floor. */
  onTool?: (name: string | null) => void;
  /** Permission for one more provider call. Absent means unmetered (tests, one-offs). */
  spend?: () => boolean;
};

export async function converse(settings: Settings, request: ConverseRequest): Promise<ConverseResult> {
  const uses: ToolUse[] = [];

  // No tools — or no lookups allowed, which is the same thing — is not a special case
  // worth branching on elsewhere: it is one plain call, identical to what every station
  // did before this file existed. Advertising tools that cannot be used would be worse
  // than not having them: the model would spend its one reply asking for one.
  if (request.tools.length === 0 || settings.toolCallsPerJob <= 0) {
    const text = await complete(settings, {
      system: request.system,
      user: request.user,
      sessionId: request.sessionId,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    });
    return { text, uses, hitBudget: false };
  }

  const byName = new Map(request.tools.map((tool) => [tool.name, tool] as const));
  const maxCalls = Math.max(0, settings.toolCallsPerJob);
  const deadline = Date.now() + Math.max(1, settings.toolSeconds) * 1000;

  // Identical calls are answered from what we already have. A model that loops is a real
  // failure mode, and this makes the loop cheap and — because the repeat still costs
  // budget — finite.
  const seen = new Map<string, string>();

  const system = `${request.system}\n\n${preamble(request.tools, maxCalls)}`;
  const transcript: string[] = [];
  let hitBudget = false;

  for (let call = 0; ; call++) {
    // The first call was paid for when the job was claimed; every turn after it asks.
    if (call > 0 && request.spend && !request.spend()) throw new BudgetError();

    const written = transcript.reduce((n, entry) => n + entry.length, 0);
    const last = call >= maxCalls || Date.now() >= deadline || written >= MAX_TRANSCRIPT_CHARS;
    const user = [
      request.user,
      ...transcript,
      last && call > 0 ? '\nYou have no lookups left. Answer now, with what you have.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await complete(settings, {
      system,
      user,
      sessionId: request.sessionId,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    });

    hitBudget = hitBudget || last;
    const wanted = readToolCall(raw);
    if (!wanted) return { text: raw, uses, hitBudget };

    if (last) {
      // Told to answer, and it asked for another lookup instead. Handing this back would
      // have the station parse a tool call as a verdict: "unclear", with no reason, cached
      // and shown as though it were a judgement. A job that did not answer did not answer.
      throw new Error(
        `it asked to look things up ${uses.length + 1} times and never answered`,
      );
    }

    const tool = byName.get(wanted.name);
    const key = `${wanted.name}(${stable(wanted.args)})`;
    const started = Date.now();
    let result: string;
    let failed = false;

    if (!tool) {
      failed = true;
      result = `There is no tool called "${wanted.name}". The ones you have are: ${[...byName.keys()].join(', ')}.`;
    } else if (seen.has(key)) {
      result = `${seen.get(key)!}\n(You already asked this. Use it or answer.)`;
    } else {
      request.onTool?.(tool.name);
      try {
        result = cut(String(await tool.run(wanted.args, request.ctx)));
        seen.set(key, result);
      } catch (err) {
        request.onTool?.(null);
        // A ToolError is something the worker can fix — a bad argument, a SHA that is not
        // on this branch — so it goes back as the result and the conversation continues.
        //
        // Anything else is not: a rate limit, an outage, a rejected token. Handing that
        // back would have every job in the read discover it separately, at full price, and
        // answer without the evidence it asked for while looking as confident as ever. The
        // job fails instead, and the next read tries again.
        if (!(err instanceof ToolError)) throw err;
        failed = true;
        result = `That call failed: ${err.message}`;
      } finally {
        request.onTool?.(null);
      }
    }

    uses.push({ name: wanted.name, args: wanted.args, result, failed, ms: Date.now() - started });
    transcript.push(`\n--- you asked for ${key} ---\n${result}\n--- end ---`);
  }
}

// ---------------------------------------------------------------------------

/**
 * The tool list, in the prompt.
 *
 * It says the cost of each one out loud because that is the cheapest steering there is,
 * and it says to prefer answering directly — the failure mode of a tool-using worker is
 * looking three things up to confirm what it already knew.
 */
export function preamble(tools: Tool[], maxCalls: number): string {
  const lines = tools.map((tool) => {
    const args = tool.args
      .map((arg) => `${arg.name}${arg.required ? '' : '?'}: ${arg.type} — ${arg.about}`)
      .join(', ');
    return `  ${tool.name}(${args || 'no arguments'})\n    ${tool.description}`;
  });

  return `BEFORE ANSWERING, you may look things up. Available:

${lines.join('\n')}

To look something up, reply with ONLY this and nothing else:
{"tool": "<name>", "args": {...}}

I will run it and send you the result, and then you may look up something else or answer.
At most ${maxCalls} lookups in total.

Only look something up when it would change your answer. Most of the time what you have
already been given is enough, and an answer now is worth more than a better-researched one
later. When you answer, reply in the format described above — the one with no "tool" key.`;
}

/** A tool call, or null when this reply is the station's answer. */
export function readToolCall(raw: string): { name: string; args: Record<string, unknown> } | null {
  const json = extractJson(raw);
  if (!json) return null;

  let parsed: { tool?: unknown; args?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return null;
  }

  if (typeof parsed.tool !== 'string' || !parsed.tool.trim()) return null;
  const args =
    parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
      ? (parsed.args as Record<string, unknown>)
      : {};
  return { name: parsed.tool.trim(), args };
}

/** Same arguments in a different order are the same call. */
function stable(args: Record<string, unknown>): string {
  return Object.keys(args)
    .sort()
    .map((key) => `${key}=${JSON.stringify(args[key])}`)
    .join(',');
}

function cut(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n(cut — ask for less next time)`;
}
