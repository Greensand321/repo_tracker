/** The HTTP surface. Thin: parse, call, respond. No logic lives here. */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { randomUUID } from 'node:crypto';

import { refKey, type JobKind, type Settings, type Snapshot } from '../shared/types.ts';
import { ask } from './advise/ask.ts';
import { forget, thread } from './advise/conversation.ts';
import { actionsFor } from './agent/actions.ts';
import { markSeen } from './agent/record.ts';
import { undoChange, undoTurn } from './agent/undo.ts';
import { cannotAsk } from './work/asks.ts';
import { distributeVisions } from './advise/vision.ts';
import { LlmError, fetchModelsRaw, listModels } from './advise/client.ts';
import { GitHubError, splitRepoKey, verifyToken } from './github.ts';
import { GoalError, assignBranch, createGoal, deleteGoal, listGoals, updateGoal } from './goals.ts';
import { VisionError, clearVision, confirmVision, setVision } from './vision.ts';
import { loadSettings, saveSettings, toSafe } from './settings.ts';
import { resetBoardState } from './work/run.ts';
import {
  currentResponse,
  dispatchWork,
  reapplyAll,
  reapplyGoals,
  reapplyVisions,
  refresh,
  retryJob,
  startPolling,
  subscribe,
} from './state.ts';

export const api = new Hono();

api.get('/snapshot', (c) => c.json(currentResponse()));

api.post('/refresh', async (c) => {
  await refresh();
  return c.json(currentResponse());
});

api.get('/settings', (c) => c.json(toSafe(loadSettings())));

api.put('/settings', async (c) => {
  const body = (await c.req.json()) as Partial<Settings> & { token?: string };
  const patch: Partial<Settings> = {};

  // Repos are parsed first so the token check below can verify against one of them.
  if (Array.isArray(body.repos)) {
    const bad: string[] = [];
    for (const repo of body.repos) {
      try {
        splitRepoKey(String(repo));
      } catch {
        bad.push(String(repo));
      }
    }
    if (bad.length > 0) {
      return c.json({ error: `not in owner/repo form: ${bad.join(', ')}` }, 400);
    }
    patch.repos = body.repos.map(String);
  }

  if (typeof body.token === 'string' && body.token.trim()) {
    const token = body.token.trim();
    const against = patch.repos ?? loadSettings().repos;
    try {
      await verifyToken(token, against);
    } catch (err) {
      // Reject a bad token at the door rather than storing it and failing later in a
      // way that looks like the repos are broken.
      const hint =
        err instanceof GitHubError && err.status === 404
          ? ' — check the token\'s Repository access covers it, and that Contents is Read-only'
          : '';
      return c.json({ error: `${describe(err)}${hint}` }, 400);
    }
    patch.token = token;
  }

  for (const key of [
    'refreshSeconds',
    'quietAfterDays',
    'commitsPerBranch',
    'llmMaxPerRun',
    'llmReplyTokens',
    'llmTimeoutSeconds',
    'askBranchCap',
    'maxOpenQuestions',
    'briefEveryMinutes',
    'advisorMemoryMinutes',
    'agentCallsPerQuestion',
    'agentSeconds',
    'agentHistory',
    'workers',
    'dispatchWorkers',
    'toolCallsPerJob',
    'toolSeconds',
  ] as const) {
    if (body[key] !== undefined) patch[key] = Number(body[key]);
  }
  for (const key of ['llmBaseUrl', 'llmModel'] as const) {
    if (typeof body[key] === 'string') patch[key] = body[key];
  }
  if (typeof body.llmEnabled === 'boolean') patch.llmEnabled = body.llmEnabled;
  if (typeof body.visionAutoDraft === 'boolean') patch.visionAutoDraft = body.visionAutoDraft;
  if (typeof body.toolsEnabled === 'boolean') patch.toolsEnabled = body.toolsEnabled;
  if (typeof body.agentEnabled === 'boolean') patch.agentEnabled = body.agentEnabled;
  if (typeof body.llmApiKey === 'string' && body.llmApiKey.trim()) {
    patch.llmApiKey = body.llmApiKey.trim();
  }

  const saved = saveSettings(patch);
  // A job parked because of a rejected key, a missing model or a wrong endpoint — the
  // three things most likely to have just been edited on this screen. Keeping it parked
  // on the strength of a problem that was just fixed is the opposite of helpful.
  resetBoardState();
  // Settings changed what or how often we fetch, so restart the loop rather than
  // waiting out the old interval.
  startPolling();
  return c.json(toSafe(saved));
});

