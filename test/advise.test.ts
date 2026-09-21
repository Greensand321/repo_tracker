import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InsightParseError,
  buildUserPrompt,
  extractJson,
  parseInsight,
  validEvidence,
} from '../server/advise/prompt.ts';
import type { Branch } from '../shared/types.ts';

const NOW = new Date('2026-09-16T12:00:00Z');

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    repoKey: 'greensand321/harbor-api',
    name: 'claude/stripe-webhook-idempotency',
    headSha: 'aaaaaaa1111',
    url: 'https://github.com/x/y/tree/b',
    commits: [
      {
        sha: 'abc1234def',
        message: 'Write the failing idempotency test',
        body: 'Replays the same event twice.',
        author: 'claude',
        authoredAt: '2026-09-15T14:32:00Z',
        url: 'u1',
      },
      {
        sha: 'def5678abc',
        message: 'Signature verification landed',
        body: '',
        author: 'claude',
        authoredAt: '2026-09-14T14:02:00Z',
        url: 'u2',
      },
    ],
    ahead: 23,
    behind: 2,
    lastActivity: '2026-09-15T14:32:00Z',
    diff: { files: 9, additions: 412, deletions: 88 },
    activity: ['2026-09-14', '2026-09-15'],
    pr: { number: 52, title: 'Idempotent webhook handling', state: 'open', draft: false, url: 'p' },
    ci: { state: 'failing', url: 'c' },
    relevance: 'active',
    isBase: false,
    goalId: null,
    vision: null,
    assessment: null,
    title: null,
    summary: null,
    progress: null,
    insight: null, recap: null, commitsFrom: 'ahead',
    ...overrides,
  };
}

const reply = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    title: 'Stopping duplicate webhook charges',
    summary: 'Signature verification landed and a failing idempotency test is in place.',
    progress: 'blocked',
    evidence: ['abc1234'],
    ...over,
  });

// --- the prompt carries the facts the model is allowed to use ---

test('the prompt contains the commit messages, PR and CI state', () => {
  const prompt = buildUserPrompt(branch(), NOW);
  assert.match(prompt, /Write the failing idempotency test/);
  assert.match(prompt, /Signature verification landed/);
  assert.match(prompt, /Idempotent webhook handling/);
  assert.match(prompt, /CI: failing/);
  assert.match(prompt, /Ahead of base: 23 commits\. Behind base: 2\./);
});

test('the prompt uses relative ages, not raw timestamps', () => {
  const prompt = buildUserPrompt(branch(), NOW);
  assert.match(prompt, /yesterday|days ago|today/);
  assert.doesNotMatch(prompt, /2026-09-15T14:32/);
});

test('a branch with nothing of its own says so rather than sending an empty list', () => {
  const prompt = buildUserPrompt(branch({ commits: [] }), NOW);
  assert.match(prompt, /nothing of its own/);
});

// --- reading the reply: lenient about wrapping, strict about content ---

test('a clean JSON reply parses', () => {
  const insight = parseInsight(reply(), branch());
  assert.equal(insight.title, 'Stopping duplicate webhook charges');
  assert.equal(insight.progress, 'blocked');
  assert.deepEqual(insight.evidence, ['abc1234']);
});

test('a reply wrapped in a markdown fence still parses', () => {
  // Models do this constantly; rejecting it would waste a real API call every time.
  const insight = parseInsight('```json\n' + reply() + '\n```', branch());
  assert.equal(insight.progress, 'blocked');
});

test('a reply with chatter around the JSON still parses', () => {
  const insight = parseInsight(`Sure! Here you go:\n${reply()}\nHope that helps.`, branch());
  assert.equal(insight.title, 'Stopping duplicate webhook charges');
});

test('an unknown progress value is rejected rather than rendered as fact', () => {
  assert.throws(
    () => parseInsight(reply({ progress: 'vibing' }), branch()),
    (err: InsightParseError) => {
      assert.equal(err.name, 'InsightParseError');
      assert.match(err.message, /progress/);
      return true;
    },
  );
});

test('a reply missing a title or summary is rejected', () => {
  assert.throws(() => parseInsight(reply({ title: '' }), branch()), InsightParseError);
  assert.throws(() => parseInsight(reply({ summary: '   ' }), branch()), InsightParseError);
});

