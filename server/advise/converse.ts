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

/** What the result of a tool may occupy in the next prompt. Beyond this it is cut. */
const MAX_RESULT_CHARS = 4000;

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

export type ConverseRequest = {
  system: string;
  user: string;
  tools: Tool[];
  ctx: ToolContext;
  sessionId: string;
  maxTokens?: number;
  /** Called as each tool starts, so the floor can show what a worker is doing. */
  onTool?: (name: string) => void;
};

export async function converse(settings: Settings, request: ConverseRequest): Promise<ConverseResult> {
  const uses: ToolUse[] = [];

  // No tools is not a special case worth branching on elsewhere: it is one plain call,
  // identical to what every station did before this file existed.
  if (request.tools.length === 0) {
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
    const last = call >= maxCalls || Date.now() >= deadline;
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

    const wanted = readToolCall(raw);
    if (!wanted) return { text: raw, uses, hitBudget };

    if (last) {
      // It asked for another lookup with nothing left to spend. Its last reply is the
      // answer we have to work with, and the station's parser will say so honestly if it
      // is not usable. Better that than an unbounded loop.
      hitBudget = true;
      return { text: raw, uses, hitBudget };
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
        failed = true;
        result =
          err instanceof ToolError
            ? `That call failed: ${err.message}`
            : `That call failed: ${err instanceof Error ? err.message : String(err)}`;
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
