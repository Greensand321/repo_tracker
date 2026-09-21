/** Load and save settings. I/O only — the token never leaves this machine. */

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
    llmReplyTokens: clamp(settings.llmReplyTokens, 256, 32_000, DEFAULT_SETTINGS.llmReplyTokens),
    llmTimeoutSeconds: clamp(settings.llmTimeoutSeconds, 15, 600, DEFAULT_SETTINGS.llmTimeoutSeconds),
    askBranchCap: clamp(settings.askBranchCap, 1, 400, DEFAULT_SETTINGS.askBranchCap),
    visionAutoDraft: settings.visionAutoDraft !== false,
    maxOpenQuestions: clamp(settings.maxOpenQuestions, 0, 40, DEFAULT_SETTINGS.maxOpenQuestions),
    // Four words is the longest lead the line can take ("Not what it was for:"), so below
    // five there is nothing left to say after it; above twenty it is a sentence again.
    nowLineWords: clamp(settings.nowLineWords, 5, 20, DEFAULT_SETTINGS.nowLineWords),
    briefEveryMinutes: clamp(settings.briefEveryMinutes, 0, 1440, DEFAULT_SETTINGS.briefEveryMinutes),
    advisorMemoryMinutes: clamp(settings.advisorMemoryMinutes, 0, 1440, DEFAULT_SETTINGS.advisorMemoryMinutes),
    toolsEnabled: settings.toolsEnabled !== false,
    // The worst case for a read is llmMaxPerRun jobs times this plus one, so it is capped
    // well below anything that could run away quietly.
    toolCallsPerJob: clamp(settings.toolCallsPerJob, 0, 20, DEFAULT_SETTINGS.toolCallsPerJob),
    toolSeconds: clamp(settings.toolSeconds, 5, 300, DEFAULT_SETTINGS.toolSeconds),
    // Capped low on purpose: more workers make a runaway bill arrive faster, not later.
    workers: clamp(settings.workers, 1, 8, DEFAULT_SETTINGS.workers),
    dispatchWorkers: clamp(settings.dispatchWorkers, 1, 8, DEFAULT_SETTINGS.dispatchWorkers),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