test('a reply that is not JSON at all is rejected with the raw text kept', () => {
  assert.throws(
    () => parseInsight('I am afraid I cannot help with that.', branch()),
    (err: InsightParseError) => {
      assert.equal(err.raw, 'I am afraid I cannot help with that.');
      return true;
    },
  );
});

test('truncated JSON is rejected, not half-read', () => {
  assert.throws(() => parseInsight('{"title": "half a th', branch()), InsightParseError);
});

// --- hallucination guard ---

test('invented commit SHAs are dropped, real ones kept', () => {
  const insight = parseInsight(
    reply({ evidence: ['abc1234', 'deadbee', 'def5678'] }),
    branch(),
  );
  assert.deepEqual(insight.evidence, ['abc1234', 'def5678'], 'deadbee is not on this branch');
});

test('evidence survives a full-length SHA or stray whitespace', () => {
  assert.deepEqual(validEvidence(['  abc1234def  '], branch()), ['abc1234']);
});

test('evidence that is not an array of strings degrades to empty', () => {
  assert.deepEqual(validEvidence('abc1234', branch()), []);
  assert.deepEqual(validEvidence([42, null, {}], branch()), []);
  assert.deepEqual(validEvidence(undefined, branch()), []);
});

test('evidence is capped and de-duplicated', () => {
  const many = ['abc1234', 'abc1234', 'def5678', 'abc1234'];
  assert.deepEqual(validEvidence(many, branch()), ['abc1234', 'def5678']);
});

// --- tidying ---

test('a title keeps its length in check and loses a trailing period', () => {
  const insight = parseInsight(reply({ title: 'A tidy title.' }), branch());
  assert.equal(insight.title, 'A tidy title');

  const long = parseInsight(reply({ title: 'x'.repeat(200) }), branch());
  assert.ok(long.title.length <= 80, `title was ${long.title.length} chars`);
});

test('newlines in the summary are collapsed so a card cannot be broken by one', () => {
  const insight = parseInsight(reply({ summary: 'Line one.\n\nLine two.' }), branch());
  assert.equal(insight.summary, 'Line one. Line two.');
});

test('extractJson finds the outermost object', () => {
  assert.equal(extractJson('junk {"a": {"b": 1}} junk'), '{"a": {"b": 1}}');
  assert.equal(extractJson('no braces here'), null);
  assert.equal(extractJson('} backwards {'), null);
});

// --- v2: the recap — last / done / open -------------------------------------

test('the recap carries what it did last, what landed, and what is open', () => {
  const insight = parseInsight(
    JSON.stringify({
      title: 'Stopping duplicate webhook charges',
      last: 'Wiring the dedupe table into the handler.',
      done: 'Signature verification is merged and green.',
      open: 'The idempotency test exists with no implementation behind it yet.',
      progress: 'progressing',
      evidence: ['abc1234'],
    }),
    branch(),
  );
  assert.equal(insight.recap.last, 'Wiring the dedupe table into the handler.');
  assert.equal(insight.recap.done, 'Signature verification is merged and green.');
  assert.match(insight.recap.open, /no implementation/);
  assert.equal(insight.summary, `${insight.recap.last} ${insight.recap.open}`, 'the gist is last plus what is open');
});

test('when nothing is open the gist is just what it did last', () => {
  const insight = parseInsight(
    JSON.stringify({ title: 'T', last: 'Shipped it.', done: 'All of it.', open: 'Nothing looks unfinished.', progress: 'done', evidence: [] }),
    branch(),
  );
  assert.equal(insight.summary, 'Shipped it.');
  assert.equal(insight.recap.open, 'Nothing looks unfinished.');
});

test('the old one-paragraph shape is still read, as the last line', () => {
  const insight = parseInsight(reply(), branch());
  assert.equal(insight.recap.last, insight.summary);
  assert.equal(insight.recap.done, '');
});

test('a merged branch is told its commits are its own, so 0 ahead is not a contradiction', () => {
  const prompt = buildUserPrompt(branch({ commitsFrom: 'pull', ahead: 0 }), NOW);
  assert.match(prompt, /recorded on its pull request/);
  assert.doesNotMatch(buildUserPrompt(branch(), NOW), /recorded on its pull request/);
});
