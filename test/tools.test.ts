/**
 * The tool layer: the loop, the budget, and the two free tools.
 *
 * What is being protected here is that a worker with tools stays **bounded and honest**.
 * The loop must terminate whatever the model does — including asking for a tool that does
 * not exist, asking for the same one forever, or asking for one after it has run out —
 * and everything the model sends is untrusted input, arguments included.
 */

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Branch, Settings, Snapshot } from '../shared/types.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

const TEMP = mkdtempSync(join(tmpdir(), 'bearing-tools-'));
process.env['BEARING_DATA_DIR'] = TEMP;

import type { GitHubReader } from '../server/tools/evidence.ts';

let converse: typeof import('../server/advise/converse.ts');
let free: typeof import('../server/tools/free.ts');
let catalog: typeof import('../server/tools/catalog.ts');
let toolTypes: typeof import('../server/tools/types.ts');
let ghTools: typeof import('../server/tools/github.ts');
let evidence: typeof import('../server/tools/evidence.ts');

before(async () => {
  converse = await import('../server/advise/converse.ts');
  free = await import('../server/tools/free.ts');
  catalog = await import('../server/tools/catalog.ts');
  toolTypes = await import('../server/tools/types.ts');
  ghTools = await import('../server/tools/github.ts');
  evidence = await import('../server/tools/evidence.ts');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(join(TEMP, 'history'), { recursive: true, force: true });
  rmSync(join(TEMP, 'evidence.json'), { force: true });
  evidence?.resetEvidenceCache();
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  llmApiKey: 'key',
  llmModel: 'test-model',
  llmBaseUrl: 'https://opencode.ai/zen/v1',
  ...over,
});

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'o/r', name, headSha: `sha-${name}`, url: 'u',
    commits: [{ sha: 'abc1234def', message: `work on ${name}`, body: '', author: 'claude', authoredAt: '2026-09-15T00:00:00Z', url: 'c' }],
    ahead: 2, behind: 0, lastActivity: '2026-09-15T00:00:00Z',
    diff: { files: 1, additions: 1, deletions: 0 }, activity: ['2026-09-15'],
    pr: null, ci: { state: 'none', url: null }, relevance: 'active', isBase: false, goalId: null,
    vision: null, assessment: null, title: null, summary: null, progress: null, insight: null, recap: null, commitsFrom: 'ahead', ...over,
  };
}

const snapshot = (branches: Branch[]): Snapshot => ({
  generatedAt: '2026-09-17T12:00:00Z', repos: [], branches, warnings: [], rateLimit: null, goals: [],
  brief: null, work: { jobs: [], workers: 2, finished: [] }, llm: { enabled: true, pending: 0, errors: [] },
});

/** A GitHub reader that answers from a script and counts what it was asked. */
function reader(over: Partial<GitHubReader> = {}): GitHubReader & { asks: string[] } {
  const asks: string[] = [];
  return {
    asks,
    async readme(repoKey: string) {
      asks.push(`readme:${repoKey}`);
      return over.readme ? over.readme(repoKey) : '# The thing\n\nIt does the thing.';
    },
    async commitFiles(repoKey: string, sha: string) {
      asks.push(`files:${repoKey}@${sha}`);
      return over.commitFiles
        ? over.commitFiles(repoKey, sha)
        : { sha, files: [{ path: 'src/a.ts', status: 'modified', added: 4, removed: 1 }], truncated: false };
    },
  };
}

const ctx = (
  branches: Branch[],
  subject: Branch | null,
  over: Partial<Settings> = {},
  github: GitHubReader | null = reader(),
) => {
  // A tool is handed SafeSettings, never Settings: it cannot leak a token it never had.
  const { token: _t, llmApiKey: _k, ...safe } = settings(over);
  return {
    snapshot: snapshot(branches),
    settings: { ...safe, hasToken: true, hasLlmKey: true },
    branch: subject,
    now: new Date('2026-09-17T12:00:00Z'),
    github,
    act: null,
  };
};

/** Replies in order, then repeats the last one. Records what it was asked. */
function scripted(replies: string[]): { asks: string[] } {
  const state = { asks: [] as string[] };
  let i = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    state.asks.push(String(init?.body ?? ''));
    const content = replies[Math.min(i++, replies.length - 1)] ?? '';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return state;
}

