import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LlmError, complete, extractText, forgetProtocols, guessProtocol } from '../server/advise/client.ts';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.ts';

// One test below reaches through the insight store, which writes to disk. Point it at a
// temp dir before anything imports paths.ts, so `npm test` never touches real data.
process.env['BEARING_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'bearing-client-'));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  forgetProtocols();
});

const settings = (model: string): Settings => ({
  ...DEFAULT_SETTINGS,
  llmApiKey: 'key',
  llmModel: model,
  llmBaseUrl: 'https://opencode.ai/zen/v1',
});

const request = { system: 'sys', user: 'usr' };

/** Answers only on `okPath`; everything else 400s the way Zen does for a wrong endpoint. */
function routeTo(okPath: string, body: unknown): { paths: string[] } {
  const paths: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path.endsWith(okPath)) {
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(
      JSON.stringify({ error: { message: 'Upstream request failed: Model is unavailable.' } }),
      { status: 400 },
    );
  }) as typeof fetch;
  return { paths };
}

// --- the bug this exists to prevent -----------------------------------------

test('a Claude model goes to /messages, not /chat/completions', async () => {
  // Zen routes model families to different endpoints; sending Claude to
  // /chat/completions returns a flat "Model is unavailable".
  const { paths } = routeTo('/messages', { content: [{ type: 'text', text: 'hello' }] });
  const text = await complete(settings('claude-opus-5'), request);

  assert.equal(text, 'hello');
  assert.equal(paths[0], '/zen/v1/messages', 'should have guessed right first time');
  assert.equal(paths.length, 1, 'a correct guess costs no extra requests');
});

test('a GPT model goes to /responses', async () => {
  const { paths } = routeTo('/responses', { output_text: 'hello' });
  assert.equal(await complete(settings('gpt-5.5'), request), 'hello');
  assert.equal(paths[0], '/zen/v1/responses');
});

test('an unrecognised model defaults to /chat/completions', async () => {
  const { paths } = routeTo('/chat/completions', { choices: [{ message: { content: 'hello' } }] });
  assert.equal(await complete(settings('deepseek-v4'), request), 'hello');
  assert.equal(paths[0], '/zen/v1/chat/completions');
});

test('a wrong guess recovers by trying the other endpoints', async () => {
  // "kimi-k3" looks like a chat/completions model but answers on /messages here.
  const { paths } = routeTo('/messages', { content: [{ type: 'text', text: 'recovered' }] });
  assert.equal(await complete(settings('kimi-k3'), request), 'recovered');
  assert.ok(paths.length > 1, 'it had to probe');
  assert.ok(paths.some((p) => p.endsWith('/messages')));
});

test('what worked is remembered, so the next branch costs one request', async () => {
  const { paths } = routeTo('/messages', { content: [{ type: 'text', text: 'ok' }] });
  const config = settings('kimi-k3');

  await complete(config, request);
  const afterFirst = paths.length;
  await complete(config, request);

  assert.equal(paths.length - afterFirst, 1, 'second call should go straight to /messages');
});

// --- failures that are NOT a wrong endpoint must not be retried three times ---

test('a rejected key fails once, not once per endpoint', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  }) as typeof fetch;

  await assert.rejects(complete(settings('claude-opus-5'), request), LlmError);
  assert.equal(calls, 1, 'auth failures are not an endpoint mismatch');
});

test('a model that answers nowhere reports what was tried', async () => {
  const { paths } = routeTo('/nothing-matches', {});
  await assert.rejects(complete(settings('made-up-model'), request), (err: LlmError) => {
    assert.match(err.message, /did not answer on any known endpoint/);
    assert.match(err.message, /chat/);
    return true;
  });
  assert.equal(paths.length, 3, 'all three protocols attempted');
});

// --- reading the reply out of whichever shape came back ---

test('the reply is found in all three response shapes', () => {
  assert.equal(extractText({ choices: [{ message: { content: 'a' } }] }), 'a');
  assert.equal(extractText({ content: [{ type: 'text', text: 'b' }] }), 'b');
  assert.equal(extractText({ output_text: 'c' }), 'c');
  assert.equal(
    extractText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'd' }] }] }),
    'd',
  );
});

test('content split across parts is joined, not truncated', () => {
  assert.equal(
    extractText({ choices: [{ message: { content: [{ text: 'half ' }, { text: 'a reply' }] } }] }),
    'half a reply',
  );
  assert.equal(
    extractText({ content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }] }),
    'one two',
  );
});

