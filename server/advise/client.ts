/**
 * The advisor's connection to the outside world. The second I/O boundary, alongside
 * server/github.ts.
 *
 * OpenAI-compatible chat completions, against OpenCode Zen by default (D32). Written
 * against the wire format rather than a vendor SDK because the endpoint is deliberately
 * swappable — the same code reaches any OpenAI-compatible provider by changing a setting.
 *
 * Deliberately NOT using `response_format: json_object`: Zen fronts 100+ models of
 * varying capability and the ones that reject that parameter fail the whole request.
 * The prompt asks for JSON and the parser is tolerant of a fence — see prompt.ts.
 */

import type { Settings } from '../../shared/types.ts';

export class LlmError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** A slow model must not hold up the whole refresh. */
const TIMEOUT_MS = 90_000;

export type CompletionRequest = {
  system: string;
  user: string;
  maxTokens?: number;
};

export async function complete(settings: Settings, request: CompletionRequest): Promise<string> {
  if (!settings.llmApiKey) throw new LlmError('no API key set');
  if (!settings.llmModel) throw new LlmError('no model chosen');

  const body = {
    model: settings.llmModel,
    max_tokens: request.maxTokens ?? 700,
    temperature: 0.2, // the same branch should not describe itself differently each run
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  };

  const res = await withTimeout((signal) =>
    fetch(`${baseUrl(settings)}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.llmApiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    }),
  );

  if (!res.ok) throw new LlmError(await describeFailure(res), res.status);

  const payload = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string };
  };
  if (payload.error?.message) throw new LlmError(payload.error.message);

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LlmError('the model returned an empty reply');
  }
  return content;
}

export type ModelInfo = { id: string; name?: string };

/**
 * The provider's own model list. This exists so nobody — including me — has to guess a
 * model ID: the settings screen and the debug CLI both offer what actually exists.
 */
export async function listModels(settings: Settings): Promise<ModelInfo[]> {
  if (!settings.llmApiKey) throw new LlmError('no API key set');

  const res = await withTimeout((signal) =>
    fetch(`${baseUrl(settings)}/models`, {
      headers: { authorization: `Bearer ${settings.llmApiKey}` },
      signal,
    }),
  );
  if (!res.ok) throw new LlmError(await describeFailure(res), res.status);

  const payload = (await res.json()) as { data?: unknown; models?: unknown };
  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];

  return rows
    .map((row): ModelInfo | null => {
      if (typeof row === 'string') return { id: row };
      if (typeof row === 'object' && row !== null) {
        const record = row as Record<string, unknown>;
        const id = record['id'] ?? record['name'];
        if (typeof id === 'string') {
          const name = record['name'];
          return typeof name === 'string' && name !== id ? { id, name } : { id };
        }
      }
      return null;
    })
    .filter((model): model is ModelInfo => model !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const baseUrl = (settings: Settings): string => settings.llmBaseUrl.replace(/\/+$/, '');

async function withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError(`the model did not answer within ${TIMEOUT_MS / 1000}s`);
    }
    throw new LlmError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Providers put the real reason in the body; a bare status code is not actionable. */
async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      detail =
        typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? text.slice(0, 200));
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // Body already consumed or unreadable; the status alone will have to do.
  }

  if (res.status === 401 || res.status === 403) {
    return `the provider rejected the API key${detail ? ` — ${detail}` : ''}`;
  }
  if (res.status === 429) return `rate limited by the provider${detail ? ` — ${detail}` : ''}`;
  if (res.status === 402) return `billing problem at the provider${detail ? ` — ${detail}` : ''}`;
  return `provider returned ${res.status}${detail ? ` — ${detail}` : ''}`;
}
