/**
 * The page. Fetches one Snapshot from the local program, renders it as a broadsheet, and
 * re-renders when the server says something moved.
 *
 * It computes nothing the Snapshot does not already contain (rule 4) — the groupings it
 * needs live in derive.ts, shared — and it never sees the GitHub token, which stays in
 * the program behind this page.
 */

import type { Answer } from '../server/advise/ask.ts';
import type { Goal, SafeSettings, SnapshotResponse } from '../shared/types.ts';
import { createPicker, type Picker } from './components/picker.ts';
import { tallies, threads } from './derive.ts';
import { clockTime, countdown, esc, exactTime, relativeTime } from './format.ts';
import { branchKey, parseBranchKey, renderLeaderList, renderNow, type Grouping } from './views/leader.ts';
import { renderConditions, renderNotices, renderRegister } from './views/side.ts';

type Asked = { question: string; answer: Answer | null; error: string | null; pending: boolean };

const state = {
  data: null as SnapshotResponse | null,
  grouping: 'goal' as Grouping,
  search: '',
  /** The branch whose filing sheet is open, as a refKey. */
  filing: null as string | null,
  filingError: '',
  /** Newest first. Kept in the page only — a question is not worth a database. */
  asked: [] as Asked[],
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
 * nothing at all — no banner, no clue which of the dozen buttons was supposed to
 * respond. Anything that breaks should say so on screen (D50).
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
    // The program behind the page went away. Say so rather than showing stale data as
    // though it were live.
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
// Render
// ---------------------------------------------------------------------------

let groupingPicker: Picker | null = null;

function render(): void {
  try {
    draw();
  } catch (err) {
    showFailure('Could not draw the page:', err);
  }
}

function draw(): void {
  const data = state.data;
  const snapshot = data?.snapshot ?? null;

  renderDateline(data);

  if (!snapshot) {
    $('#firstRun').classList.remove('hidden');
    $('#firstRun').innerHTML = firstRun(data);
    for (const id of ['#nowBand', '#leaderHead', '#leaderList', '#register']) $(id).innerHTML = '';
    $('#ruleLine').innerHTML = '';
    $('#conditions').innerHTML = '';
    $('#notices').innerHTML = data?.error ? `<div class="notice">${esc(data.error)}</div>` : '';
    renderAnswers();
    return;
  }

  $('#firstRun').classList.add('hidden');

  const t = tallies(snapshot);
  $('#ruleLine').innerHTML = [
    `${t.repos} ${t.repos === 1 ? 'repository' : 'repositories'}`,
    `${t.branches} branches`,
    `${t.goals} goals`,
    `${t.commits} commits read`,
  ]
    .map((s) => `<span>${s}</span>`)
    .join('');

  $('#nowBand').innerHTML = renderNow(snapshot);
  renderLeaderHead(snapshot);
  $('#leaderList').innerHTML = renderLeaderList(snapshot, state.grouping, state.search);

  $('#registerCount').textContent = String(t.branches);
  $('#register').innerHTML = renderRegister(snapshot, state.search, state.filing);
  $('#conditions').innerHTML = renderConditions(snapshot);
  $('#notices').innerHTML = renderNotices(snapshot, { error: data?.error ?? null });

  $('#askHint').textContent = snapshot.llm.enabled
    ? `sees ${t.branches} branches · one turn`
    : 'advisor off — see settings';
  $('#askHint').title = snapshot.llm.enabled
    ? 'One question, one answer, over the snapshot on screen. It has no tools and fetches nothing.'
    : 'Turn the advisor on in settings to ask questions.';

  renderAnswers();
  renderFiling();
}

function renderDateline(data: SnapshotResponse | null): void {
  const snapshot = data?.snapshot ?? null;
  const when = snapshot ? new Date(snapshot.generatedAt) : null;
  const date = (when ?? new Date()).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  $('#dateLeft').innerHTML = when
    ? `${date} · read <span title="${esc(exactTime(snapshot!.generatedAt))}">${clockTime(snapshot!.generatedAt)}</span>`
    : `${date} · nothing read yet`;

  const bits: string[] = [];
  if (data?.refreshing) bits.push('<span class="live">reading…</span>');
  const rate = snapshot?.rateLimit;
  if (rate) {
    const low = rate.remaining < rate.limit * 0.1;
    bits.push(
      `<span class="${low ? 'bad' : ''}">${rate.remaining.toLocaleString()}/${rate.limit.toLocaleString()} calls · resets ${countdown(rate.resetsAt)}</span>`,
    );
  }
  $('#dateRight').innerHTML = bits.join(' · ');
}

function renderLeaderHead(snapshot: ReturnType<typeof requireSnapshot>): void {
  const head = $('#leaderHead');
  if (!head.querySelector('.grouping')) {
    head.innerHTML = `
      <div class="grouping" id="groupingMount"></div>
      <span class="find">&#128269;<input id="search" placeholder="branch name, literally" autocomplete="off"></span>
      <span class="count" id="leaderCount"></span>`;
    groupingPicker = createPicker({
      mount: $('#groupingMount'),
      placeholder: 'Group by…',
      emptyText: '',
      onChange: (value) => {
        state.grouping = value.includes('branch') ? 'branch' : 'goal';
        render();
      },
    });
    groupingPicker.setOptions([
      { value: 'by goal', label: 'what the work is for' },
      { value: 'by branch', label: 'newest first' },
    ]);
    groupingPicker.setValue(`by ${state.grouping}`);
    $<HTMLInputElement>('#search').value = state.search;
  }

  const t = tallies(snapshot);
  $('#leaderCount').textContent =
    state.grouping === 'goal'
      ? `${t.goals} goals · ${t.unfiled} unfiled`
      : `${t.branches} branches · ${t.quiet} quiet`;
}

function requireSnapshot(): NonNullable<SnapshotResponse['snapshot']> {
  const snapshot = state.data?.snapshot;
  if (!snapshot) throw new Error('no snapshot');
  return snapshot;
}

function firstRun(data: SnapshotResponse | null): string {
  if (data?.needs === 'token') {
    return `<div class="firstrun"><h2>Bearing needs a GitHub token</h2>
      <p>It reads your repositories and never writes to them. The token stays on this
      machine and is sent nowhere but GitHub.</p>
      <p style="margin-top:18px"><button class="btn primary" id="firstSettings">Open settings</button></p></div>`;
  }
  if (data?.needs === 'repos') {
    return `<div class="firstrun"><h2>Which repositories?</h2>
      <p>One <span class="mono">owner/name</span> per line in settings. Every branch in each
      of them will appear here.</p>
      <p style="margin-top:18px"><button class="btn primary" id="firstSettings">Open settings</button></p></div>`;
  }
  return `<div class="firstrun"><h2>Reading GitHub…</h2>
    <p>${data?.error ? esc(data.error) : 'The first read walks every branch in every repo. It is the slow one.'}</p></div>`;
}

// ---------------------------------------------------------------------------
// The advisor — one question, one answer (server/advise/ask.ts)
// ---------------------------------------------------------------------------

function renderAnswers(): void {
  $('#answers').innerHTML = state.asked
    .map((item) => {
      const body = item.pending
        ? '<div class="a working">thinking…</div>'
        : item.error
          ? `<div class="a err">${esc(item.error)}</div>`
          : `<div class="a">${esc(item.answer?.text ?? '')}</div>`;
      const prov =
        !item.pending && item.answer
          ? `<div class="prov">${item.answer.model} · saw ${item.answer.sawBranches} branches,
             ${item.answer.sawGoals} goals · ${(item.answer.ms / 1000).toFixed(1)}s</div>`
          : '';
      return `<div class="answer"><div class="q">${esc(item.question)}</div>${body}${prov}</div>`;
    })
    .join('');
}

async function askAdvisor(): Promise<void> {
  const box = $<HTMLTextAreaElement>('#askBox');
  const question = box.value.trim();
  if (!question) return;

  const item: Asked = { question, answer: null, error: null, pending: true };
  state.asked.unshift(item);
  box.value = '';
  $<HTMLButtonElement>('#askGo').disabled = true;
  renderAnswers();

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const payload = (await res.json()) as { answer?: Answer; error?: string };
    if (!res.ok || !payload.answer) throw new Error(payload.error ?? 'the advisor could not answer');
    item.answer = payload.answer;
  } catch (err) {
    item.error = err instanceof Error ? err.message : String(err);
  } finally {
    item.pending = false;
    $<HTMLButtonElement>('#askGo').disabled = false;
    renderAnswers();
  }
}

