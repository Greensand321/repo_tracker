/**
 * A debug surface, not a product surface.
 *
 * CLAUDE.md rule 2 is "GUI only ... a command-line entry point may exist for debugging;
 * nothing is shaped by it." This is that entry point. It exists so the engine can be
 * exercised and read while the real interface is being redesigned — no feature should
 * ever be designed around it, and nothing here is part of the product.
 *
 *   npm run brief          collect, summarise, and print every branch
 *   npm run brief -- --no-llm    deterministic only, no provider calls
 *   npm run models         list the models your provider actually offers
 *   npm run config         show settings, with secrets redacted
 *   npm run probe          can this model do tool calling? (see docs/plans/agent-plan.md)
 */

import { listModels } from './advise/client.ts';
import { probeTools, type ProbeOutcome } from './advise/probe.ts';
import { applyCached, llmReady } from './advise/enrich.ts';
import { applyAssist } from './advise/assist.ts';
import { applyGoals } from './goals.ts';
import { runBoard } from './work/run.ts';
import { collect } from './collect.ts';
import { loadSettings } from './settings.ts';
import type { Branch, Settings, Snapshot } from '../shared/types.ts';

const useColour = process.stdout.isTTY && process.env['NO_COLOR'] === undefined;
const paint = (code: string, text: string): string =>
  useColour ? `[${code}m${text}[0m` : text;

const dim = (t: string) => paint('2', t);
const bold = (t: string) => paint('1', t);
const brass = (t: string) => paint('33', t);
const green = (t: string) => paint('32', t);
const red = (t: string) => paint('31', t);
const blue = (t: string) => paint('34', t);

async function main(): Promise<number> {
  const [command = 'brief', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'brief':
      return brief(rest.includes('--no-llm'));
    case 'models':
      return models();
    case 'config':
      return config();
    case 'probe':
      return probe();
    default:
      console.error(`unknown command "${command}" — try: brief | models | config | probe`);
      return 2;
  }
}

async function brief(noLlm: boolean): Promise<number> {
  const settings = loadSettings();
  if (!settings.token) return complain('No GitHub token set. Open the app and add one in settings.');
  if (settings.repos.length === 0) return complain('No repos configured.');

  process.stderr.write(dim(`reading ${settings.repos.length} repo(s) from GitHub…\n`));
  const snapshot = await collect(settings);
  applyGoals(snapshot);
  applyCached(snapshot, settings);
  applyAssist(snapshot, settings);

  if (!noLlm && llmReady(settings)) {
    process.stderr.write(dim(`working the board with ${settings.llmModel}…\n`));
    const result = await runBoard(snapshot, settings);
    process.stderr.write(dim(`${result.done} job(s) done\n`));
    if (result.failed > 0) {
      process.stderr.write(red(`\n${result.failed} failure(s):\n`));
      for (const error of result.errors) process.stderr.write(red(`  ${error}\n`));
      process.stderr.write('\n');
    }
  } else if (!noLlm && !llmReady(settings)) {
    process.stderr.write(dim(whyNotReady(settings) + '\n'));
  }

  print(snapshot);
  return 0;
}

function print(snapshot: Snapshot): void {
  const threads = snapshot.branches.filter((b) => !b.isBase);
  const active = threads.filter((b) => b.relevance === 'active');
  const quiet = threads.filter((b) => b.relevance === 'quiet');

  console.log('');
  console.log(bold('BEARING') + dim(`  ·  ${new Date(snapshot.generatedAt).toLocaleString()}`));
  console.log(
    dim(
      `${snapshot.repos.length} repos · ${threads.length} branches · ` +
        `${active.length} active · ${threads.reduce((n, b) => n + b.commits.length, 0)} commits`,
    ),
  );

  for (const warning of snapshot.warnings) console.log(red(`  ! ${warning}`));

  section('ACTIVE', active);
  if (quiet.length > 0) section(`GONE QUIET (${quiet.length})`, quiet);

  if (snapshot.llm.enabled && snapshot.llm.pending > 0) {
    console.log(dim(`\n${snapshot.llm.pending} branch(es) still without a summary.`));
  }
  console.log('');
}

function section(title: string, branches: Branch[]): void {
  if (branches.length === 0) return;
  console.log('');
  console.log(dim('── ') + bold(title) + dim(' ' + '─'.repeat(Math.max(0, 62 - title.length))));
  for (const branch of branches) printBranch(branch);
}

