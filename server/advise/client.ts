/**
 * The advisor's connection to the outside world. The second I/O boundary, alongside
 * server/github.ts.
 *
 * Written against the wire format rather than a vendor SDK because the endpoint is
 * deliberately swappable — pointing at a different provider is a settings change.
 *
 * **Three protocols, not one.** OpenCode Zen (D32) routes model families to different
 * endpoints, and sending a Claude model to `/chat/completions` fails with a flat
 * "Model is unavailable":
 *
 *   /v1/chat/completions   DeepSeek, GLM, Kimi, MiniMax, Big Pickle, Nemotron, …
 *   /v1/messages           Claude, Qwen, Union Alpha        (Anthropic shape)
 *   /v1/responses          GPT, Grok, Muse Spark            (OpenAI Responses shape)
 *
 * The model ID picks the first guess; if that is wrong we try the others and remember
 * what worked, so a mis-guess costs one extra request per model per run and never
 * strands you on a model that would have been fine.
 *
 * Deliberately NOT using `response_format: json_object`: Zen fronts 100+ models of
 * varying capability and the ones that reject that parameter fail the whole request.
 * The prompt asks for JSON and the parser is tolerant of a fence — see prompt.ts.
 */

import { randomUUID } from 'node:crypto';

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
  /**
   * Opaque, stable for one batch of work, distinct between batches. OpenCode requires
   * this on Go (400 without it since 6 Sep 2026) and uses it to route a conversation's
   * requests to the same provider so the shared prompt prefix stays cached.
   */
  sessionId?: string;
};

export type Protocol = 'chat' | 'messages' | 'responses';

/** What worked last time, per model. Avoids re-probing on every branch. */
const learned = new Map<string, Protocol>();

/** Exported for tests; resets the learned routing. */
export function forgetProtocols(): void {
  learned.clear();
}

/** The OpenCode Go subscription endpoint, which is plain chat-completions for everything. */
export const isGoEndpoint = (baseUrl: string): boolean => /\/zen\/go(\/|$)/.test(baseUrl);

/** Only OpenCode wants the session header; other providers may reject unknown headers. */
export const isOpenCode = (baseUrl: string): boolean => /(^|\/\/)([^/]*\.)?opencode\.ai\//.test(baseUrl);

/**
 * First guess from the model ID. Wrong guesses are recovered from, so this only has to
 * be right often enough to save a request.
 *
 * The Go endpoint is the exception worth special-casing: it serves every model over
 * `/chat/completions`, so guessing by family there would waste a request on each model.
 */
export function guessProtocol(model: string, baseUrl = ''): Protocol {
  if (isGoEndpoint(baseUrl)) return 'chat';
  const id = model.toLowerCase();
  if (/(^|\/)(claude|qwen|union)/.test(id)) return 'messages';
  if (/(^|\/)(gpt|grok|muse|o[0-9])/.test(id)) return 'responses';
  return 'chat';
}

const ALL: Protocol[] = ['chat', 'messages', 'responses'];

export async function complete(settings: Settings, request: CompletionRequest): Promise<string> {
  if (!settings.llmApiKey) throw new LlmError('no API key set');
  if (!settings.llmModel) throw new LlmError('no model chosen');

  const model = settings.llmModel;
  const known = learned.get(model);
  const first = guessProtocol(model, settings.llmBaseUrl);
  const order = known ? [known] : [first, ...ALL.filter((p) => p !== first)];

  const tried: string[] = [];
  let lastError: LlmError | null = null;

  for (const protocol of order) {
    try {
      const text = await callProtocol(protocol, settings, request);
      learned.set(model, protocol);
      return text;
    } catch (err) {
      const error = err instanceof LlmError ? err : new LlmError(String(err));
      lastError = error;
      tried.push(protocol);
      // A wrong endpoint for the model looks like a 400/404/405. Anything else — a bad
      // key, no credit, a rate limit — means the protocol was fine and retrying the
      // others would just repeat the same failure three times.
      if (!looksLikeWrongEndpoint(error)) throw error;
    }
  }

  const detail = lastError?.message ?? 'unknown error';
  throw new LlmError(
    `"${model}" did not answer on any known endpoint (tried ${tried.join(', ')}) — ${detail}`,
    lastError?.status,
  );
}

