/** Load and save settings. I/O only — the token never leaves this machine. */

import { readFileSync, writeFileSync } from 'node:fs';

import { DEFAULT_SETTINGS, type SafeSettings, type Settings } from '../shared/types.ts';
import { SETTINGS_FILE, ensureDirs } from './paths.ts';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Partial<Settings>;
    return sanitise({ ...DEFAULT_SETTINGS, ...raw });
  } catch {
    // No settings yet is the normal first run, not an error.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  ensureDirs();
  const next = sanitise({ ...loadSettings(), ...patch });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Everything the browser is allowed to know. No secret ever crosses this line. */
export function toSafe(settings: Settings): SafeSettings {
  const { token, llmApiKey, ...rest } = settings;
  return { ...rest, hasToken: token.length > 0, hasLlmKey: llmApiKey.length > 0 };
}

function sanitise(settings: Settings): Settings {
  return {
    token: settings.token.trim(),
    repos: [...new Set(settings.repos.map((r) => r.trim()).filter(Boolean))],
    refreshSeconds: clamp(settings.refreshSeconds, 0, 3600, DEFAULT_SETTINGS.refreshSeconds),
    quietAfterDays: clamp(settings.quietAfterDays, 1, 365, DEFAULT_SETTINGS.quietAfterDays),
    commitsPerBranch: clamp(settings.commitsPerBranch, 1, 300, DEFAULT_SETTINGS.commitsPerBranch),
    llmApiKey: settings.llmApiKey.trim(),
    llmBaseUrl: (settings.llmBaseUrl || DEFAULT_SETTINGS.llmBaseUrl).trim().replace(/\/+$/, ''),
    llmModel: settings.llmModel.trim(),
    llmEnabled: settings.llmEnabled !== false,
    llmMaxPerRun: clamp(settings.llmMaxPerRun, 0, 500, DEFAULT_SETTINGS.llmMaxPerRun),
    askBranchCap: clamp(settings.askBranchCap, 1, 400, DEFAULT_SETTINGS.askBranchCap),
    visionAutoDraft: settings.visionAutoDraft !== false,
    maxOpenQuestions: clamp(settings.maxOpenQuestions, 0, 40, DEFAULT_SETTINGS.maxOpenQuestions),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