const FINAL = '{"verdict":"on-track","because":"it matches","evidence":[]}';

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test('a reply with no tool call is the answer, handed back untouched', async () => {
  const asks = scripted([FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches], ctx: ctx([branch('a')], branch('a')),
    sessionId: 's',
  });

  assert.equal(result.text, FINAL, 'the station parses its own answer, unchanged');
  assert.equal(result.uses.length, 0);
  assert.equal(asks.asks.length, 1, 'no tools, no extra calls');
});

test('a tool call is run and its result comes back in the next prompt', async () => {
  const asks = scripted(['{"tool":"sibling_branches","args":{"limit":2}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr',
    tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b'), branch('c')], branch('a')),
    sessionId: 's',
  });

  assert.equal(result.uses.length, 1);
  assert.equal(result.uses[0]!.name, 'sibling_branches');
  assert.equal(result.uses[0]!.failed, false);
  assert.match(asks.asks[1]!, /you asked for sibling_branches/);
  assert.match(asks.asks[1]!, /o\/r b/, 'the result is in the second prompt');
  assert.equal(result.text, FINAL);
});

test('with no tools it is exactly one plain call', async () => {
  const asks = scripted([FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });
  assert.equal(asks.asks.length, 1);
  assert.equal(result.uses.length, 0);
  assert.doesNotMatch(asks.asks[0]!, /BEFORE ANSWERING/, 'no tool preamble when there are none');
});

test('a model that only ever asks for tools still terminates, at the budget', async () => {
  // The worst case, and the one that has to be impossible: it never answers.
  const asks = scripted(['{"tool":"sibling_branches","args":{}}']);
  await assert.rejects(
    () => converse.converse(settings({ toolCallsPerJob: 3 }), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
    }),
    /never answered/,
  );

  assert.equal(asks.asks.length, 4, 'three lookups, then one last turn to answer in');
  assert.match(asks.asks[3]!, /no lookups left/, 'and it was told so');
});

test('the same call twice is answered from what we already have', async () => {
  const asks = scripted([
    '{"tool":"sibling_branches","args":{"limit":2}}',
    '{"tool":"sibling_branches","args":{"limit":2}}',
    FINAL,
  ]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses.length, 2, 'it still costs budget, so a loop terminates');
  assert.match(result.uses[1]!.result, /already asked/);
  assert.equal(asks.asks.length, 3);
});

