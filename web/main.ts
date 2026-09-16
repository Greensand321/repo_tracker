/**
 * The page. Fetches one Snapshot from the local program, renders it, and re-renders
 * when the server says something moved.
 *
 * It computes nothing the Snapshot does not already contain (CLAUDE.md rule 4), and it
 * never sees the GitHub token — that stays in the program behind this page.
 */

import type { Branch, SafeSettings, SnapshotResponse } from '../shared/types.ts';
import { esc, relativeTime } from './format.ts';
import { createPicker, type Picker } from './components/picker.ts';
import { branchKey, needsAttention, renderBoard } from './views/board.ts';
import { renderLegend, renderTimeline } from './views/timeline.ts';

type View = 'board' | 'needs' | 'timeline' | 'notes';

const state = {
  data: null as SnapshotResponse | null,
  view: 'board' as View,
  repo: 'all',
  search: '',
  open: null as string | null,
};

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

/**
 * Show failures instead of dying quietly.
 *
 * An uncaught error here used to leave a page that looked completely normal and did
 * nothing at all — no banner, no console unless you went looking, no clue which of the
 * dozen buttons was supposed to respond. Anything that breaks should say so on screen.
 */
function showFailure(what: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(what, err);

  let banner = document.querySelector<HTMLElement>('#failBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'failBanner';
    banner.className = 'fail-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<b>${esc(what)}</b> ${esc(message)}
    <span class="fix">Restart Bearing — a half-updated page cannot fix itself by reloading.</span>`;
}

window.addEventListener('error', (event) => showFailure('Something broke:', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => showFailure('Something broke:', event.reason));

/** Attaches one listener, and keeps going if that particular element is missing. */
function on(selector: string, event: string, handler: (event: Event) => void): void {
  try {
    $(selector).addEventListener(event, handler);
  } catch (err) {
    // One stale selector must not cost every other button on the page.
    showFailure(`Could not wire ${selector} —`, err);
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadSnapshot(): Promise<void> {
  try {
    const res = await fetch('/api/snapshot');
    state.data = (await res.json()) as SnapshotResponse;
  } catch {
    // The program behind the page went away. Say so rather than showing stale data
    // as though it were live.
    state.data = { snapshot: null, refreshing: false, needs: null, error: 'Bearing is not running' };
  }
  render();
}

/** The server pushes; the page does not poll. Reconnects on its own if dropped. */
function listen(): void {
  const events = new EventSource('/api/events');
  events.addEventListener('snapshot', () => void loadSnapshot());
  events.addEventListener('state', () => void loadSnapshot());
  events.onerror = () => {
    events.close();
    setTimeout(listen, 3000);
  };
}

// ---------------------------------------------------------------------------
// Filtering — a view is a filter over the one Snapshot, never a second data source
// ---------------------------------------------------------------------------

function visibleBranches(): Branch[] {
  const snapshot = state.data?.snapshot;
  if (!snapshot) return [];

  const needle = state.search.trim().toLowerCase();

  return snapshot.branches.filter((branch) => {
    if (branch.isBase) return false; // a reference point, not a thread of work
    if (state.repo !== 'all' && branch.repoKey !== state.repo) return false;
    if (state.view === 'needs' && !needsAttention(branch)) return false;
    if (!needle) return true;
    return (
      branch.name.toLowerCase().includes(needle) ||
      branch.repoKey.toLowerCase().includes(needle) ||
      (branch.pr?.title ?? '').toLowerCase().includes(needle) ||
      branch.commits.some((c) => c.message.toLowerCase().includes(needle))
    );
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(): void {
  renderStatus();

  const data = state.data;
  const snapshot = data?.snapshot ?? null;

  if (data?.needs || (!snapshot && !data?.refreshing)) {
    renderFirstRun(data);
    return;
  }
  if (!snapshot) {
    $('#board').innerHTML = `<div class="empty"><b>Fetching from GitHub…</b>The first run reads every branch, so it takes a moment.</div>`;
    return;
  }

  const branches = visibleBranches();

  renderRepoTabs();
  $('#needsBadge').textContent = String(
    snapshot.branches.filter((b) => !b.isBase && needsAttention(b)).length,
  );
  $('#countsLine').textContent = countsLine();

  for (const [section, view] of [
    ['#boardSection', 'board'],
    ['#timelineSection', 'timeline'],
    ['#notesSection', 'notes'],
  ] as const) {
    const active = view === state.view || (view === 'board' && state.view === 'needs');
    $(section).classList.toggle('hidden', !active);
  }

  if (state.view === 'board' || state.view === 'needs') {
    renderBoard($('#board'), branches, snapshot, state.open);
  } else if (state.view === 'timeline') {
    renderLegend($('#legend'), snapshot);
    renderTimeline($('#strandsBig'), branches, snapshot);
  } else {
    // Honest about what does not exist yet rather than showing an empty grid.
    $('#notesGrid').innerHTML = `<div class="empty"><b>Notes arrive in Stage 3</b>
      Right now Bearing only reads. Writing your own notes against a branch comes with
      the goals and milestones layer.</div>`;
  }
}

function countsLine(): string {
  const snapshot = state.data?.snapshot;
  if (!snapshot) return '';
  const threads = snapshot.branches.filter((b) => !b.isBase);
  const active = threads.filter((b) => b.relevance === 'active').length;
  const commits = threads.reduce((sum, b) => sum + b.commits.length, 0);
  const shown = visibleBranches().length;
  const scope = shown === threads.length ? '' : ` · showing ${shown}`;
  return `${snapshot.repos.length} repos · ${threads.length} branches · ${active} active · ${commits} commits${scope}`;
}

function renderRepoTabs(): void {
  const snapshot = state.data?.snapshot;
  if (!snapshot) return;
  const counts = new Map<string, number>();
  for (const branch of snapshot.branches) {
    if (branch.isBase) continue;
    counts.set(branch.repoKey, (counts.get(branch.repoKey) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const tab = (key: string, label: string, count: number): string =>
    `<button class="ptab${state.repo === key ? ' active' : ''}" data-repo="${esc(key)}">${esc(label)}<span class="n">${count}</span></button>`;

  $('#projTabs').innerHTML = [
    tab('all', 'All', total),
    ...snapshot.repos.map((repo) => tab(repo.key, repo.name, counts.get(repo.key) ?? 0)),
  ].join('');
}

function renderStatus(): void {
  const data = state.data;
  const snapshot = data?.snapshot;

  const stateEl = $('#statusState');
  if (data?.refreshing) {
    stateEl.textContent = 'refreshing…';
    stateEl.className = 'live';
  } else if (data?.error) {
    stateEl.textContent = data.error;
    stateEl.className = 'warn';
  } else if (snapshot) {
    stateEl.textContent = `as of ${relativeTime(snapshot.generatedAt)}`;
    stateEl.className = '';
  } else {
    stateEl.textContent = 'waiting for setup';
    stateEl.className = '';
  }

  const warnEl = $('#statusWarn');
  const warnings = snapshot?.warnings ?? [];
  warnEl.textContent = warnings.length > 0 ? `⚠ ${warnings.length} repo problem(s)` : '';
  warnEl.title = warnings.join('\n');

  const rate = snapshot?.rateLimit;
  const bits: string[] = [];
  if (snapshot?.llm.enabled && snapshot.llm.pending > 0) {
    bits.push(`summarising ${snapshot.llm.pending}`);
  }
  if (snapshot?.llm.errors.length) bits.push(`advisor: ${snapshot.llm.errors.length} failed`);
  if (rate) bits.push(`GitHub ${rate.remaining}/${rate.limit}`);
  const rateEl = $('#statusRate');
  rateEl.textContent = bits.join('  ·  ');
  rateEl.title = snapshot?.llm.errors.join('\n') ?? '';
}

function renderFirstRun(data: SnapshotResponse | null): void {
  const reason =
    data?.needs === 'token'
      ? 'Bearing needs a GitHub token before it can read anything.'
      : data?.needs === 'repos'
        ? 'Add the repos you want to watch.'
        : (data?.error ?? 'Something needs setting up.');

  $('#board').innerHTML = `<div class="empty"><b>Let’s get your bearings</b>${esc(reason)}<br><br>
    <button class="btn primary" data-open-settings>Open settings</button></div>`;
  $('#countsLine').textContent = '';
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Built lazily so the picker exists before any settings load writes into it. */
let modelPicker: Picker | null = null;

function ensureModelPicker(): Picker {
  modelPicker ??= createPicker({
    mount: $('#modelPicker'),
    placeholder: 'No model chosen',
    emptyText: 'Save an API key, then load the list.',
  });
  return modelPicker;
}

/**
 * The endpoint is a choice between two known plans, not a URL to remember. Getting it
 * wrong reports "Insufficient balance", which reads like an empty wallet rather than
 * the wrong plan (D48).
 */
function applyProviderChoice(): void {
  const choice = $<HTMLSelectElement>('#llmProvider').value;
  const custom = choice === 'custom';
  $('#llmBaseUrl').classList.toggle('hidden', !custom);
  if (!custom) $<HTMLInputElement>('#llmBaseUrl').value = choice;

  $('#providerHint').innerHTML = custom
    ? 'Any endpoint speaking the OpenAI, Anthropic or Responses API.'
    : choice.includes('/go/')
      ? 'Your Go subscription. Billed separately from Zen credit — a Zen balance is not used or needed.'
      : 'Pay as you go. Needs credit on your Zen balance; a Go subscription does <b>not</b> apply here.';
}

async function openSettings(): Promise<void> {
  try {
    await openSettingsInner();
  } catch (err) {
    showFailure('Could not open settings:', err);
  }
}

async function openSettingsInner(): Promise<void> {
  const settings = (await (await fetch('/api/settings')).json()) as SafeSettings;
  $<HTMLTextAreaElement>('#repos').value = settings.repos.join('\n');
  $<HTMLInputElement>('#refreshSeconds').value = String(settings.refreshSeconds);
  $<HTMLInputElement>('#quietAfterDays').value = String(settings.quietAfterDays);
  $<HTMLInputElement>('#commitsPerBranch').value = String(settings.commitsPerBranch);
  $<HTMLInputElement>('#token').value = '';
  $<HTMLInputElement>('#token').placeholder = settings.hasToken
    ? 'a token is saved — leave blank to keep it'
    : 'github_pat_…';
  const provider = $<HTMLSelectElement>('#llmProvider');
  const known = [...provider.options].some((option) => option.value === settings.llmBaseUrl);
  provider.value = known ? settings.llmBaseUrl : 'custom';
  $<HTMLInputElement>('#llmBaseUrl').value = settings.llmBaseUrl;
  applyProviderChoice();

  const picker = ensureModelPicker();
  picker.setValue(settings.llmModel);
  if (!settings.llmModel) picker.setStatus(settings.hasLlmKey ? 'No model chosen' : 'Add a key first');
  $<HTMLInputElement>('#llmMaxPerRun').value = String(settings.llmMaxPerRun);
  $<HTMLInputElement>('#llmApiKey').value = '';
  $<HTMLInputElement>('#llmApiKey').placeholder = settings.hasLlmKey
    ? 'a key is saved — leave blank to keep it'
    : 'leave blank for no summaries';
  $('#settingsErr').textContent = '';
  $('#settingsSheet').classList.remove('hidden');
}

async function saveSettings(): Promise<void> {
  const errEl = $('#settingsErr');
  const button = $<HTMLButtonElement>('#saveSettings');
  errEl.textContent = '';
  errEl.classList.remove('ok');
  button.disabled = true;
  button.textContent = 'Checking…';

  const body: Record<string, unknown> = {
    repos: $<HTMLTextAreaElement>('#repos')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    refreshSeconds: Number($<HTMLInputElement>('#refreshSeconds').value),
    quietAfterDays: Number($<HTMLInputElement>('#quietAfterDays').value),
    commitsPerBranch: Number($<HTMLInputElement>('#commitsPerBranch').value),
  };
  const token = $<HTMLInputElement>('#token').value.trim();
  if (token) body['token'] = token;

  body['llmBaseUrl'] = $<HTMLInputElement>('#llmBaseUrl').value.trim();
  body['llmModel'] = ensureModelPicker().getValue().trim();
  body['llmMaxPerRun'] = Number($<HTMLInputElement>('#llmMaxPerRun').value);
  const llmKey = $<HTMLInputElement>('#llmApiKey').value.trim();
  if (llmKey) body['llmApiKey'] = llmKey;

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      errEl.textContent = error ?? `Could not save (${res.status})`;
      return;
    }
    $('#settingsSheet').classList.add('hidden');
    await loadSnapshot();
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
    button.textContent = 'Save and refresh';
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(): void {
  on('#viewTabs', 'click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (!tab) return;
    state.view = tab.dataset['view'] as View;
    for (const el of document.querySelectorAll('.vtab')) el.classList.toggle('active', el === tab);
    render();
  });

  on('#projTabs', 'click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-repo]');
    if (!tab) return;
    state.repo = tab.dataset['repo'] ?? 'all';
    render();
  });

  on('#board', 'click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('a')) return; // links out to GitHub are not card toggles
    if (target.closest('[data-open-settings]')) {
      void openSettings();
      return;
    }
    const card = target.closest<HTMLElement>('[data-card]');
    if (!card) return;
    const key = card.dataset['card'] ?? null;
    state.open = state.open === key ? null : key;
    render();
  });

  const search = $<HTMLInputElement>('#search');
  on('#search', 'input', () => {
    state.search = search.value;
    render();
  });

  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape') {
      $('#settingsSheet').classList.add('hidden');
      if (document.activeElement === search) search.blur();
    }
  });

  // The provider's own model list, so nobody has to guess an ID.
  on('#loadModels', 'click', async (event) => {
    event.preventDefault();
    const link = event.target as HTMLElement;
    const before = link.textContent;
    link.textContent = 'loading…';
    try {
      const res = await fetch('/api/llm/models');
      const payload = (await res.json()) as { models?: { id: string }[]; error?: string };
      if (!res.ok || !payload.models) {
        $('#settingsErr').textContent = payload.error ?? 'could not load models';
        return;
      }
      // The ID is what gets sent; the name is only shown. Conflating the two is how a
      // display name once ended up being sent as a model.
      ensureModelPicker().setOptions(
        (payload.models as { id: string; name?: string }[]).map((model) => ({
          value: model.id,
          ...(model.name ? { label: model.name } : {}),
        })),
      );
      link.textContent = `${payload.models.length} models loaded`;
      return;
    } catch (err) {
      $('#settingsErr').textContent = err instanceof Error ? err.message : String(err);
    }
    link.textContent = before;
  });

  on('#llmProvider', 'change', () => {
    applyProviderChoice();
    // The model list belongs to the old endpoint; keeping it would offer models the new
    // plan may not serve.
    ensureModelPicker().setOptions([]);
    ensureModelPicker().setStatus('Load the list for this provider');
    $('#loadModels').textContent = 'Load the list';
  });

  on('#openSettings', 'click', () => void openSettings());
  on('#closeSettings', 'click', () => $('#settingsSheet').classList.add('hidden'));
  on('#saveSettings', 'click', () => void saveSettings());
  on('#refreshNow', 'click', async () => {
    await fetch('/api/refresh', { method: 'POST' });
    await loadSnapshot();
  });
}

wire();
void loadSnapshot();
listen();

// Ages are relative, so the page has to re-render occasionally even when nothing moved.
setInterval(() => {
  if (state.data?.snapshot) render();
}, 60_000);

// The mockup's card key helper is exported for the tests; referenced here so the
// bundler keeps it honest.
export { branchKey };
