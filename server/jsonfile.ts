/**
 * Every file this program keeps goes through here.
 *
 * Two rules, both learned from data that went missing between sessions:
 *
 *   **A write is atomic.** The file is written beside itself and renamed into place, so a
 *   program closed mid-write leaves the old file whole rather than a truncated one. Closing
 *   the program is the normal way it ends, and a worker writes a summary whenever it
 *   finishes one — so a half-written store was not a corner case, it was a matter of time.
 *
 *   **A file that cannot be read is moved aside, never overwritten.** Treating a broken
 *   file as empty meant the next write replaced a hundred summaries with one. Now it is
 *   renamed with a `.broken-<time>` suffix and named on the console; the data is still
 *   there to repair by hand, and the program carries on with an empty store.
 *
 * Missing is not broken: a file that does not exist yet is the normal first run.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The parsed file, or null when there is none — or when it was unreadable and set aside. */
export function readJson<T>(file: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    setAside(file);
    return null;
  }
}

/**
 * Writes the whole value, atomically. `pretty` is for files a person may open; the repo
 * cache is written every minute and read by nobody, so it stays compact.
 */
export function writeJson(file: string, value: unknown, options: { pretty?: boolean } = {}): void {
  mkdirSync(dirname(file), { recursive: true });
  const text = options.pretty === false ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  try {
    renameSync(temp, file);
  } catch {
    // Windows refuses to replace a file another program holds open — an editor with the
    // JSON on screen, say. Losing the write would be worse than losing atomicity for it.
    writeFileSync(file, text, 'utf8');
    try {
      unlinkSync(temp);
    } catch {
      // A stray .tmp beside the file is untidy, not harmful.
    }
  }
}

function setAside(file: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${file}.broken-${stamp}`;
  try {
    renameSync(file, aside);
    console.error(`${file} could not be read and was moved to ${aside} — nothing in it was deleted`);
  } catch {
    console.error(`${file} could not be read`);
  }
}
