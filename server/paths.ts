/** Where the tool keeps its own data. Everything here is gitignored and machine-local. */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Where the tool's own data lives. Overridable so a second machine can point at a
 * different location — and so tests never write into the real one.
 */
export const DATA_DIR = process.env['BEARING_DATA_DIR'] ?? join(ROOT, 'data');
export const CACHE_DIR = join(DATA_DIR, 'cache');
export const HISTORY_DIR = join(DATA_DIR, 'history');
export const WEB_DIR = join(ROOT, 'web');
export const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, CACHE_DIR, HISTORY_DIR]) mkdirSync(dir, { recursive: true });
}

/** owner/repo becomes a filename that is safe on Windows as well as POSIX. */
export const repoFileName = (key: string): string => `${key.replace(/[/\\]/g, '__')}.json`;
