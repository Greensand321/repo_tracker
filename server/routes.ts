/** The HTTP surface. Thin: parse, call, respond. No logic lives here. */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { Settings } from '../shared/types.ts';
import { GitHubError, splitRepoKey, verifyToken } from './github.ts';
import { loadSettings, saveSettings, toSafe } from './settings.ts';
import { currentResponse, refresh, startPolling, subscribe } from './state.ts';

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

  if (typeof body.token === 'string' && body.token.trim()) {
    const token = body.token.trim();
    try {
      await verifyToken(token);
    } catch (err) {
      // Reject a bad token at the door rather than storing it and failing later in a
      // way that looks like the repos are broken.
      return c.json({ error: describe(err) }, 400);
    }
    patch.token = token;
  }

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

  for (const key of ['refreshSeconds', 'quietAfterDays', 'commitsPerBranch'] as const) {
    if (body[key] !== undefined) patch[key] = Number(body[key]);
  }

  const saved = saveSettings(patch);
  // Settings changed what or how often we fetch, so restart the loop rather than
  // waiting out the old interval.
  startPolling();
  return c.json(toSafe(saved));
});

api.delete('/settings/token', (c) => c.json(toSafe(saveSettings({ token: '' }))));

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

function describe(err: unknown): string {
  if (err instanceof GitHubError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