function looksLikeWrongEndpoint(err: LlmError): boolean {
  if (err.status === 404 || err.status === 405) return true;
  if (err.status !== 400) return false;
  return /unavailable|not found|unsupported|unknown model|invalid model|does not exist/i.test(err.message);
}

async function callProtocol(
  protocol: Protocol,
  settings: Settings,
  request: CompletionRequest,
): Promise<string> {
  const maxTokens = request.maxTokens ?? 700;
  const spec =
    protocol === 'messages'
      ? {
          path: '/messages',
          // Zen fronts Anthropic's shape; the version header is required by it.
          headers: { 'anthropic-version': '2023-06-01' } as Record<string, string>,
          body: {
            model: settings.llmModel,
            max_tokens: maxTokens,
            temperature: 0.2,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
          },
        }
      : protocol === 'responses'
        ? {
            path: '/responses',
            headers: {},
            body: {
              model: settings.llmModel,
              max_output_tokens: maxTokens,
              instructions: request.system,
              input: request.user,
            },
          }
        : {
            path: '/chat/completions',
            headers: {},
            body: {
              model: settings.llmModel,
              max_tokens: maxTokens,
              // The same branch should not describe itself differently each run.
              temperature: 0.2,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user },
              ],
            },
          };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${settings.llmApiKey}`,
    ...spec.headers,
  };
  if (isOpenCode(settings.llmBaseUrl)) {
    // Mandatory on Go — a request without it is a flat 400. It used to be sent only when
    // a caller remembered to pass one, and three of them did not: the brief failed on
    // every single read for as long as the program was open. A required header has no
    // business being optional, so one is minted here when the caller has no batch to
    // name. Callers that DO have a batch still pass theirs, which is what keeps a run's
    // shared prompt prefix warm on one provider.
    headers['x-opencode-session'] = request.sessionId ?? randomUUID();
  }

  const res = await withTimeout((signal) =>
    fetch(`${baseUrl(settings)}${spec.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(spec.body),
      signal,
    }),
  );

  if (!res.ok) throw new LlmError(await describeFailure(res), res.status);

  const payload = (await res.json()) as Record<string, unknown>;
  const error = payload['error'] as { message?: string } | string | undefined;
  if (error) throw new LlmError(typeof error === 'string' ? error : (error.message ?? 'provider error'));

  const text = extractText(payload);
  if (!text) throw new LlmError('the model returned an empty reply');
  return text;
}

/**
 * Pulls the reply text out of whichever shape came back. Written to accept all three
 * rather than branching on the protocol, because gateways are not always faithful to
 * the format they claim.
 */
export function extractText(payload: Record<string, unknown>): string | null {
  // OpenAI chat completions
  const choices = payload['choices'];
  if (Array.isArray(choices)) {
    const message = (choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined);
    const content = message?.message?.content ?? message?.text;
    if (typeof content === 'string' && content.trim()) return content;
    // Some gateways return content as an array of parts.
    if (Array.isArray(content)) {
      const joined = content
        .map((part) => (typeof part === 'string' ? part : ((part as { text?: string })?.text ?? '')))
        .join('');
      if (joined.trim()) return joined;
    }
  }

  // OpenAI Responses convenience field
  const outputText = payload['output_text'];
  if (typeof outputText === 'string' && outputText.trim()) return outputText;

  // Anthropic messages, and the Responses `output` array
  for (const key of ['content', 'output'] as const) {
    const blocks = payload[key];
    if (!Array.isArray(blocks)) continue;
    const joined = blocks
      .flatMap((block) => {
        if (typeof block === 'string') return [block];
        const record = block as { text?: unknown; content?: unknown };
        if (typeof record.text === 'string') return [record.text];
        if (Array.isArray(record.content)) {
          return record.content.map((part) =>
            typeof part === 'string' ? part : ((part as { text?: string })?.text ?? ''),
          );
        }
        return [];
      })
      .join('');
    if (joined.trim()) return joined;
  }

  return null;
}

