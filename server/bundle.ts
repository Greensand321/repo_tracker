/**
 * Bundles the browser code with esbuild, in-process, on startup.
 *
 * No separate dev server and no build step to remember: `tsx watch` restarts the
 * server when anything changes, and the bundle is rebuilt in a few milliseconds as
 * part of that. One command, one process.
 */

import { build } from 'esbuild';
import { join } from 'node:path';

import { WEB_DIR } from './paths.ts';

export async function bundleClient(): Promise<string> {
  const result = await build({
    entryPoints: [join(WEB_DIR, 'main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: 'inline',
    write: false,
    logLevel: 'silent',
  });

  const output = result.outputFiles?.[0];
  if (!output) throw new Error('esbuild produced no output for web/main.ts');
  return output.text;
}
