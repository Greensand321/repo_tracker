/**
 * Does this model do tool calling, and how?
 *
 * The agent plan rests on an unverified assumption: that a budget model on OpenCode Go
 * can reliably be handed tools and asked to call one. Zen fronts 100+ models of wildly
 * varying capability, and we have already been burned once by depending on a feature
 * some of them reject outright (`response_format`).
 *
 * So this answers the question with one cheap call before anything is built on top.
 * Two paths are tested, because the agent will support both:
 *
 *   native   — tools declared in the request, model replies with a structured call
 *   protocol — no tool support needed; the model is asked to reply with JSON
 *
 * Native is better when it works. The protocol is the floor, and it works anywhere.
 */

import type { Settings } from '../../shared/types.ts';
import { LlmError, complete, guessProtocol, isOpenCode, type Protocol } from './client.ts';
import { extractJson } from './prompt.ts';

export type ProbeOutcome = 'works' | 'unsupported' | 'wrong-shape' | 'error';

export type ProbeResult = {
  model: string;
  baseUrl: string;
  protocol: Protocol;
  native: { outcome: ProbeOutcome; detail: string };
  jsonProtocol: { outcome: ProbeOutcome; detail: string };
  recommendation: string;
};

/** A deliberately unambiguous tool: there is exactly one sensible call to make. */
const TOOL = {
  name: 'get_branch',
  description: 'Look up one branch and return its commits. Use this to answer questions about a branch.',
  parameters: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'owner/name' },
      branch: { type: 'string', description: 'the literal git branch name' },
    },
    required: ['repo', 'branch'],
    additionalProperties: false,
  },
} as const;

const ASK = 'What is happening on branch feat/webhooks in repo acme/api? Look it up.';

export async function probeTools(settings: Settings): Promise<ProbeResult> {
  if (!settings.llmApiKey) throw new LlmError('no API key set');
  if (!settings.llmModel) throw new LlmError('no model chosen');

  const protocol = guessProtocol(settings.llmModel, settings.llmBaseUrl);

  const native = await probeNative(settings, protocol);
  const jsonProtocol = await probeJsonProtocol(settings);

  return {
    model: settings.llmModel,
    baseUrl: settings.llmBaseUrl,
    protocol,
    native,
    jsonProtocol,
    recommendation: recommend(native.outcome, jsonProtocol.outcome),
  };
}

// ---------------------------------------------------------------------------
// Native tool calling
// ---------------------------------------------------------------------------