// ---------------------------------------------------------------------------
// Filing a branch under a goal (Plane B)
// ---------------------------------------------------------------------------

function renderFiling(): void {
  const host = $('#filing');
  if (!state.filing) {
    host.innerHTML = '';
    return;
  }

  const snapshot = requireSnapshot();
  const ref = parseBranchKey(state.filing);
  const branch = ref ? threads(snapshot).find((b) => b.repoKey === ref.repoKey && b.name === ref.branch) : null;
  if (!branch) {
    state.filing = null;
    host.innerHTML = '';
    return;
  }

  const count = (goal: Goal): number =>
    threads(snapshot).filter((b) => b.goalId === goal.id).length;

  host.innerHTML = `<div class="filing"><div class="box">
    <div class="eyebrow">File under a goal</div>
    <h4>${esc(branch.title ?? branch.name)}</h4>
    <div class="who">${esc(branch.repoKey)} · ${esc(branch.name)}</div>
    <div class="opts">
      ${snapshot.goals
        .map(
          (goal) => `<button class="opt ${branch.goalId === goal.id ? 'on' : ''}" data-pick="${esc(goal.id)}">
            ${esc(goal.title)}${goal.done ? ' <span class="chip prog-done">done</span>' : ''}
            <span class="n">${count(goal)}</span></button>`,
        )
        .join('')}
      <button class="opt none ${branch.goalId ? '' : 'on'}" data-pick="">leave it unfiled</button>
    </div>
    <div class="new">
      <input id="newGoalTitle" placeholder="or start a new goal…" autocomplete="off">
      <button class="btn primary" id="createAndFile">Create</button>
    </div>
    ${state.filingError ? `<div class="err">${esc(state.filingError)}</div>` : ''}
    <button class="btn close" id="closeFiling">Close</button>
  </div></div>`;
}

