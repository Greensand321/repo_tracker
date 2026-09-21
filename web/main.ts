/**
 * The page. Fetches one Snapshot from the local program, renders it as a broadsheet, and
 * re-renders when the server says something moved.
 *
 * It computes nothing the Snapshot does not already contain (rule 4) — the groupings it
 * needs live in derive.ts, shared — and it never sees the GitHub token, which stays in
 * the program behind this page.
 */

import type { Answer } from '../server/advise/ask.ts';
import type { BranchRef, Goal, SafeSettings, SnapshotResponse } from '../shared/types.ts';
import { createPicker, type Picker } from './components/picker.ts';
import { floor, tallies, threads, toolLabel } from './derive.ts';
import { clockTime, countdown, esc, exactTime, plural, relativeTime } from './format.ts';
import { branchKey, parseBranchKey, renderBrief, renderLeaderList, renderNow, type Grouping } from './views/leader.ts';
import { renderConditions, renderFloor, renderNotices, renderQuestions, renderRegister } from './views/side.ts';

type Asked = {
  question: string;
  answer: Answer | null;
  error: string | null;
  pending: boolean;
  /** What happened to a proposed regrouping: still offered, accepted, or declined. */
  filed: 'offered' | 'filing' | 'done' | 'declined';
};

const state = {
  data: null as SnapshotResponse | null,
  grouping: 'goal' as Grouping,
  search: '',
  /** The branch whose filing sheet is open, as a refKey. */
  filing: null as string | null,
  filingError: '',
  /** Newest first. Kept in the page only — a question is not worth a database. */
  asked: [] as Asked[],
  /** How many questions the assistant may have waiting. Read from settings. */
  maxQuestions: 3,
  /** Proposals from a paragraph, awaiting confirmation. Nothing is written until then. */
  proposals: [] as { ref: BranchRef; vision: string; suggest: 'done' | 'close' | null }[],
  describing: false,
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

/**
 * The clock on a working job counts up between events, and a job with no lookups sends
 * none for a minute. One second of ticking, and only the panel that moves is redrawn —
 * re-reading a hundred branches to advance a timer would be absurd.
 *
 * Started once. It used to start inside `listen`, which runs again on every reconnect, so
 * a page left open through a few restarts of the program was ticking several times a second.
 */
function tick(): void {
  setInterval(() => {
    const snapshot = state.data?.snapshot;
    if (!snapshot || floor(snapshot).working.length === 0) return;
    try {
      $('#floor').innerHTML = renderFloor(snapshot);
    } catch {
      // A tick must never be the thing that breaks the page.
    }
  }, 1000);
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
    for (const id of ['#brief', '#nowBand', '#leaderHead', '#leaderList', '#register', '#questions']) {
      $(id).innerHTML = '';
    }
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

  $('#brief').innerHTML = renderBrief(snapshot);
  $('#nowBand').innerHTML = renderNow(snapshot);
  renderLeaderHead(snapshot);
  $('#leaderList').innerHTML = renderLeaderList(snapshot, state.grouping, state.search);

  const board = floor(snapshot);
  $('#floor').innerHTML = renderFloor(snapshot);
  $('#floorCount').textContent = board.working.length > 0 ? `${board.working.length} at work` : '';

  $('#registerCount').textContent = String(t.branches);
  $('#register').innerHTML = renderRegister(snapshot, state.search, state.filing);
  $('#questions').innerHTML = renderQuestions(snapshot, state.maxQuestions);
  $('#conditions').innerHTML = renderConditions(snapshot);
  $('#notices').innerHTML = renderNotices(snapshot, { error: data?.error ?? null });

  $('#askHint').textContent = snapshot.llm.enabled
    ? `sees ${t.branches} branches · can start work`
    : 'advisor off — see settings';
  $('#askHint').title = snapshot.llm.enabled
    ? 'One question, one answer, over the snapshot on screen. It can read how things moved lately and put work on the board — which lands on the floor, not here. Ask it to rank branches by your criteria, or to regroup the register: it proposes, you accept.'
    : 'Turn the advisor on in settings to ask questions.';

  renderAnswers();
  renderFiling();
  renderProposals();
  // Only offered once there is a thread to end.
  $('#newThread').classList.toggle('hidden', state.asked.length === 0);
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

  // What the room is doing belongs on the one line always in view (D73), not only in a
  // panel halfway down a long column.
  if (snapshot) {
    const board = floor(snapshot);
    if (board.working.length > 0) {
      bits.push(`<span class="live">${board.working.length} at work</span>`);
    } else if (board.waiting.length > 0) {
      bits.push(`<span>${board.waiting.length} waiting</span>`);
    }
    // Work you asked for and stopped watching. Routine work is not announced — forty
    // notices about forty summaries is a reason to stop reading notices (Q71).
    if (board.finished.length > 0) {
      bits.push(
        `<span class="good">${board.finished.length === 1 ? 'what you asked for is done' : `${board.finished.length} things you asked for are done`}</span>`,
      );
    }
  }

  // The dateline is the only thing always in view, so a repeating provider failure
  // belongs here as well as in Notices — which sits at the bottom of a long column.
  const failures = snapshot?.llm.errors.length ?? 0;
  if (failures > 0) {
    bits.push(
      `<span class="bad" title="${esc(snapshot!.llm.errors.join(' · '))}">${failures} advisor ${failures === 1 ? 'failure' : 'failures'} — see Notices</span>`,
    );
  }
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
    .map((item, index) => {
      const body = item.pending
        ? '<div class="a working">thinking…</div>'
        : item.error
          ? `<div class="a err">${esc(item.error)}</div>`
          : `<div class="a">${esc(item.answer?.text ?? '')}</div>`;
      const answer = !item.pending ? item.answer : null;
      return `<div class="answer"><div class="q">${esc(item.question)}</div>${body}${
        answer ? renderRanking(answer) + renderGroups(answer, item, index) + renderStarted(answer) + renderProv(answer) : ''
      }</div>`;
    })
    .join('');
}

/** An order the owner asked for. Literal branch names, always (rule 6); it writes nothing. */
function renderRanking(answer: Answer): string {
  if (answer.ranking.length === 0) return '';
  return `<ol class="rank">${answer.ranking
    .map(
      (row) => `<li><span class="mono">${esc(row.ref.repoKey.split('/')[1] ?? row.ref.repoKey)} / ${esc(row.ref.branch)}</span>${
        row.why ? ` <span class="why">${esc(row.why)}</span>` : ''
      }</li>`,
    )
    .join('')}</ol>`;
}

/**
 * A regrouping the advisor proposed. Nothing is filed until the button is pressed: it is
 * the largest write in the program, and the assistant proposes while the owner decides.
 */
function renderGroups(answer: Answer, item: Asked, index: number): string {
  if (answer.groups.length === 0) return '';
  const list = answer.groups
    .map(
      (group) => `<div class="prop">
        <div class="reflect">${esc(group.title)}</div>
        <div class="mono">${group.branches.map((b) => esc(b.branch)).join(' · ')}</div>
      </div>`,
    )
    .join('');
  const acts =
    item.filed === 'done'
      ? '<div class="q-from">filed like this</div>'
      : item.filed === 'declined'
        ? '<div class="q-from">left as it was</div>'
        : `<div class="q-acts">
            <button class="q-btn yes" data-regroup="${index}" ${item.filed === 'filing' ? 'disabled' : ''}>file them like this</button>
            <button class="q-btn" data-noregroup="${index}">leave it</button>
          </div>`;
  return `<div class="groups"><div class="eyebrow">I would file them as</div>${list}${acts}</div>`;
}

/** Work it set going. It lands on the floor and on the page, not in this answer. */
function renderStarted(answer: Answer): string {
  if (answer.started.length === 0) return '';
  return `<div class="started">${answer.started.map((line) => `<div>&#9670; ${esc(line)}</div>`).join('')}</div>`;
}

function renderProv(answer: Answer): string {
  const looked = answer.looked.length > 0 ? ` · after ${[...new Set(answer.looked)].map(toolLabel).join(' and ')}` : '';
  // Whether it had the earlier turns in front of it. Worth showing: an answer that
  // followed on from what you said is a different thing from one that started cold (D92).
  const thread = answer.inThread > 0 ? ` · following on from ${plural(answer.inThread, 'question')}` : '';
  return `<div class="prov">${esc(answer.model)} · saw ${answer.sawBranches} branches,
    ${answer.sawGoals} goals${esc(looked)}${esc(thread)} · ${(answer.ms / 1000).toFixed(1)}s</div>`;
}

/**
 * Start again. The advisor's memory is only what was said; the register, the goals and
 * everything on disk are untouched, so this is safe to press whenever a thread has wandered.
 */
async function newThread(): Promise<void> {
  try {
    await fetch('/api/ask', { method: 'DELETE' });
  } catch {
    // Nothing to report: the thread expires on its own, and a failed clear costs nothing.
  }
  state.asked = [];
  renderAnswers();
  $('#newThread').classList.add('hidden');
  $<HTMLTextAreaElement>('#askBox').focus();
}

/** Accepting a proposed regrouping. One click, one write, then the page re-reads. */
async function acceptGroups(index: number): Promise<void> {
  const item = state.asked[index];
  if (!item?.answer || item.filed !== 'offered') return;
  item.filed = 'filing';
  renderAnswers();
  try {
    const res = await fetch('/api/goals/regroup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: item.answer.groups }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'could not file them');
    item.filed = 'done';
    await loadSnapshot();
  } catch (err) {
    item.filed = 'offered';
    showFailure('Could not file them:', err);
    renderAnswers();
  }
}

async function askAdvisor(): Promise<void> {
  const box = $<HTMLTextAreaElement>('#askBox');
  const question = box.value.trim();
  if (!question) return;

  const item: Asked = { question, answer: null, error: null, pending: true, filed: 'offered' };
  state.asked.unshift(item);
  box.value = '';
  $<HTMLButtonElement>('#askGo').disabled = true;
  renderAnswers();
  $('#newThread').classList.remove('hidden');

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
// Vision — what a branch is FOR
// ---------------------------------------------------------------------------

async function postVision(path: string, body: unknown, method = 'POST'): Promise<void> {
  try {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json()) as { error?: string };
      throw new Error(payload.error ?? 'that did not save');
    }
    // Re-read rather than waiting for the push, for the same reason filing does: the
    // event stream reconnects on a timer and a click inside that window must not
    // silently do nothing.
    await loadSnapshot();
  } catch (err) {
    showFailure('Could not save that:', err);
  }
}

/**
 * Writing a vision by hand. A prompt rather than a panel, because it is one sentence and
 * a panel would cost more than it is worth — pre-filled so you are correcting a draft
 * rather than composing from nothing.
 */
/**
 * Ask for something to be done now.
 *
 * It queues; it does not do. The reply comes back as soon as the job is on the board, and
 * the floor shows the rest — which is the point: you asked so that you could stop
 * watching, and you are told on the floor when it lands.
 */
async function askFor(kind: string, key: string): Promise<void> {
  const ref = key ? parseBranchKey(key) : null;
  if (kind !== 'brief' && !ref) return;
  try {
    const res = await fetch('/api/work/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'brief' ? { kind } : { kind, ...ref }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'could not ask for that');
    await loadSnapshot();
  } catch (err) {
    showFailure('Could not ask for that:', err);
  }
}

/**
 * Try a parked job again. The board is derived, so there is nothing to un-write — the
 * server only forgets that this job failed twice, and the next pass picks it up.
 */
async function retryJob(id: string): Promise<void> {
  if (!id) return;
  try {
    const res = await fetch('/api/work/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'could not retry');
    // Re-read rather than waiting for the push: the stream reconnects on a timer, and a
    // click inside that window must not silently do nothing.
    await loadSnapshot();
  } catch (err) {
    showFailure('Could not try that again:', err);
  }
}

async function sayVision(key: string): Promise<void> {
  const ref = parseBranchKey(key);
  if (!ref) return;
  const snapshot = requireSnapshot();
  const branch = threads(snapshot).find((b) => b.repoKey === ref.repoKey && b.name === ref.branch);

  const text = window.prompt(
    `What is ${ref.branch} for?\n\nOne sentence. Specific enough that future commits could contradict it.`,
    branch?.vision?.text ?? '',
  );
  if (text === null) return;
  if (!text.trim()) {
    await postVision('/api/vision', ref, 'DELETE');
    return;
  }
  await postVision('/api/vision', { ...ref, text, state: 'yours' }, 'PUT');
}

/**
 * Drift has two causes and only the owner knows which. "That's the new plan" rewrites
 * the vision to match what the branch is actually doing; "it wandered" leaves the vision
 * alone and the flag standing.
 */
async function newPlan(key: string, alsoDone: boolean): Promise<void> {
  const ref = parseBranchKey(key);
  if (!ref) return;
  const snapshot = requireSnapshot();
  const branch = threads(snapshot).find((b) => b.repoKey === ref.repoKey && b.name === ref.branch);

  const suggested = alsoDone
    ? branch?.vision?.text ?? ''
    : branch?.assessment?.because ?? branch?.summary ?? '';

  const text = window.prompt(
    alsoDone
      ? `Closing out ${ref.branch}. Record what it ended up being for:`
      : `New plan for ${ref.branch}. What is it for now?`,
    suggested,
  );
  if (text === null || !text.trim()) return;
  await postVision('/api/vision', { ...ref, text, state: 'yours' }, 'PUT');
}

/**
 * "It wandered" is an answer, not a no-op — but there is nothing to write, because the
 * vision was right and the branch is the problem. Saying so is the owner's job with the
 * branch, not Bearing's: Plane A is read-only forever.
 */
function wandered(key: string): void {
  const ref = parseBranchKey(key);
  if (!ref) return;
  window.alert(
    `Noted — ${ref.branch} has wandered from what it was for.\n\n` +
      'Bearing never writes to your repos, so the fix is over on GitHub. ' +
      'The flag stays until the branch moves back toward its vision.',
  );
}

/**
 * Describing several branches at once, in one paragraph. The route whose cost does not
 * scale with branch count — and nothing is written until the proposals are confirmed.
 */
async function describeMany(): Promise<void> {
  const text = window.prompt(
    'Tell me what you are working on, in your own words.\n\n' +
      'Mention as many branches as you like — I will split it into one purpose each and ' +
      'show you before anything is saved.',
    '',
  );
  if (text === null || !text.trim()) return;

  state.describing = true;
  render();
  try {
    const res = await fetch('/api/vision/distribute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const payload = (await res.json()) as { proposals?: typeof state.proposals; error?: string };
    if (!res.ok || !payload.proposals) throw new Error(payload.error ?? 'could not read that');
    state.proposals = payload.proposals;
    if (state.proposals.length === 0) {
      window.alert('I could not match that to any branch confidently, so I have written nothing.');
    }
  } catch (err) {
    showFailure('Could not split that up:', err);
  } finally {
    state.describing = false;
    render();
  }
}

/** Applying the proposals, one round trip each. Small numbers; clarity beats a batch API. */
async function applyProposals(): Promise<void> {
  const list = state.proposals;
  state.proposals = [];
  for (const proposal of list) {
    await postVision('/api/vision', { ...proposal.ref, text: proposal.vision, state: 'yours' }, 'PUT');
  }
}

function renderProposals(): void {
  const host = $('#proposals');
  if (state.proposals.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `<div class="filing"><div class="box">
    <div class="eyebrow">From what you said</div>
    <h4>I would set these</h4>
    <div class="opts">
      ${state.proposals
        .map(
          (p) => `<div class="prop">
            <div class="mono">${esc(p.ref.repoKey.split('/')[1] ?? p.ref.repoKey)} / ${esc(p.ref.branch)}</div>
            <div class="reflect">${esc(p.vision)}</div>
            ${p.suggest ? `<div class="q-from">you said this one is ${p.suggest === 'done' ? 'finished' : 'dead'}</div>` : ''}
          </div>`,
        )
        .join('')}
    </div>
    <div class="new" style="justify-content:flex-end">
      <button class="btn primary" id="applyProposals">Apply all</button>
      <button class="btn" id="dropProposals">No, let me redo that</button>
    </div>
  </div></div>`;
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
  $('#endpointField').classList.toggle('hidden', !custom);
  if (!custom) $<HTMLInputElement>('#llmBaseUrl').value = provider.value;
  // The note behind the provider's "i" says what the choice means; the field itself stays quiet.
  $('#providerHint').dataset['tip'] = custom
    ? 'Any endpoint that speaks the OpenAI, Anthropic or Responses API. Paste its base URL below.'
    : provider.value.includes('/go/')
      ? 'The $10/month subscription. A different base URL from pay-as-you-go — the wrong one reports an empty balance.'
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
    $<HTMLInputElement>('#llmReplyTokens').value = String(settings.llmReplyTokens);
    $<HTMLInputElement>('#askBranchCap').value = String(settings.askBranchCap);
    $<HTMLInputElement>('#maxOpenQuestions').value = String(settings.maxOpenQuestions);
    $<HTMLInputElement>('#briefEveryMinutes').value = String(settings.briefEveryMinutes);
    $<HTMLInputElement>('#advisorMemoryMinutes').value = String(settings.advisorMemoryMinutes);
    $<HTMLInputElement>('#workers').value = String(settings.workers);
    $<HTMLInputElement>('#dispatchWorkers').value = String(settings.dispatchWorkers);
    $<HTMLInputElement>('#toolCallsPerJob').value = String(settings.toolCallsPerJob);
    $<HTMLInputElement>('#toolsEnabled').checked = settings.toolsEnabled;
    $<HTMLInputElement>('#visionAutoDraft').checked = settings.visionAutoDraft;
    state.maxQuestions = settings.maxOpenQuestions;
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
      llmReplyTokens: Number($<HTMLInputElement>('#llmReplyTokens').value),
      askBranchCap: Number($<HTMLInputElement>('#askBranchCap').value),
      maxOpenQuestions: Number($<HTMLInputElement>('#maxOpenQuestions').value),
      briefEveryMinutes: Number($<HTMLInputElement>('#briefEveryMinutes').value),
      advisorMemoryMinutes: Number($<HTMLInputElement>('#advisorMemoryMinutes').value),
      workers: Number($<HTMLInputElement>('#workers').value),
      dispatchWorkers: Number($<HTMLInputElement>('#dispatchWorkers').value),
      toolCallsPerJob: Number($<HTMLInputElement>('#toolCallsPerJob').value),
      toolsEnabled: $<HTMLInputElement>('#toolsEnabled').checked,
      visionAutoDraft: $<HTMLInputElement>('#visionAutoDraft').checked,
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

    const ask = target.closest<HTMLElement>('[data-ask]');
    if (ask) {
      void askFor(ask.dataset['ask'] ?? '', ask.dataset['on'] ?? '');
      return;
    }

    // A branch chip beside the brief: put the name in the search box, which is what "find
    // the task" means on this page.
    const find = target.closest<HTMLElement>('[data-find]');
    if (find) {
      state.search = find.dataset['find'] ?? '';
      render();
      const box = document.querySelector<HTMLInputElement>('#search');
      if (box) { box.value = state.search; box.focus(); }
      return;
    }

    const retry = target.closest<HTMLElement>('[data-retry]');
    if (retry) { void retryJob(retry.dataset['retry'] ?? ''); return; }

    const regroup = target.closest<HTMLElement>('[data-regroup]');
    if (regroup) { void acceptGroups(Number(regroup.dataset['regroup'])); return; }
    const noRegroup = target.closest<HTMLElement>('[data-noregroup]');
    if (noRegroup) {
      const item = state.asked[Number(noRegroup.dataset['noregroup'])];
      if (item) { item.filed = 'declined'; renderAnswers(); }
      return;
    }

    const say = target.closest<HTMLElement>('[data-say]');
    if (say) { void sayVision(say.dataset['say'] ?? ''); return; }

    const confirmV = target.closest<HTMLElement>('[data-confirm]');
    if (confirmV) {
      const ref = parseBranchKey(confirmV.dataset['confirm'] ?? '');
      if (ref) void postVision('/api/vision/confirm', ref);
      return;
    }

    const clearV = target.closest<HTMLElement>('[data-clearvision]');
    if (clearV) {
      const ref = parseBranchKey(clearV.dataset['clearvision'] ?? '');
      if (ref) void postVision('/api/vision', ref, 'DELETE');
      return;
    }

    const plan = target.closest<HTMLElement>('[data-newplan]');
    if (plan) { void newPlan(plan.dataset['newplan'] ?? '', plan.dataset['done'] === '1'); return; }

    const wander = target.closest<HTMLElement>('[data-wandered]');
    if (wander) { wandered(wander.dataset['wandered'] ?? ''); return; }

    const gdone = target.closest<HTMLElement>('[data-goaldone]');
    if (gdone) {
      void fetch(`/api/goals/${encodeURIComponent(gdone.dataset['goaldone'] ?? '')}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ done: true }),
      }).then(() => loadSnapshot());
      return;
    }

    if (target.closest('#applyProposals')) { void applyProposals(); return; }
    if (target.closest('#dropProposals')) { state.proposals = []; renderProposals(); return; }
    if (target.closest('#describeMany')) { void describeMany(); return; }

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
  on('#newThread', 'click', () => void newThread());
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
// The question cap lives in settings; read it before the first draw so the panel is
// never briefly wrong.
void fetch('/api/settings')
  .then((res) => res.json())
  .then((settings: SafeSettings) => {
    state.maxQuestions = settings.maxOpenQuestions;
  })
  .catch(() => {
    /* the default stands; the snapshot load will report if the program is not running */
  })
  .finally(() => void loadSnapshot());
tick();
listen();
