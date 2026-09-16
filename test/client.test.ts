import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { LlmError, complete, extractText, forgetProtocols, guessProtocol } from '../server/advise/client.ts';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.ts';

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