async function assign(goalId: string | null): Promise<void> {
  const ref = state.filing ? parseBranchKey(state.filing) : null;
  if (!ref) return;
  try {
    const res = await fetch('/api/goals/assign', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ref, goalId }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? 'could not file it');
    state.filing = null;
    state.filingError = '';
    // Re-read rather than waiting for the server's push.
    //
    // The server does announce this, and the announcement does arrive — but only while
    // the event stream is up, and it reconnects on a three-second timer. Leaning on it
    // meant a click during that window closed the sheet and changed nothing, with no
    // error anywhere: precisely the silent-no-op D50 exists to stop. The duplicate fetch
    // the push then triggers costs nothing; it is local and already in memory.
    await loadSnapshot();
  } catch (err) {
    state.filingError = err instanceof Error ? err.message : String(err);
    renderFiling();
  }
}

async function createGoal(title: string, thenFile: boolean): Promise<void> {
  try {
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const payload = (await res.json()) as { goal?: Goal; error?: string };
    if (!res.ok || !payload.goal) throw new Error(payload.error ?? 'could not create the goal');
    if (thenFile) await assign(payload.goal.id);
    else await loadSnapshot();
  } catch (err) {
    state.filingError = err instanceof Error ? err.message : String(err);
    renderFiling();
  }
}

/**
 * Editing a goal is a prompt rather than a form, on purpose: it is three fields the
 * owner touches rarely, and a second modal would cost more than it is worth. If that
 * stops being true, this is the place it grows.
 */
