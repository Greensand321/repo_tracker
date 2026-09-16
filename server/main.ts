/**
 * Starts Bearing: bundle the page, serve it, open the browser, begin refreshing.
 *
 * This is the "program behind the page" (D20). It holds the GitHub token, which is
 * the whole reason a plain HTML file could not do this job.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { bundleClient } from './bundle.ts';
import { WEB_DIR, ensureDirs } from './paths.ts';
import { api } from './routes.ts';
import { startPolling } from './state.ts';

const DEFAULT_PORT = 4321;
const HOST = '127.0.0.1'; // never bind beyond this machine

async function main(): Promise<void> {
  ensureDirs();

  const clientJs = await bundleClient();
  const app = new Hono();

  app.route('/api', api);

  app.get('/app.js', (c) => c.body(clientJs, 200, { 'content-type': 'text/javascript; charset=utf-8' }));
  app.get('/app.css', (c) =>
    c.body(readFileSync(join(WEB_DIR, 'app.css'), 'utf8'), 200, {
      'content-type': 'text/css; charset=utf-8',
    }),
  );
  // Any other path serves the page; the view lives in the URL hash, so there is
  // nothing for the server to route.
  app.get('*', (c) =>
    c.html(readFileSync(join(WEB_DIR, 'index.html'), 'utf8')),
  );

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const url = `http://${HOST}:${port}`;

  serve({ fetch: app.fetch, hostname: HOST, port }, () => {
    console.log(`Bearing is running at ${url}`);
    if (process.env['BEARING_NO_OPEN'] !== '1') openBrowser(url);
  });

  startPolling();
}

/** Best-effort. If it fails, the URL is on stdout and nothing is lost. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Nothing to do: the address is already printed.
  }
}

main().catch((err: unknown) => {
  console.error('Bearing failed to start:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