export type ModelInfo = { id: string; name?: string };

/** Raw upstream payload, for working out why a model was rejected. */
export async function fetchModelsRaw(settings: Settings): Promise<unknown> {
  if (!settings.llmApiKey) throw new LlmError('no API key set');

  const res = await withTimeout((signal) =>
    fetch(`${baseUrl(settings)}/models`, {
      headers: { authorization: `Bearer ${settings.llmApiKey}` },
      signal,
    }),
  );
  if (!res.ok) throw new LlmError(await describeFailure(res), res.status);
  return res.json();
}

/**
 * The provider's own model list, so nobody — including me — has to guess a model ID.
 *
 * Getting the ID out is the fiddly part and it has already gone wrong once: an earlier
 * version fell back to the display name when there was no `id` key, so the settings
 * screen offered "DeepSeek V4.1 Flash", that got sent as the model, and the provider
 * answered "Model is unavailable" — an error that points nowhere near the cause.
 *
 * So: look through the keys providers actually use, and **prefer a value that looks
 * like an identifier** (no spaces). A display name is only used as an ID when there is
 * genuinely nothing else, and even then it is flagged rather than sent silently.
 */
export async function listModels(settings: Settings): Promise<ModelInfo[]> {
  const payload = (await fetchModelsRaw(settings)) as Record<string, unknown>;

  const rows = ['data', 'models', 'items'].reduce<unknown[]>((found, key) => {
    if (found.length > 0) return found;
    const value = payload[key];
    return Array.isArray(value) ? value : found;
  }, Array.isArray(payload) ? (payload as unknown[]) : []);

  const seen = new Set<string>();
  return rows
    .map(toModelInfo)
    .filter((model): model is ModelInfo => model !== null)
    .filter((model) => (seen.has(model.id) ? false : seen.add(model.id)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Keys seen across OpenAI-compatible gateways, most authoritative first. */
const ID_KEYS = ['id', 'model', 'model_id', 'modelId', 'slug', 'canonical_slug', 'name'];
const NAME_KEYS = ['name', 'display_name', 'displayName', 'label', 'title'];

/** An identifier has no spaces. "DeepSeek V4.1 Flash" is a label; "deepseek-v4.1" is an ID. */
const looksLikeId = (value: string): boolean => value.trim().length > 0 && !/\s/.test(value);

export function toModelInfo(row: unknown): ModelInfo | null {
  if (typeof row === 'string') return row.trim() ? { id: row.trim() } : null;
  if (typeof row !== 'object' || row === null) return null;

  const record = row as Record<string, unknown>;
  const candidates = ID_KEYS.map((key) => record[key]).filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  // An id-shaped value always beats a prettier one, whatever key it came under.
  const id = (candidates.find(looksLikeId) ?? candidates[0])?.trim();
  if (!id) return null;

  const name = NAME_KEYS.map((key) => record[key]).find(
    (value): value is string => typeof value === 'string' && value.trim() !== '' && value.trim() !== id,
  );
  return name ? { id, name: name.trim() } : { id };
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

  // A subscription plan billed through a different endpoint looks exactly like an empty
  // wallet, so say so rather than sending someone to add credit they do not need.
  const wrongPlanHint = /insufficient balance|no credit|add funds/i.test(detail)
    ? ' — if you are on the OpenCode Go subscription, set the provider endpoint to' +
      ' https://opencode.ai/zen/go/v1 instead; Go is billed separately from Zen credit'
    : '';

  if (res.status === 401 || res.status === 403) {
    return `the provider rejected the API key${detail ? ` — ${detail}` : ''}${wrongPlanHint}`;
  }
  if (res.status === 429) return `rate limited by the provider${detail ? ` — ${detail}` : ''}`;
  if (res.status === 402) {
    return `billing problem at the provider${detail ? ` — ${detail}` : ''}${wrongPlanHint}`;
  }
  return `provider returned ${res.status}${detail ? ` — ${detail}` : ''}${wrongPlanHint}`;
}