async function editGoal(id: string): Promise<void> {
  const snapshot = requireSnapshot();
  const goal = snapshot.goals.find((g) => g.id === id);
  if (!goal) return;

  const title = window.prompt('Goal', goal.title);
  if (title === null) return;

  if (title.trim() === '') {
    const used = threads(snapshot).filter((b) => b.goalId === id).length;
    const ok = window.confirm(
      used > 0
        ? `Delete this goal? Its ${used} branches become unfiled — nothing in the repos is touched.`
        : 'Delete this goal?',
    );
    if (!ok) return;
    await fetch(`/api/goals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadSnapshot();
    return;
  }

  const note = window.prompt('A note, in your own words (blank for none)', goal.note);
  if (note === null) return;

  const res = await fetch(`/api/goals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, note }),
  });
  if (!res.ok) {
    const payload = (await res.json()) as { error?: string };
    showFailure('Could not save the goal:', new Error(payload.error ?? 'unknown'));
  }
  await loadSnapshot();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let modelPicker: Picker | null = null;

function ensureModelPicker(): Picker {
  if (!modelPicker) {
    modelPicker = createPicker({
      mount: $('#modelPicker'),
      placeholder: 'Pick a model',
      emptyText: 'No models loaded yet',
    });
  }
  return modelPicker;
}

function applyProviderChoice(): void {
  const provider = $<HTMLSelectElement>('#llmProvider');
  const custom = provider.value === 'custom';
  $('#llmBaseUrl').classList.toggle('hidden', !custom);
  if (!custom) $<HTMLInputElement>('#llmBaseUrl').value = provider.value;
  $('#providerHint').textContent = custom
    ? 'Any endpoint that speaks the OpenAI, Anthropic or Responses API.'
    : provider.value.includes('/go/')
      ? 'The subscription plan. A different base URL from pay-as-you-go — using the wrong one reports an empty balance.'
      : 'Pay as you go. Needs a balance on your Zen account.';
}

async function openSettings(): Promise<void> {
  try {
    const settings = (await (await fetch('/api/settings')).json()) as SafeSettings;
    $<HTMLTextAreaElement>('#repos').value = settings.repos.join('\n');
    $<HTMLInputElement>('#refreshSeconds').value = String(settings.refreshSeconds);
    $<HTMLInputElement>('#quietAfterDays').value = String(settings.quietAfterDays);
    $<HTMLInputElement>('#commitsPerBranch').value = String(settings.commitsPerBranch);
    $<HTMLInputElement>('#llmMaxPerRun').value = String(settings.llmMaxPerRun);
    $<HTMLInputElement>('#askBranchCap').value = String(settings.askBranchCap);
    $<HTMLInputElement>('#token').value = '';
    $<HTMLInputElement>('#token').placeholder = settings.hasToken
      ? 'a token is set — leave blank to keep it'
      : 'github_pat_…';

    const provider = $<HTMLSelectElement>('#llmProvider');
    const known = [...provider.options].some((option) => option.value === settings.llmBaseUrl);
    provider.value = known ? settings.llmBaseUrl : 'custom';
    $<HTMLInputElement>('#llmBaseUrl').value = settings.llmBaseUrl;
    applyProviderChoice();

    const picker = ensureModelPicker();
    picker.setValue(settings.llmModel);
    if (!settings.llmModel) picker.setStatus(settings.hasLlmKey ? 'No model chosen' : 'Add a key first');

    $<HTMLInputElement>('#llmApiKey').value = '';
    $<HTMLInputElement>('#llmApiKey').placeholder = settings.hasLlmKey
      ? 'a key is set — leave blank to keep it'
      : 'sk-…';

    $('#settingsErr').textContent = '';
    $('#settingsSheet').classList.remove('hidden');
  } catch (err) {
    showFailure('Could not open settings:', err);
  }
}