// ---------------------------------------------------------------------------
// Goals — Plane B. Written freely; the repos are never touched by any of this.
// ---------------------------------------------------------------------------

api.get('/goals', (c) => c.json({ goals: listGoals() }));

api.post('/goals', async (c) => {
  try {
    const body = (await c.req.json()) as { title?: unknown; note?: unknown; milestone?: unknown };
    const goal = createGoal({
      title: String(body.title ?? ''),
      note: typeof body.note === 'string' ? body.note : undefined,
      milestone: typeof body.milestone === 'string' ? body.milestone : undefined,
    });
    reapplyGoals();
    return c.json({ goal, goals: listGoals() });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

api.patch('/goals/:id', async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: Parameters<typeof updateGoal>[1] = {};
    for (const key of ['title', 'note', 'milestone'] as const) {
      if (typeof body[key] === 'string') patch[key] = body[key];
    }
    if (typeof body['done'] === 'boolean') patch.done = body['done'];
    const goal = updateGoal(c.req.param('id'), patch);
    reapplyGoals();
    return c.json({ goal, goals: listGoals() });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

api.delete('/goals/:id', async (c) => {
  try {
    deleteGoal(c.req.param('id'));
    reapplyGoals();
    return c.json({ goals: listGoals() });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/** Move one branch into a goal, or out of every goal with `goalId: null`. */
api.put('/goals/assign', async (c) => {
  try {
    const body = (await c.req.json()) as { repoKey?: unknown; branch?: unknown; goalId?: unknown };
    if (typeof body.repoKey !== 'string' || typeof body.branch !== 'string') {
      return c.json({ error: 'repoKey and branch are required' }, 400);
    }
    const goalId = body.goalId === null || body.goalId === undefined ? null : String(body.goalId);
    assignBranch({ repoKey: body.repoKey, branch: body.branch }, goalId);
    reapplyGoals();
    return c.json({ goals: listGoals() });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

// ---------------------------------------------------------------------------
// Vision — what a branch is FOR. Plane B. See docs/plans/vision-ux.md.
// ---------------------------------------------------------------------------

function refOf(body: Record<string, unknown>): { repoKey: string; branch: string } {
  if (typeof body['repoKey'] !== 'string' || typeof body['branch'] !== 'string') {
    throw new VisionError('repoKey and branch are required');
  }
  return { repoKey: body['repoKey'], branch: body['branch'] };
}

/**
 * Writing a vision. `state` says whose words these are, and it is not cosmetic: a
 * proposal the owner has not looked at must never be treated as their intent.
 *
 *   yours      the owner typed it
 *   confirmed  the owner accepted a draft unchanged
 */
api.put('/vision', async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const ref = refOf(body);
    const text = String(body['text'] ?? '');
    const state = body['state'] === 'confirmed' ? 'confirmed' : 'yours';
    const vision = setVision(ref, text, state);
    reapplyVisions();
    return c.json({ vision });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/** Accepting a draft as it stands. The words do not change, so the assessment survives. */
api.post('/vision/confirm', async (c) => {
  try {
    const vision = confirmVision(refOf((await c.req.json()) as Record<string, unknown>));
    reapplyVisions();
    return c.json({ vision });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/** "I do not want to say" is a real answer, and better than a vision nobody believes. */
api.delete('/vision', async (c) => {
  try {
    clearVision(refOf((await c.req.json()) as Record<string, unknown>));
    reapplyVisions();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/**
 * One paragraph about several branches, split into one vision each.
 *
 * Returns proposals only — nothing is written. The owner confirms what they meant, which
 * is the whole point of talking in paragraphs rather than filling in a form per branch.
 */
api.post('/vision/distribute', async (c) => {
  const snapshot = currentResponse().snapshot;
  if (!snapshot) return c.json({ error: 'nothing has been read from GitHub yet' }, 400);
  try {
    const body = (await c.req.json()) as { text?: unknown };
    const paragraph = String(body.text ?? '').trim();
    if (!paragraph) return c.json({ error: 'say something first' }, 400);

    const proposals = await distributeVisions(
      paragraph,
      snapshot.branches.filter((b) => !b.isBase),
      loadSettings(),
    );
    return c.json({ proposals });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

const JOB_KINDS = new Set(['summarise', 'draft-vision', 'assess', 'brief']);

/**
 * Ask for something to be done now.
 *
 * The one write that creates work rather than describing it. It queues; it does not do —
 * the reply comes back the moment the job is on the board, and the floor shows the rest.
 */
api.post('/work/dispatch', async (c) => {
  const snapshot = currentResponse().snapshot;
  if (!snapshot) return c.json({ error: 'nothing has been read from GitHub yet' }, 400);

  const body = (await c.req.json()) as { kind?: unknown; repoKey?: unknown; branch?: unknown };
  const kind = String(body.kind ?? '');
  if (!JOB_KINDS.has(kind)) return c.json({ error: `there is no "${kind}" to ask for` }, 400);

  if (kind === 'brief') {
    dispatchWork('brief', { kind: 'fleet' });
    return c.json({ ok: true });
  }

  if (typeof body.repoKey !== 'string' || typeof body.branch !== 'string') {
    return c.json({ error: 'repoKey and branch are required' }, 400);
  }
  // Only a branch this read is carrying: a request against something that does not exist
  // would sit on the board for ever waiting for a subject that never arrives.
  const branch = snapshot.branches.find((b) => b.repoKey === body.repoKey && b.name === body.branch);
  if (!branch) return c.json({ error: 'no such branch in this read' }, 400);
  const refused = cannotAsk(kind as JobKind, branch);
  if (refused) return c.json({ error: refused }, 400);

  dispatchWork(kind as 'summarise' | 'draft-vision' | 'assess', {
    kind: 'branch',
    repoKey: body.repoKey,
    branch: body.branch,
  });
  return c.json({ ok: true });
});

/**
 * Try a parked job again. The only write the board surface has: everything else about the
 * board is derived, so there is nothing else to change.
 */
api.post('/work/retry', async (c) => {
  const body = (await c.req.json()) as { id?: unknown };
  const id = String(body.id ?? '');
  if (!id) return c.json({ error: 'which job?' }, 400);
  if (!retryJob(id)) return c.json({ error: 'that job is no longer on the board' }, 400);
  return c.json({ ok: true });
});

api.delete('/settings/token', (c) => c.json(toSafe(saveSettings({ token: '' }))));
api.delete('/settings/llm-key', (c) => c.json(toSafe(saveSettings({ llmApiKey: '' }))));

/**
 * One question about the snapshot on screen. The desk (D84): it answers from what it can
 * see, may read how the fleet moved, and may put work on the board — through the same
 * door the page's own buttons use, so it can start nothing they could not.
 */
api.post('/ask', async (c) => {
  const snapshot = currentResponse().snapshot;
  if (!snapshot) return c.json({ error: 'nothing has been read from GitHub yet' }, 400);
  try {
    const body = (await c.req.json()) as { question?: unknown };
    const settings = loadSettings();
    const answer = await ask(snapshot, String(body.question ?? ''), settings, {
      // Built per answer, around the snapshot on screen — the only door to a change (D94).
      act: (turn, words) => doorFor(snapshot, turn, words, settings.agentHistory),
    });
    return c.json({ answer });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/**
 * Start a new conversation. The advisor's memory is what was *said* — the state and Plane B
 * are untouched by this, and nothing on the page changes (D93).
 */
/** The conversation the server is still carrying, so a reload can show it (finding 6). */
api.get('/ask', (c) => c.json({ answers: thread(loadSettings().advisorMemoryMinutes) }));

// ---------------------------------------------------------------------------
// The agent's changes — the feed, and taking them back (D94, Q81)
// ---------------------------------------------------------------------------

/** Undo one change. Refused, with the reason, when it has been changed again since. */
api.post('/changes/:id/undo', (c) => {
  const result = undoChange(c.req.param('id'));
  if (result.ok) reapplyAll();
  return c.json(result, result.ok ? 200 : 409);
});

/** Undo everything one prompt changed. Reports each, so a partial undo says what stayed. */
api.post('/changes/undo-turn', async (c) => {
  const body = (await c.req.json()) as { turn?: unknown };
  if (typeof body.turn !== 'string') return c.json({ error: 'which answer?' }, 400);
  const results = undoTurn(body.turn);
  if (results.some((r) => r.ok)) reapplyAll();
  return c.json({ results });
});

/** Mark changes as looked at — some, or all. The dateline's count follows. */
api.post('/changes/seen', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : 'all';
  const marked = markSeen(ids);
  if (marked > 0) reapplyAll();
  return c.json({ marked });
});

api.delete('/ask', (c) => {
  forget();
  return c.json({ ok: true });
});

/**
 * Accepting a regrouping the advisor proposed. The only way a proposal becomes filing —
 * the answer itself writes nothing (D84). Checked again here against the read on screen:
 * a branch that has gone since the proposal was made is left out, not filed blind.
 */
api.post('/goals/regroup', async (c) => {
  const snapshot = currentResponse().snapshot;
  if (!snapshot) return c.json({ error: 'nothing has been read from GitHub yet' }, 400);
  try {
    const body = (await c.req.json()) as { groups?: unknown };
    if (!Array.isArray(body.groups)) return c.json({ error: 'groups are required' }, 400);
    const known = new Set(snapshot.branches.map((b) => refKey(b.repoKey, b.name)));
    const groups = body.groups
      .map((row) => {
        const item = row as { title?: unknown; branches?: unknown };
        const branches = (Array.isArray(item.branches) ? item.branches : [])
          .filter((b): b is { repoKey: string; branch: string } =>
            !!b && typeof (b as { repoKey?: unknown }).repoKey === 'string' && typeof (b as { branch?: unknown }).branch === 'string')
          .filter((b) => known.has(refKey(b.repoKey, b.branch)))
          .map((b) => ({ repoKey: b.repoKey, branch: b.branch }));
        return { title: typeof item.title === 'string' ? item.title : '', branches };
      })
      .filter((g) => g.title.trim() && g.branches.length > 0);
    // Accepting the agent's proposal is filing it through the same door, under the same
    // answer — so it lands in the feed and "undo all" on that answer takes it back.
    const turn = typeof (body as { turn?: unknown }).turn === 'string' ? (body as { turn: string }).turn : randomUUID();
    const door = doorFor(snapshot, turn, 'accepted the proposed filing', loadSettings().agentHistory);
    const byName = (ref: { repoKey: string; branch: string }) =>
      snapshot.branches.find((b) => b.repoKey === ref.repoKey && b.name === ref.branch)!;
    let moved = 0;
    for (const group of groups) {
      const branches = group.branches.map(byName);
      const result = group.title.trim().toLowerCase() === 'unfiled' ? door.unfile(branches) : door.file(group.title, branches);
      moved += result.done.filter((line) => !line.startsWith('Goal ')).length;
    }
    return c.json({ moved, changes: door.did(), goals: listGoals() });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/** The provider's own model list, so nobody has to guess a model ID. */
api.get('/llm/models', async (c) => {
  try {
    const settings = loadSettings();
    // ?raw=1 returns the untouched upstream payload. Open it in a browser when a model
    // is rejected — it shows exactly which key holds the real ID.
    if (c.req.query('raw')) return c.json(await fetchModelsRaw(settings));
    return c.json({ models: await listModels(settings) });
  } catch (err) {
    return c.json({ error: describe(err) }, 400);
  }
});

/** The page opens one of these and re-renders whenever the server says something moved. */
api.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    let alive = true;
    const queue: string[] = ['state'];
    let wake: (() => void) | null = null;

    const unsubscribe = subscribe((event) => {
      queue.push(event);
      wake?.();
    });

    stream.onAbort(() => {
      alive = false;
      unsubscribe();
      wake?.();
    });

    try {
      while (alive) {
        while (queue.length > 0 && alive) {
          await stream.writeSSE({ event: queue.shift()!, data: '1' });
        }
        if (!alive) break;
        // Wait for the next announcement, but wake periodically anyway so a dead
        // connection is noticed and a proxy does not time the stream out.
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 25_000).unref?.();
        });
        wake = null;
        if (alive && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '1' });
      }
    } finally {
      unsubscribe();
    }
  }),
);

/** The agent's door for one answer, around the snapshot on screen. */
function doorFor(snapshot: Snapshot, turn: string, words: string, keep: number) {
  return actionsFor({ snapshot, dispatch: dispatchWork, turn, words, keep, refresh: reapplyAll });
}

function describe(err: unknown): string {
  if (
    err instanceof GitHubError ||
    err instanceof LlmError ||
    err instanceof GoalError ||
    err instanceof VisionError
  ) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
