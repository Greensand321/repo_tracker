import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activeDaysInWeek, esc, heatCells, relativeTime, repoColor } from '../web/format.ts';

const NOW = new Date('2026-09-16T12:00:00Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test('relative time reads the way you would say it', () => {
  assert.equal(relativeTime(new Date(NOW.getTime() - 30_000).toISOString(), NOW), 'just now');
  assert.equal(relativeTime(new Date(NOW.getTime() - 20 * 60_000).toISOString(), NOW), '20m ago');
  assert.equal(relativeTime(new Date(NOW.getTime() - 5 * 3_600_000).toISOString(), NOW), '5h ago');
  assert.equal(relativeTime(daysAgo(1), NOW), 'yesterday');
  assert.equal(relativeTime(daysAgo(9), NOW), '9d ago');
  assert.equal(relativeTime(daysAgo(70), NOW), '2mo ago');
  assert.equal(relativeTime(daysAgo(800), NOW), '2y ago');
});

test('a future timestamp reads as "just now" rather than "in 3 minutes"', () => {
  // Clock skew between a CI runner and this machine is ordinary; nonsense output is not.
  assert.equal(relativeTime(new Date(NOW.getTime() + 180_000).toISOString(), NOW), 'just now');
});

test('a missing or broken date never renders as NaN', () => {
  assert.equal(relativeTime(null, NOW), 'never');
  assert.equal(relativeTime('nonsense', NOW), 'unknown');
});

test('commit messages are escaped — they are text other people wrote', () => {
  assert.equal(
    esc(`<img src=x onerror="alert('x')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
  );
});

test('a repo keeps the same colour across runs and machines', () => {
  const keys = ['a/one', 'b/two', 'c/three'];
  assert.equal(repoColor('b/two', keys), repoColor('b/two', keys));
  assert.notEqual(repoColor('a/one', keys), repoColor('b/two', keys));
  // A repo missing from the list still gets a stable colour rather than throwing.
  assert.ok(repoColor('z/unknown', keys).startsWith('#'));
});

test('the heat strip is seven cells, oldest first, marking days with commits', () => {
  const cells = heatCells(['2026-09-16', '2026-09-14'], NOW);
  assert.equal(cells.length, 7);
  assert.equal(cells[6], true, 'today');
  assert.equal(cells[4], true, 'two days ago');
  assert.equal(cells[5], false);
});

test('active days counts only the last week', () => {
  const dates = ['2026-09-16', '2026-09-12', '2026-09-01'];
  assert.equal(activeDaysInWeek(dates, NOW), 2);
});