async function saveSettings(): Promise<void> {
  const errEl = $('#settingsErr');
  const button = $<HTMLButtonElement>('#saveSettings');
  errEl.textContent = '';
  button.disabled = true;

  try {
    const body: Record<string, unknown> = {
      repos: $<HTMLTextAreaElement>('#repos')
        .value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      refreshSeconds: Number($<HTMLInputElement>('#refreshSeconds').value),
      quietAfterDays: Number($<HTMLInputElement>('#quietAfterDays').value),
      commitsPerBranch: Number($<HTMLInputElement>('#commitsPerBranch').value),
      llmMaxPerRun: Number($<HTMLInputElement>('#llmMaxPerRun').value),
      askBranchCap: Number($<HTMLInputElement>('#askBranchCap').value),
      llmBaseUrl: $<HTMLInputElement>('#llmBaseUrl').value.trim(),
      llmModel: ensureModelPicker().getValue(),
    };
    const token = $<HTMLInputElement>('#token').value.trim();
    if (token) body['token'] = token;
    const key = $<HTMLInputElement>('#llmApiKey').value.trim();
    if (key) body['llmApiKey'] = key;

    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json()) as { error?: string };
      errEl.textContent = payload.error ?? 'could not save';
      return;
    }
    $('#settingsSheet').classList.add('hidden');
    await loadSnapshot();
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
}

async function loadModels(): Promise<void> {
  const picker = ensureModelPicker();
  picker.setStatus('Loading…');
  try {
    const res = await fetch('/api/llm/models');
    const payload = (await res.json()) as { models?: { id: string; name?: string }[]; error?: string };
    if (!res.ok || !payload.models) {
      $('#settingsErr').textContent = payload.error ?? 'could not load models';
      picker.setStatus('Could not load');
      return;
    }
    picker.setOptions(payload.models.map((m) => ({ value: m.id, label: m.name })));
    picker.setStatus(`${payload.models.length} models`);
  } catch (err) {
    $('#settingsErr').textContent = err instanceof Error ? err.message : String(err);
    picker.setStatus('Could not load');
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const file = target.closest<HTMLElement>('[data-file]');
    if (file) {
      state.filing = file.dataset['file'] ?? null;
      state.filingError = '';
      renderFiling();
      return;
    }

    const pick = target.closest<HTMLElement>('[data-pick]');
    if (pick) {
      void assign(pick.dataset['pick'] || null);
      return;
    }

    const edit = target.closest<HTMLElement>('[data-edit-goal]');
    if (edit) {
      void editGoal(edit.dataset['editGoal'] ?? '');
      return;
    }

    if (target.closest('#closeFiling')) {
      state.filing = null;
      renderFiling();
      return;
    }
    if (target.closest('#createAndFile')) {
      const title = $<HTMLInputElement>('#newGoalTitle').value;
      void createGoal(title, true);
      return;
    }
    if (target.closest('#firstSettings')) void openSettings();
  });

  document.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.id !== 'search') return;
    state.search = (target as HTMLInputElement).value;
    render();
    const box = document.querySelector<HTMLInputElement>('#search');
    if (box) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.filing) {
        state.filing = null;
        renderFiling();
      }
      $('#settingsSheet').classList.add('hidden');
      return;
    }
    const target = event.target as HTMLElement;
    if (target.id === 'askBox' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void askAdvisor();
      return;
    }
    if (target.id === 'newGoalTitle' && event.key === 'Enter') {
      event.preventDefault();
      void createGoal($<HTMLInputElement>('#newGoalTitle').value, true);
      return;
    }
    // `/` focuses the search, the way it does everywhere else.
    if (event.key === '/' && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      const box = document.querySelector<HTMLInputElement>('#search');
      if (box) {
        event.preventDefault();
        box.focus();
      }
    }
  });

  on('#askGo', 'click', () => void askAdvisor());
  on('#refreshNow', 'click', () => void fetch('/api/refresh', { method: 'POST' }));
  on('#openSettings', 'click', () => void openSettings());
  on('#closeSettings', 'click', () => $('#settingsSheet').classList.add('hidden'));
  on('#saveSettings', 'click', () => void saveSettings());
  on('#llmProvider', 'change', () => applyProviderChoice());
  on('#loadModels', 'click', (event) => {
    event.preventDefault();
    void loadModels();
  });
  on('#newGoal', 'click', () => {
    const title = window.prompt('A new goal');
    if (title && title.trim()) void createGoal(title, false);
  });
  on('#settingsSheet', 'click', (event) => {
    if (event.target === $('#settingsSheet')) $('#settingsSheet').classList.add('hidden');
  });
}

wire();
void loadSnapshot();
listen();
