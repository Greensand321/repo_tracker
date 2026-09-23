/** Load and save settings. I/O only — the token never leaves this machine. */

import { TUNABLES, type TunableKey } from '../shared/settings.ts';
import { DEFAULT_SETTINGS, type SafeSettings, type Settings } from '../shared/types.ts';
import { readJson, writeJson } from './jsonfile.ts';
import { SETTINGS_FILE, ensureDirs } from './paths.ts';

export function loadSettings(): Settings {
  // No settings yet is the normal first run, not an error. A file that cannot be read is
  // set aside rather than overwritten — it holds the token.
  const raw = readJson<Partial<Settings>>(SETTINGS_FILE);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return sanitise({ ...DEFAULT_SETTINGS, ...raw });
}

export function saveSettings(patch: Partial<Settings>): Settings {
  ensureDirs();
  const next = sanitise({ ...loadSettings(), ...patch });
  writeJson(SETTINGS_FILE, next);
  return next;
}

/** Everything the browser is allowed to know. No secret ever crosses this line. */
export function toSafe(settings: Settings): SafeSettings {
  const { token, llmApiKey, ...rest } = settings;
  return { ...rest, hasToken: token.length > 0, hasLlmKey: llmApiKey.length > 0 };
}

function sanitise(settings: Settings): Settings {
  const out: Settings = {
    ...DEFAULT_SETTINGS,
    token: settings.token.trim(),
    repos: [...new Set(settings.repos.map((r) => r.trim()).filter(Boolean))],
    llmApiKey: settings.llmApiKey.trim(),
    llmBaseUrl: (settings.llmBaseUrl || DEFAULT_SETTINGS.llmBaseUrl).trim().replace(/\/+$/, ''),
    llmModel: settings.llmModel.trim(),
  };
  // Every tunable from the one table, so the range the agent reads and the owner's reset
  // fills is the range enforced here. Switches default on: only an explicit false is off.
  const tuned = out as Record<TunableKey, number | boolean>;
  for (const t of TUNABLES) {
    tuned[t.key] = t.type === 'boolean'
      ? settings[t.key] !== false
      : clamp(settings[t.key], t.min, t.max, DEFAULT_SETTINGS[t.key] as number);
  }
  return out;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
