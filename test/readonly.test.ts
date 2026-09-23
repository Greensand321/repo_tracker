/**
 * Plane A is read-only forever — enforced by structure, not by the prompt (D94).
 *
 * A prompt is a request, not a guarantee: a model told "don't push" still holds whatever
 * tools it was given. So the guarantee is that there is nothing to give it. These fail the
 * build the moment any code could write to GitHub or run git.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const server = sources(join(ROOT, 'server'));
const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('only one file talks to GitHub, and it only ever reads', () => {
  const talkers = server.filter((path) => /api\.github\.com|github\.com\/repos/.test(code(path)));
  assert.deepEqual(talkers.map((p) => p.slice(ROOT.length)), ['server/github.ts']);
  // No request in it sets a method, so every one is a GET.
  assert.doesNotMatch(code(join(ROOT, 'server/github.ts')), /\bmethod\s*:/);
});

test('nothing runs git, or any program but the browser opener', () => {
  for (const path of server) {
    const src = code(path);
    const rel = path.slice(ROOT.length);
    assert.doesNotMatch(src, /simple-git|isomorphic-git|nodegit|@octokit/, `${rel} imports a git library`);
    if (rel === 'server/main.ts') continue;
    assert.doesNotMatch(src, /child_process|\bspawn\(|\bexec\(|\bexecSync\(|\bexecFile/, `${rel} runs a program`);
  }
  const main = code(join(ROOT, 'server/main.ts'));
  assert.equal((main.match(/\bspawn\(/g) ?? []).length, 1, 'main.ts spawns exactly one thing: the browser');
});

test('no dependency could write to a repo', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
  const deps = Object.keys({ ...pkg['dependencies'], ...pkg['devDependencies'] });
  for (const dep of deps) assert.doesNotMatch(dep, /git|octokit/, `${dep} is a git or GitHub client`);
});

test('the advisor\'s changes go through one door, and no tool can reach a store directly', () => {
  // The boundary itself — building a context, binding a reader — is allowed to know the
  // settings module, to strip the secrets out of what it hands on (D77). No tool is.
  const boundary = new Set(['context.ts', 'evidence.ts', 'types.ts']);
  for (const path of sources(join(ROOT, 'server/tools'))) {
    if (boundary.has(path.split('/').pop()!)) continue;
    const src = code(path);
    const rel = path.slice(ROOT.length);
    assert.doesNotMatch(src, /from '\.\.\/(goals|vision|settings)\.ts'/, `${rel} imports a store; tools change things only through ctx.act`);
    assert.doesNotMatch(src, /saveSettings|writeJson|writeFileSync/, `${rel} writes directly`);
  }
});