test('an empty or unrecognised reply is null, not a crash', () => {
  assert.equal(extractText({}), null);
  assert.equal(extractText({ choices: [] }), null);
  assert.equal(extractText({ content: [{ type: 'text', text: '   ' }] }), null);
});

test('the protocol guess covers the families Zen actually splits on', () => {
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'qwen3-max']) {
    assert.equal(guessProtocol(model), 'messages', model);
  }
  for (const model of ['gpt-5.5', 'gpt-6-astra', 'grok-4']) {
    assert.equal(guessProtocol(model), 'responses', model);
  }
  for (const model of ['deepseek-v4', 'glm-5', 'kimi-k3', 'big-pickle']) {
    assert.equal(guessProtocol(model), 'chat', model);
  }
});

// --- getting the model ID right, which has already gone wrong once ---

import { toModelInfo } from '../server/advise/client.ts';

test('an id-shaped value wins over a prettier one, whatever key it came under', () => {
  // The bug: falling back to the display name meant "DeepSeek V4.1 Flash" was sent as
  // the model, and the provider answered "Model is unavailable".
  assert.deepEqual(
    toModelInfo({ name: 'DeepSeek V4.1 Flash', model: 'deepseek-v4.1-flash' }),
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  );
  assert.deepEqual(
    toModelInfo({ id: 'big-pickle', display_name: 'Big Pickle' }),
    { id: 'big-pickle', name: 'Big Pickle' },
  );
  assert.deepEqual(
    toModelInfo({ label: 'Claude Opus 5', slug: 'claude-opus-5' }),
    { id: 'claude-opus-5', name: 'Claude Opus 5' },
  );
});

test('the standard OpenAI shape still works', () => {
  assert.deepEqual(toModelInfo({ id: 'gpt-5.5', object: 'model' }), { id: 'gpt-5.5' });
  assert.deepEqual(toModelInfo('kimi-k3'), { id: 'kimi-k3' });
});

test('a display name is only used as an ID when there is nothing else', () => {
  assert.deepEqual(toModelInfo({ name: 'Only A Label' }), { id: 'Only A Label' });
});

test('junk rows are dropped rather than becoming a broken model choice', () => {
  for (const row of [null, 42, {}, { object: 'model' }, '', '   ']) {
    assert.equal(toModelInfo(row), null, JSON.stringify(row));
  }
});

// --- OpenCode Go: same key, different endpoint, different billing ---

import { isGoEndpoint } from '../server/advise/client.ts';

test('the Go endpoint is recognised', () => {
  assert.equal(isGoEndpoint('https://opencode.ai/zen/go/v1'), true);
  assert.equal(isGoEndpoint('https://opencode.ai/zen/go/v1/'), true);
  assert.equal(isGoEndpoint('https://opencode.ai/zen/v1'), false);
});

test('on Go every model goes straight to /chat/completions', () => {
  // Go serves everything over chat-completions, so guessing by model family there
  // would waste a request on every Claude and GPT model.
  assert.equal(guessProtocol('claude-opus-5', 'https://opencode.ai/zen/go/v1'), 'chat');
  assert.equal(guessProtocol('gpt-5.5', 'https://opencode.ai/zen/go/v1'), 'chat');
  // ...while the pay-as-you-go endpoint still routes by family.
  assert.equal(guessProtocol('claude-opus-5', 'https://opencode.ai/zen/v1'), 'messages');
});

test('a Go model reaches chat-completions in one request', async () => {
  const { paths } = routeTo('/chat/completions', { choices: [{ message: { content: 'ok' } }] });
  const config: Settings = {
    ...settings('claude-opus-5'),
    llmBaseUrl: 'https://opencode.ai/zen/go/v1',
  };

  assert.equal(await complete(config, request), 'ok');
  assert.equal(paths.length, 1, 'no wasted probe of /messages');
  assert.equal(paths[0], '/zen/go/v1/chat/completions');
});

test('an empty-balance error points at the Go endpoint', async () => {
  // A Go subscription billed through the Zen URL looks exactly like an empty wallet.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'Insufficient balance. Manage your billing here: ...' } }), {
      status: 401,
    })) as typeof fetch;

  await assert.rejects(complete(settings('kimi-k3'), request), (err: LlmError) => {
    assert.match(err.message, /Insufficient balance/);
    assert.match(err.message, /zen\/go\/v1/, 'should name the Go endpoint');
    return true;
  });
});

