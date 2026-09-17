/** Pure display helpers. No DOM, no fetch — so they can be tested directly. */

/** The mockup's palette, in its own order. Repos take colours from it deterministically. */
export const PALETTE = ['#d8a54a', '#74a8e0', '#a98bdb', '#68c293', '#e2705f', '#9db98a'];

/** Same repo, same colour, every run and on both machines. */
export function repoColor(key: string, allKeys: string[]): string {
  const index = allKeys.indexOf(key);
  if (index >= 0) return PALETTE[index % PALETTE.length]!;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

/**
 * "2 days ago" — the tidbit, not the focus. Commit messages are the headline, so this
 * stays short enough to sit in a corner.
 */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 0) return 'just now'; // clock skew beats showing "in 3 minutes"
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/**
 * How long until something in the future.
 *
 * `relativeTime` deliberately collapses the future to "just now", because a commit
 * timestamp slightly ahead of the local clock is skew rather than news. A rate-limit
 * reset is genuinely ahead of us, and "resets just now" was simply wrong.
 */
export function countdown(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((then - now.getTime()) / 1000);
  if (seconds <= 30) return 'any moment';
  if (seconds < 90) return 'in a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/**
 * How long something has been running, as m:ss. For the floor, where the question is
 * "has this one stuck?" rather than "when did it start" — so it counts up, not down.
 */
export function elapsed(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Time of day only. The date is already on the line beside it. */
export function clockTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Full timestamp for the title attribute, so the exact value is a hover away. */
export function exactTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * Everything rendered here came from a commit message someone else wrote, so it is
 * escaped without exception.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How many of the last 7 days had a commit. Drives the heat strip. */
export function activeDaysInWeek(dates: string[], now: Date = new Date()): number {
  const cutoff = now.getTime() - 7 * 86_400_000;
  return dates.filter((day) => {
    const time = new Date(`${day}T12:00:00Z`).getTime();
    return !Number.isNaN(time) && time >= cutoff;
  }).length;
}

/** Seven cells, oldest to newest, marking which of the last 7 days had commits. */
export function heatCells(dates: string[], now: Date = new Date()): boolean[] {
  const days = new Set(dates);
  const cells: boolean[] = [];
  for (let back = 6; back >= 0; back--) {
    const day = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    cells.push(days.has(day));
  }
  return cells;
}