test('a tool that does not exist is a correction, not a crash', async () => {
  const asks = scripted(['{"tool":"rm_rf","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses[0]!.failed, true);
  assert.match(result.uses[0]!.result, /no tool called "rm_rf"/);
  assert.match(asks.asks[1]!, /sibling_branches/, 'and it is told what does exist');
  assert.equal(result.text, FINAL);
});

test('a tool that throws is reported to the model rather than failing the job', async () => {
  const angry = {
    name: 'angry', description: 'always fails', cost: 'free' as const, args: [],
    run: () => { throw new toolTypes.ToolError('that branch does not exist'); },
  };
  scripted(['{"tool":"angry","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [angry], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.equal(result.uses[0]!.failed, true);
  assert.match(result.uses[0]!.result, /that branch does not exist/);
  assert.equal(result.text, FINAL);
});

test('a tool result too large to send is cut rather than blowing the prompt', async () => {
  const chatty = {
    name: 'chatty', description: 'says too much', cost: 'free' as const, args: [],
    run: () => 'x'.repeat(50_000),
  };
  scripted(['{"tool":"chatty","args":{}}', FINAL]);
  const result = await converse.converse(settings(), {
    system: 'sys', user: 'usr', tools: [chatty], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
  });

  assert.ok(result.uses[0]!.result.length < 5000, `was ${result.uses[0]!.result.length}`);
  assert.match(result.uses[0]!.result, /cut/);
});

test('the clock ends it even when the lookup budget has not', async () => {
  // Nothing sleeps here, so a deadline already in the past stands in for a slow provider.
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  const result = await converse.converse(settings({ toolCallsPerJob: 20, toolSeconds: 5 }), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });
  assert.equal(result.uses.length, 1, 'it did get one lookup');
  assert.equal(result.text, FINAL);
});

test('what the model sends is never trusted, arguments included', () => {
  const t = toolTypes;
  assert.equal(t.num({ days: '14' }, 'days', 7, 1, 90), 14, 'a number as text is still a number');
  assert.equal(t.num({ days: 100000 }, 'days', 7, 1, 90), 90, 'out of range is corrected, not used');
  assert.equal(t.num({ days: -5 }, 'days', 7, 1, 90), 1);
  assert.equal(t.num({ days: 'soon' }, 'days', 7, 1, 90), 7, 'nonsense falls back');
  assert.equal(t.num({}, 'days', 7, 1, 90), 7);
  assert.equal(t.str({ repo: ' o/r ' }, 'repo'), 'o/r');
  assert.throws(() => t.str({}, 'repo'), /required/);
});

test('readToolCall tells a call from an answer, and survives rubbish', () => {
  assert.deepEqual(converse.readToolCall('{"tool":"x","args":{"a":1}}'), { name: 'x', args: { a: 1 } });
  assert.deepEqual(converse.readToolCall('{"tool":"x"}'), { name: 'x', args: {} });
  assert.equal(converse.readToolCall(FINAL), null, 'a station answer is not a tool call');
  assert.equal(converse.readToolCall('I cannot help'), null);
  assert.equal(converse.readToolCall('{"tool":"","args":{}}'), null);
  assert.equal(converse.readToolCall('{"tool":123}'), null);
  // Arguments sent as an array are not arguments.
  assert.deepEqual(converse.readToolCall('{"tool":"x","args":[1,2]}'), { name: 'x', args: {} });
});

// ---------------------------------------------------------------------------
// The tools themselves
// ---------------------------------------------------------------------------

test('sibling_branches puts the same goal first, then the same repo', () => {
  const mine = branch('mine', { goalId: 'g1' });
  const sibling = branch('sibling', { goalId: 'g1', lastActivity: '2026-09-01T00:00:00Z' });
  const sameRepo = branch('same-repo', { lastActivity: '2026-09-16T00:00:00Z' });
  const elsewhere = branch('elsewhere', { repoKey: 'o/other', lastActivity: '2026-09-17T00:00:00Z' });

  const out = free.siblingBranches.run({}, ctx([mine, sibling, sameRepo, elsewhere], mine)) as string;
  const lines = out.split('\n').filter((l) => l.startsWith('- '));

  assert.match(lines[0]!, /sibling/, 'the same goal beats being more recent');
  assert.match(lines[1]!, /same-repo/);
  assert.match(lines[2]!, /elsewhere/);
  assert.doesNotMatch(out, /o\/r mine/, 'a branch is not its own sibling');
});

test('sibling_branches says so plainly when there is nothing to compare against', () => {
  const only = branch('only');
  assert.match(free.siblingBranches.run({}, ctx([only], only)) as string, /no other branches/);
});

test('what_changed reads the history this program has been keeping', () => {
  mkdirSync(join(TEMP, 'history'), { recursive: true });
  writeFileSync(
    join(TEMP, 'history', '2026-09.jsonl'),
    [
      { date: '2026-09-14', repo: 'o/r', branch: 'a', sha: 'one', commits: 2, ahead: 2, behind: 0, ci: 'passing', pr: 'none' },
      { date: '2026-09-17', repo: 'o/r', branch: 'a', sha: 'two', commits: 9, ahead: 9, behind: 0, ci: 'failing', pr: 'open' },
      { date: '2026-09-14', repo: 'o/r', branch: 'still', sha: 'x', commits: 1, ahead: 1, behind: 0, ci: 'none', pr: 'none' },
      { date: '2026-09-17', repo: 'o/r', branch: 'still', sha: 'x', commits: 1, ahead: 1, behind: 0, ci: 'none', pr: 'none' },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const out = free.whatChanged.run({ days: 7 }, ctx([branch('a')], branch('a'))) as string;
  assert.match(out, /THIS BRANCH.*\+7 commits/s);
  assert.match(out, /CI passing → failing/);
  assert.match(out, /PR none → open/);
  assert.match(out, /1 branches did not move at all/);
});

test('what_changed says the record is empty rather than saying nothing changed', () => {
  // A fresh install knows nothing, and that is a fact about the tool, not about the fleet.
  const out = free.whatChanged.run({ days: 7 }, ctx([branch('a')], branch('a'))) as string;
  assert.match(out, /Nothing was recorded/);
  assert.doesNotMatch(out, /did not move/);
});

// ---------------------------------------------------------------------------
// D74 — the tool set is part of the cache key
// ---------------------------------------------------------------------------

test('changing a station\'s tools changes its prompt version', async () => {
  const { assessVersion } = await import('../server/advise/vision.ts');

  const withTools = assessVersion(settings({ toolsEnabled: true }));
  const without = assessVersion(settings({ toolsEnabled: false }));

  assert.notEqual(withTools, without, 'answers drawn from different evidence are not the same answer');
  assert.equal(without, 'v2', 'no tools means the version it always had — nothing needless is regenerated');
  assert.equal(assessVersion(settings({ toolCallsPerJob: 0 })), 'v2', 'no lookups allowed is no tools');
  assert.equal(withTools, assessVersion(settings({ toolsEnabled: true })), 'and it is stable');
});

test('a station with no tools has an empty tag, and one with tools does not', () => {
  assert.equal(catalog.toolSetTag([]), '');
  assert.match(catalog.toolSetTag([free.siblingBranches]), /^\+t[0-9a-f]{4}$/);
  assert.notEqual(
    catalog.toolSetTag([free.siblingBranches]),
    catalog.toolSetTag([free.siblingBranches, free.whatChanged]),
  );
  assert.equal(
    catalog.toolSetTag([free.siblingBranches, free.whatChanged]),
    catalog.toolSetTag([free.whatChanged, free.siblingBranches]),
    'the order they are listed in is not a change',
  );
});

test('a tool is never handed a secret', async () => {
  // Its output goes straight into a prompt that goes straight to a provider, so the type
  // itself refuses: ToolContext carries SafeSettings, which has neither credential.
  const seen = ctx([branch('a')], branch('a'));
  assert.equal('token' in seen.settings, false);
  assert.equal('llmApiKey' in seen.settings, false);

  // Two files are the boundary itself and are allowed to know about the token: the one
  // that builds a context, and the one that binds a reader to it. No tool may.
  const boundary = new Set(['context.ts', 'evidence.ts', 'types.ts']);
  const fs = await import('node:fs');
  const dir = new URL('../server/tools/', import.meta.url);
  for (const file of fs.readdirSync(dir)) {
    if (boundary.has(file)) continue;
    const src = fs.readFileSync(new URL(file, dir), 'utf8');
    // Code, not prose: a file may explain why it has no credential.
    assert.doesNotMatch(src, /settings\s*\.\s*token|llmApiKey/, `${file} must not reach for a credential`);
    assert.doesNotMatch(src, /\bfetch\(/, `${file} must go through the reader, not make its own calls`);
    assert.doesNotMatch(src, /writeFileSync|appendFileSync|execSync|spawn/, `${file} must not write anything`);
  }
});

test('a model that never answers fails the job rather than writing a junk verdict', async () => {
  // It used to hand the last tool call back as the answer. The station parsed it into a
  // verdict of "unclear" with no reason, and cached it — an accounting limit dressed up
  // as a judgement.
  scripted(['{"tool":"sibling_branches","args":{}}']);
  await assert.rejects(
    () => converse.converse(settings({ toolCallsPerJob: 2 }), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
    }),
    /never answered/,
  );
});

test('running out of budget mid-conversation is not a verdict either', async () => {
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  await assert.rejects(
    () => converse.converse(settings(), {
      system: 'sys', user: 'usr', tools: [free.siblingBranches],
      ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
      spend: () => false,
    }),
    (err: Error) => err.name === 'BudgetError',
  );
});

test('it says so when it was pushed to answer, and the answer still counts', async () => {
  scripted(['{"tool":"sibling_branches","args":{}}', FINAL]);
  const result = await converse.converse(settings({ toolCallsPerJob: 1 }), {
    system: 'sys', user: 'usr', tools: [free.siblingBranches],
    ctx: ctx([branch('a'), branch('b')], branch('a')), sessionId: 's',
  });
  assert.equal(result.text, FINAL);
  assert.equal(result.hitBudget, true);
  assert.equal(result.uses.length, 1);
});

// ---------------------------------------------------------------------------
// The two that cost a GitHub call — and cost it once, ever
// ---------------------------------------------------------------------------

test('repo_readme reads what the repo says it is', async () => {
  const gh = reader();
  const subject = branch('a');
  const out = (await ghTools.repoReadme.run({}, ctx([subject], subject, {}, gh))) as string;

  assert.match(out, /It does the thing/);
  assert.deepEqual(gh.asks, ['readme:o/r']);
});

test('a repo with no README says so rather than returning nothing', async () => {
  const gh = reader({ readme: async () => null });
  const subject = branch('a');
  const out = (await ghTools.repoReadme.run({}, ctx([subject], subject, {}, gh))) as string;
  assert.match(out, /no README/);
});

test('a job with no branch, or no GitHub, gets a reason rather than a crash', async () => {
  const subject = branch('a');
  await assert.rejects(
    () => Promise.resolve(ghTools.repoReadme.run({}, ctx([subject], null, {}, reader()))),
    /not about one branch/,
  );
  await assert.rejects(
    () => Promise.resolve(ghTools.repoReadme.run({}, ctx([subject], subject, {}, null))),
    /cannot reach GitHub/,
  );
});

test('commit_files refuses a SHA that is not on this branch', async () => {
  // The same guard the summary evidence has (D40). An invented SHA must not become a
  // GitHub call: it would either 404, or succeed against some unrelated commit in the repo
  // and be reported as this branch's work.
  const gh = reader();
  const subject = branch('a');
  await assert.rejects(
    () => Promise.resolve(ghTools.commitFiles.run({ sha: 'deadbee' }, ctx([subject], subject, {}, gh))),
    /is not a commit on this branch/,
  );
  assert.deepEqual(gh.asks, [], 'and it never reached GitHub to find that out');
});

test('commit_files accepts the short SHA the model was shown', async () => {
  const gh = reader();
  const subject = branch('a'); // its one commit is abc1234def
  const out = (await ghTools.commitFiles.run({ sha: 'abc1234' }, ctx([subject], subject, {}, gh))) as string;

  assert.match(out, /src\/a\.ts/);
  assert.match(out, /\+4\/-1/);
  assert.deepEqual(gh.asks, ['files:o/r@abc1234def'], 'resolved to the full SHA before asking');
});

test('a huge commit is cut, and says GitHub may have cut it first', async () => {
  const many = Array.from({ length: 320 }, (_, i) => ({
    path: `src/f${i}.ts`, status: 'modified', added: 1, removed: 0,
  }));
  const gh = reader({ commitFiles: async (_r, sha) => ({ sha, files: many, truncated: true }) });
  const subject = branch('a');
  const out = (await ghTools.commitFiles.run({ sha: 'abc1234' }, ctx([subject], subject, {}, gh))) as string;

  assert.ok(out.split('\n').length < 50, 'not three hundred lines into the prompt');
  assert.match(out, /and 280 more/);
  assert.match(out, /caps this list at 300/);
});

test('the evidence store asks GitHub once and never again', async () => {
  // "One call ever" is the whole economic argument for these two. A commit's file list
  // cannot change, and a README changes rarely enough that a re-read is not worth a call
  // on every branch of every repo on every read.
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(new URL(String(url)).pathname);
    const body = String(url).includes('/readme')
      ? { content: Buffer.from('# Bearing\n\nA dashboard.').toString('base64'), encoding: 'base64' }
      : { sha: 'abc1234def', files: [{ filename: 'a.ts', status: 'modified', additions: 2, deletions: 0 }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const gh = evidence.readerFor('gh-token');
  assert.match((await gh.readme('o/r'))!, /A dashboard/);
  assert.match((await gh.readme('o/r'))!, /A dashboard/);
  assert.equal((await gh.commitFiles('o/r', 'abc1234def'))!.files.length, 1);
  assert.equal((await gh.commitFiles('o/r', 'abc1234def'))!.files.length, 1);

  assert.equal(calls.length, 2, `asked GitHub ${calls.length} times for two facts`);
});

test('a repo with no README falls back to the file that actually describes it', async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path.endsWith('/readme')) return new Response('{}', { status: 404 });
    return new Response(
      JSON.stringify({ content: Buffer.from('# Working in this repo').toString('base64'), encoding: 'base64' }),
      { status: 200 },
    );
  }) as typeof fetch;

  evidence.resetEvidenceCache();
  const text = await evidence.readerFor('gh-token').readme('o/r2');
  assert.match(text!, /Working in this repo/);
  assert.ok(paths.some((p) => p.endsWith('CLAUDE.md')), paths.join(' '));
});

test('having asked and found nothing is itself remembered', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  evidence.resetEvidenceCache();
  const gh = evidence.readerFor('gh-token');
  assert.equal(await gh.readme('o/empty'), null);
  const afterFirst = calls;
  assert.equal(await gh.readme('o/empty'), null);
  assert.equal(calls, afterFirst, 'a repo with nothing to read is not asked twice');
});

// ---------------------------------------------------------------------------
// D74 again, now that three stations have tools
// ---------------------------------------------------------------------------

test('every station with tools carries them in its version', async () => {
  const { assessVersion, draftVersion } = await import('../server/advise/vision.ts');
  const { summariseVersion } = await import('../server/advise/enrich.ts');

  for (const version of [summariseVersion, assessVersion, draftVersion]) {
    const on = version(settings({ toolsEnabled: true }));
    const off = version(settings({ toolsEnabled: false }));
    assert.notEqual(on, off);
    assert.doesNotMatch(off, /\+t/, 'no tools means no tool tag on the key');
  }

  // The summary prompt carries the owner's word budget, so the budget is in its key too:
  // shorten the line and the summaries are rewritten to fit it (D91).
  assert.notEqual(
    summariseVersion(settings({ nowLineWords: 12 })),
    summariseVersion(settings({ nowLineWords: 8 })),
    'a different budget is a different prompt',
  );

  // And the three do not collide: they have different tools, so different tags.
  const withTools = settings({ toolsEnabled: true });
  const tags = new Set([
    summariseVersion(withTools),
    assessVersion(withTools),
    draftVersion(withTools),
  ]);
  assert.equal(tags.size, 3, 'different evidence, different key');
});

test('two workers wanting the same README make one call, not two', async () => {
  // They miss the cache in the same millisecond, because it only closes after the first
  // write. Measured on a two-branch fleet this doubled every GitHub call.
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(
      JSON.stringify({ content: Buffer.from('# Same repo').toString('base64'), encoding: 'base64' }),
      { status: 200 },
    );
  }) as typeof fetch;

  evidence.resetEvidenceCache();
  const gh = evidence.readerFor('gh-token');
  const [one, two] = await Promise.all([gh.readme('o/same'), gh.readme('o/same')]);

  assert.equal(calls, 1);
  assert.equal(one, two);
});

test('a SHA prefix too short to be unique is refused', async () => {
  const gh = reader();
  const subject = branch('a');
  await assert.rejects(
    () => Promise.resolve(ghTools.commitFiles.run({ sha: 'abc' }, ctx([subject], subject, {}, gh))),
    /is not a commit on this branch/,
  );
  assert.deepEqual(gh.asks, []);
});

test('a GitHub outage fails the job instead of becoming evidence', async () => {
  // Fed back as a tool result, every job in the read would discover the outage separately,
  // at full price, and answer without the evidence it asked for — looking just as sure.
  const angry = {
    name: 'angry', description: 'reaches GitHub', cost: 'github' as const, args: [],
    run: () => { throw new Error('GitHub rate limit reached — resets at 14:02'); },
  };
  scripted(['{"tool":"angry","args":{}}', FINAL]);

  await assert.rejects(
    () => converse.converse(settings(), {
      system: 'sys', user: 'usr', tools: [angry], ctx: ctx([branch('a')], branch('a')), sessionId: 's',
    }),
    /rate limit/,
  );
});