function printBranch(branch: Branch): void {
  const repo = branch.repoKey.split('/')[1] ?? branch.repoKey;
  console.log('');
  console.log(`  ${brass(repo)}${dim(' / ')}${bold(branch.name)}  ${dim(age(branch.lastActivity))}`);

  // The LLM title when there is one; otherwise the newest commit message, which is the
  // most informative true sentence available.
  const headline = branch.title ?? branch.commits[0]?.message ?? '(nothing of its own)';
  console.log(`    ${branch.title ? blue(headline) : headline}${branch.title ? dim('  ← generated') : ''}`);

  if (branch.summary) {
    for (const line of wrap(branch.summary, 74)) console.log(dim(`    ${line}`));
  }

  const bits: string[] = [`↑${branch.ahead} ↓${branch.behind}`, `${branch.commits.length} commits`];
  if (branch.progress) bits.push(progressLabel(branch.progress));
  if (branch.ci.state !== 'none') {
    bits.push(branch.ci.state === 'failing' ? red(`CI ${branch.ci.state}`) : `CI ${branch.ci.state}`);
  }
  if (branch.pr) bits.push(`PR #${branch.pr.number} ${branch.pr.state}`);
  console.log(dim(`    ${bits.join('  ·  ')}`));

  if (branch.insight && branch.insight.evidence.length > 0) {
    console.log(dim(`    from ${branch.insight.evidence.join(', ')}`));
  }
}

function progressLabel(progress: NonNullable<Branch['progress']>): string {
  if (progress === 'blocked') return red('blocked');
  if (progress === 'done') return green('done');
  if (progress === 'stalled') return brass('stalled');
  return green('progressing');
}

async function models(): Promise<number> {
  const settings = loadSettings();
  if (!settings.llmApiKey) return complain('No provider API key set.');

  const found = await listModels(settings);
  console.log(`\n${found.length} model(s) at ${settings.llmBaseUrl}\n`);
  for (const model of found) {
    const marker = model.id === settings.llmModel ? green(' ← in use') : '';
    console.log(`  ${model.id}${model.name ? dim(`  (${model.name})`) : ''}${marker}`);
  }
  console.log(dim('\nSet one in settings, or in data/settings.json as "llmModel".\n'));
  return 0;
}

/**
 * Answers the one question the agent plan rests on, before anything is built on it.
 * Two provider calls, a few hundred tokens.
 */
async function probe(): Promise<number> {
  const settings = loadSettings();
  if (!settings.llmApiKey) return complain('No provider API key set.');
  if (!settings.llmModel) return complain('No model chosen — run `npm run models` first.');

  process.stderr.write(dim(`asking ${settings.llmModel} to call a tool…\n`));
  const result = await probeTools(settings);

  const mark = (outcome: ProbeOutcome): string =>
    outcome === 'works' ? green('✓ works') : outcome === 'unsupported' ? red('✗ unsupported') :
    outcome === 'wrong-shape' ? brass('~ wrong shape') : red('✗ error');

  console.log('');
  console.log(`  ${bold(result.model)} ${dim(`at ${result.baseUrl}`)}`);
  console.log(dim(`  speaking the ${result.protocol} API\n`));
  console.log(`  native tool calling   ${mark(result.native.outcome)}`);
  console.log(dim(`                        ${result.native.detail}`));
  console.log(`  JSON protocol         ${mark(result.jsonProtocol.outcome)}`);
  console.log(dim(`                        ${result.jsonProtocol.detail}`));
  console.log('');
  console.log(`  ${bold('→')} ${result.recommendation}`);
  console.log('');

  return result.native.outcome === 'works' || result.jsonProtocol.outcome === 'works' ? 0 : 1;
}

function config(): number {
  const settings = loadSettings();
  console.log('');
  console.log(`  repos              ${settings.repos.join(', ') || dim('(none)')}`);
  console.log(`  github token       ${settings.token ? green('set') : red('not set')}`);
  console.log(`  refresh            ${settings.refreshSeconds}s`);
  console.log(`  quiet after        ${settings.quietAfterDays} days`);
  console.log(`  commits per branch ${settings.commitsPerBranch}`);
  console.log('');
  console.log(`  advisor            ${settings.llmEnabled ? 'enabled' : dim('disabled')}`);
  console.log(`  provider           ${settings.llmBaseUrl}`);
  console.log(`  provider key       ${settings.llmApiKey ? green('set') : red('not set')}`);
  console.log(`  model              ${settings.llmModel || red('not chosen')}`);
  console.log(`  calls per read     ${settings.llmMaxPerRun}`);
  console.log(`  jobs at once       ${settings.workers}`);
  console.log(
    `  lookups            ${settings.toolsEnabled ? `on, up to ${settings.toolCallsPerJob} a job` : 'off'}`,
  );
  console.log('');
  if (!llmReady(settings)) console.log(dim(`  ${whyNotReady(settings)}\n`));
  return 0;
}

function whyNotReady(settings: Settings): string {
  if (!settings.llmEnabled) return 'Advisor is switched off — no summaries.';
  if (!settings.llmApiKey) return 'No provider API key — no summaries. Add one in settings.';
  if (!settings.llmModel) return 'No model chosen — run `npm run models` to see what is available.';
  return 'Advisor ready.';
}

function complain(message: string): number {
  console.error(red(message));
  return 2;
}

function age(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  });