// --- the session header OpenCode Go requires (400 without it since 6 Sep 2026) ---

import { isOpenCode } from '../server/advise/client.ts';

/** Captures the headers of every request. */
function captureHeaders(body: unknown): { headers: Headers[] } {
  const headers: Headers[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    headers.push(new Headers(init.headers));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { headers };
}

test('the session header is sent to OpenCode', async () => {
  const { headers } = captureHeaders({ choices: [{ message: { content: 'ok' } }] });
  const config: Settings = { ...settings('kimi-k3'), llmBaseUrl: 'https://opencode.ai/zen/go/v1' };

  await complete(config, { ...request, sessionId: 'abc-123' });
  assert.equal(headers[0]!.get('x-opencode-session'), 'abc-123');
});

test('it is not sent to other providers, which may reject unknown headers', async () => {
  const { headers } = captureHeaders({ choices: [{ message: { content: 'ok' } }] });
  const config: Settings = { ...settings('some-model'), llmBaseUrl: 'https://api.example.com/v1' };

  await complete(config, { ...request, sessionId: 'abc-123' });
  assert.equal(headers[0]!.get('x-opencode-session'), null);
});

test('OpenCode hosts are recognised, and lookalikes are not', () => {
  assert.equal(isOpenCode('https://opencode.ai/zen/go/v1'), true);
  assert.equal(isOpenCode('https://opencode.ai/zen/v1'), true);
  assert.equal(isOpenCode('https://api.opencode.ai/v1'), true);
  assert.equal(isOpenCode('https://api.openai.com/v1'), false);
  assert.equal(isOpenCode('https://evil.com/opencode.ai/v1'), false);
});

test('every branch in one run shares a session, and runs differ', async () => {
  // The system prompt is identical for every branch, so routing a run together is
  // exactly what the header is for.
  const seen: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers).get('x-opencode-session') ?? '');
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ title: 'T', summary: 'S.', progress: 'done', evidence: [] }) } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const advise = await import('../server/advise/enrich.ts');
  const makeSnapshot = () => ({
    generatedAt: '2026-09-16T12:00:00Z', repos: [], warnings: [], rateLimit: null,
    llm: { enabled: false, pending: 0, errors: [] },
    branches: ['a', 'b'].map((name) => ({
      repoKey: 'o/r', name, headSha: `sha-${name}-${Math.random()}`, url: 'u',
      commits: [{ sha: 'abc1234', message: 'work', body: '', author: 'claude', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
      ahead: 1, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
      diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
      pr: null, ci: { state: 'none' as const, url: null }, relevance: 'active' as const,
      isBase: false, title: null, summary: null, progress: null, insight: null,
    })),
  });

  const config: Settings = { ...settings('kimi-k3'), llmBaseUrl: 'https://opencode.ai/zen/go/v1' };

  const first = makeSnapshot();
  advise.applyCached(first, config);
  await advise.enrich(first, config);
  const runOne = seen.splice(0);

  const second = makeSnapshot();
  advise.applyCached(second, config);
  await advise.enrich(second, config);
  const runTwo = seen.splice(0);

  assert.equal(runOne.length, 2);
  assert.ok(runOne[0] && runOne[0] === runOne[1], 'one session across the run');
  assert.notEqual(runOne[0], runTwo[0], 'a later run is a different session');
});

// --- the tool-calling probe (docs/plans/agent-plan.md step 1) ---

import { findToolCall } from '../server/advise/probe.ts';

test('a tool call is found in both response shapes', () => {
  assert.deepEqual(
    findToolCall({ choices: [{ message: { tool_calls: [{ function: { name: 'get_branch', arguments: '{"repo":"a/b"}' } }] } }] }),
    { name: 'get_branch', args: '{"repo":"a/b"}' },
  );
  assert.deepEqual(
    findToolCall({ content: [{ type: 'text', text: 'let me look' }, { type: 'tool_use', name: 'get_branch', input: { repo: 'a/b' } }] }),
    { name: 'get_branch', args: '{"repo":"a/b"}' },
  );
});

test('a prose reply is not mistaken for a tool call', () => {
  // The failure that matters: a model that accepts `tools` and then ignores them.
  assert.equal(findToolCall({ choices: [{ message: { content: 'I would look up that branch.' } }] }), null);
  assert.equal(findToolCall({ content: [{ type: 'text', text: 'I would look it up.' }] }), null);
  assert.equal(findToolCall({}), null);
});