async function probeNative(
  settings: Settings,
  protocol: Protocol,
): Promise<{ outcome: ProbeOutcome; detail: string }> {
  if (protocol === 'responses') {
    return { outcome: 'error', detail: 'not probed — the Responses API is not covered by this check yet' };
  }

  const body =
    protocol === 'messages'
      ? {
          model: settings.llmModel,
          max_tokens: 400,
          messages: [{ role: 'user', content: ASK }],
          tools: [{ name: TOOL.name, description: TOOL.description, input_schema: TOOL.parameters }],
        }
      : {
          model: settings.llmModel,
          max_tokens: 400,
          messages: [{ role: 'user', content: ASK }],
          tools: [{ type: 'function', function: TOOL }],
        };

  const path = protocol === 'messages' ? '/messages' : '/chat/completions';

  let payload: Record<string, unknown>;
  try {
    payload = await post(settings, path, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A model with no tool support usually rejects the `tools` field outright.
    const unsupported = /tool|function|unsupported|not supported|invalid/i.test(message);
    return { outcome: unsupported ? 'unsupported' : 'error', detail: message };
  }

  const call = findToolCall(payload);
  if (!call) {
    return {
      outcome: 'wrong-shape',
      detail: 'accepted the tools but answered in prose instead of calling one',
    };
  }
  if (call.name !== TOOL.name) {
    return { outcome: 'wrong-shape', detail: `called "${call.name}" rather than "${TOOL.name}"` };
  }
  return { outcome: 'works', detail: `called ${call.name}(${call.args})` };
}

/** Finds a tool call in whichever response shape came back. */
export function findToolCall(payload: Record<string, unknown>): { name: string; args: string } | null {
  // OpenAI chat completions
  const choices = payload['choices'];
  if (Array.isArray(choices)) {
    const calls = (choices[0] as { message?: { tool_calls?: unknown[] } } | undefined)?.message?.tool_calls;
    const first = Array.isArray(calls) ? (calls[0] as { function?: { name?: string; arguments?: string } }) : null;
    if (first?.function?.name) {
      return { name: first.function.name, args: first.function.arguments ?? '' };
    }
  }

  // Anthropic messages
  const content = payload['content'];
  if (Array.isArray(content)) {
    for (const block of content) {
      const record = block as { type?: string; name?: string; input?: unknown };
      if (record.type === 'tool_use' && record.name) {
        return { name: record.name, args: JSON.stringify(record.input ?? {}) };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// The JSON protocol — the floor, needs no tool support at all
// ---------------------------------------------------------------------------

const PROTOCOL_SYSTEM = `You answer by calling tools. Available tools:

  get_branch(repo, branch) — look up one branch and return its commits

Reply with ONLY a JSON object, no prose and no markdown fence:
{"tool": "get_branch", "args": {"repo": "...", "branch": "..."}}

If you can answer without a tool, reply with {"answer": "..."} instead.`;

async function probeJsonProtocol(settings: Settings): Promise<{ outcome: ProbeOutcome; detail: string }> {
  let raw: string;
  try {
    raw = await complete(settings, { system: PROTOCOL_SYSTEM, user: ASK, maxTokens: 300 });
  } catch (err) {
    return { outcome: 'error', detail: err instanceof Error ? err.message : String(err) };
  }

  const json = extractJson(raw);
  if (!json) {
    return { outcome: 'wrong-shape', detail: `no JSON in the reply: ${oneLine(raw)}` };
  }

  try {
    const parsed = JSON.parse(json) as { tool?: unknown; args?: unknown };
    if (parsed.tool !== 'get_branch') {
      return { outcome: 'wrong-shape', detail: `expected tool "get_branch", got ${oneLine(json)}` };
    }
    const args = parsed.args as { repo?: unknown; branch?: unknown } | undefined;
    if (typeof args?.repo !== 'string' || typeof args?.branch !== 'string') {
      return { outcome: 'wrong-shape', detail: `arguments were not filled in: ${oneLine(json)}` };
    }
    return { outcome: 'works', detail: `replied ${oneLine(json)}` };
  } catch (err) {
    return { outcome: 'wrong-shape', detail: `unparseable JSON: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------

function recommend(native: ProbeOutcome, json: ProbeOutcome): string {
  if (native === 'works' && json === 'works') {
    return 'Both work. Use native tool calling, keep the JSON protocol as the fallback.';
  }
  if (native === 'works') {
    return 'Native tool calling works. The JSON protocol is unreliable on this model, so do not rely on it as a fallback here.';
  }
  if (json === 'works') {
    return 'Native tool calling is not usable, but the JSON protocol works — build on that. It is the floor for a reason.';
  }
  return 'Neither worked on this model. Try a stronger one: the agent makes a handful of calls per question, so a better model for this job costs very little.';
}

async function post(
  settings: Settings,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${settings.llmApiKey}`,
  };
  if (path === '/messages') headers['anthropic-version'] = '2023-06-01';
  if (isOpenCode(settings.llmBaseUrl)) headers['x-opencode-session'] = `probe-${Date.now()}`;

  const res = await fetch(`${settings.llmBaseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new LlmError(`${res.status} — ${oneLine(text)}`, res.status);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LlmError(`reply was not JSON: ${oneLine(text)}`);
  }
}

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 219)}…` : flat;
};
