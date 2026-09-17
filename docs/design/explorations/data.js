/*
 * Sample data for the design explorations.
 *
 * This is a real `Snapshot` (shared/types.ts) with plausible values — the user's own
 * repos, real agent branch names, LLM titles/summaries where Stage 2 has run and nulls
 * where it has not. Every exploration renders THIS and computes nothing of its own
 * (CLAUDE.md rule 4), so if a design needs a fact that isn't here, that is a finding.
 *
 * Note the shape of the truth: these branches are pushed by agents and never checked
 * out. There are no uncommitted files, no stashes, no "left for lunch". What a branch
 * is doing has to be read off commits, PRs and CI — nothing else exists.
 */

const A = (repoKey, name, o) => ({
  repoKey, name,
  headSha: o.headSha, url: `https://github.com/${repoKey}/tree/${name}`,
  commits: (o.commits || []).map(([sha, message, author, authoredAt, body]) => ({
    sha, message, body: body || '', author, authoredAt,
    url: `https://github.com/${repoKey}/commit/${sha}`,
  })),
  ahead: o.ahead, behind: o.behind, lastActivity: o.lastActivity,
  diff: { files: o.files, additions: o.add, deletions: o.del },
  activity: o.activity || [],
  pr: o.pr || null,
  ci: { state: o.ci || 'none', url: o.ci && o.ci !== 'none' ? `https://github.com/${repoKey}/actions` : null },
  relevance: o.relevance || 'active',
  isBase: false,
  title: o.title || null,
  summary: o.summary || null,
  progress: o.progress || null,
  insight: o.evidence ? {
    evidence: o.evidence, model: 'deepseek-v4.1-flash', promptVersion: 'p3',
    generatedAt: '2026-09-17T13:40:11Z', headSha: o.headSha,
  } : null,
});

const SNAP = {
  generatedAt: '2026-09-17T13:42:08Z',
  warnings: ['greensand321/homelab — 404, check the token still covers it'],
  rateLimit: { limit: 5000, remaining: 4738, resetsAt: '2026-09-17T14:11:00Z' },
  llm: { enabled: true, pending: 3, errors: [] },
  repos: [
    { key: 'greensand321/repo_tracker', owner: 'greensand321', name: 'repo_tracker', defaultBranch: 'main', branchCount: 31, url: '#' },
    { key: 'greensand321/Project_Management', owner: 'greensand321', name: 'Project_Management', defaultBranch: 'main', branchCount: 22, url: '#' },
    { key: 'greensand321/kimi-mockups', owner: 'greensand321', name: 'kimi-mockups', defaultBranch: 'main', branchCount: 12, url: '#' },
    { key: 'greensand321/homelab', owner: 'greensand321', name: 'homelab', defaultBranch: 'main', branchCount: 18, url: '#' },
  ],
  branches: [

    A('greensand321/repo_tracker', 'claude/kind-meitner-cpis9v', {
      headSha: '9f3c2a17d', ahead: 23, behind: 0, lastActivity: '2026-09-17T13:22:40Z',
      files: 14, add: 1802, del: 310, ci: 'passing',
      activity: ['2026-09-14','2026-09-15','2026-09-16','2026-09-17'],
      title: 'Rebuilding the interface in the ledger language',
      summary: 'Extracted the logbook design language into a shared base and is building full interfaces on top of it. The engine underneath is untouched — this is entirely the front end.',
      progress: 'progressing', evidence: ['9f3c2a1', '4b81e07', 'c2d9a44'],
      commits: [
        ['9f3c2a17d', 'extract the ledger design language into base.css', 'claude', '2026-09-17T13:22:40Z', 'Five things make it work; the header comment names them so a later revision cannot quietly lose one.'],
        ['4b81e07aa', 'sample snapshot for the design explorations', 'claude', '2026-09-17T12:58:02Z'],
        ['c2d9a446f', 'probe: can this model call a tool?', 'claude', '2026-09-16T22:14:51Z', 'Two calls, a few hundred tokens, before anything is built on the assumption.'],
        ['71ae0b923', 'agent plan — jobs, tool catalogue, cost ceilings', 'claude', '2026-09-16T19:02:33Z'],
        ['e84f1cc70', 'no-store on /app.js, and fail loudly instead of silently', 'claude', '2026-09-16T10:40:12Z', 'A stale bundle against fresh HTML is what bricked settings. Never again quietly.'],
      ],
    }),

    A('greensand321/repo_tracker', 'claude/ecstatic-hopper-bwbbdt', {
      headSha: '1d70b93ce', ahead: 41, behind: 2, lastActivity: '2026-09-17T09:05:19Z',
      files: 26, add: 2941, del: 688, ci: 'failing',
      pr: { number: 7, title: 'Stage 2: the advisor engine', state: 'open', draft: false, url: '#' },
      activity: ['2026-09-11','2026-09-12','2026-09-13','2026-09-15','2026-09-16','2026-09-17'],
      title: 'The advisor engine, stuck on one provider gate',
      summary: 'Summaries work end to end against OpenCode Go. CI has been red for two days on a single test that reaches the real provider — it needs a stub, not a fix to the engine.',
      progress: 'blocked', evidence: ['1d70b93', 'a09e6d4'],
      commits: [
        ['1d70b93ce', 'send x-opencode-session on every provider call', 'claude', '2026-09-17T09:05:19Z', 'Mandatory since 6 Sep. One session id per enrichment run.'],
        ['a09e6d411', 'go and zen are different base urls', 'claude', '2026-09-16T20:33:07Z'],
        ['33c5e0a8b', 'guess the protocol, then remember what worked', 'claude', '2026-09-15T18:21:44Z', 'Three protocols behind one key. Memoise per model so we pay the guess once.'],
        ['fd21c7e69', 'prefer id-shaped values from /models', 'claude', '2026-09-15T11:09:58Z', 'Falling back to the display name sent "Big Pickle" as a model id.'],
        ['70bb1e224', 'validate cited SHAs against the branch', 'claude', '2026-09-12T16:44:20Z'],
      ],
    }),

    A('greensand321/repo_tracker', 'gui-updates', {
      headSha: '5a2ef0c8b', ahead: 6, behind: 11, lastActivity: '2026-09-13T17:48:03Z',
      files: 4, add: 221, del: 96, ci: 'none',
      activity: ['2026-09-12','2026-09-13'],
      title: 'A custom dropdown, half-finished',
      summary: 'Replaces the native select with a searchable picker. Six commits, then nothing for four days; the branch is now eleven behind and the picker has since been rebuilt elsewhere.',
      progress: 'stalled', evidence: ['5a2ef0c'],
      commits: [
        ['5a2ef0c8b', 'keyboard nav in the picker', 't3', '2026-09-13T17:48:03Z'],
        ['b1c94d02f', 'filter as you type', 't3', '2026-09-13T15:02:11Z'],
        ['9083ba71d', 'first pass at a custom dropdown', 't3', '2026-09-12T21:30:44Z', 'The built-in one really is unusable at 100 models.'],
      ],
    }),

    A('greensand321/repo_tracker', 'claude/wonderful-turing-okarul', {
      headSha: '2c60d94a1', ahead: 9, behind: 0, lastActivity: '2026-09-15T14:11:52Z',
      files: 7, add: 512, del: 40, ci: 'passing',
      pr: { number: 5, title: 'Dated snapshots from day one', state: 'merged', draft: false, url: '#' },
      activity: ['2026-09-14','2026-09-15'],
      title: 'Dated snapshots, merged',
      summary: 'Writes a dated copy of every snapshot to disk. Nothing reads them yet — they exist because "what changed and by how much" cannot be reconstructed after the fact.',
      progress: 'done', evidence: ['2c60d94'],
      commits: [
        ['2c60d94a1', 'write a dated snapshot on every collect', 'claude', '2026-09-15T14:11:52Z', 'D31. Nothing reads these yet. Skip it and the feature becomes impossible, not merely unbuilt.'],
        ['ea71f3b08', 'snapshot store, keyed by day', 'claude', '2026-09-15T11:40:03Z'],
        ['77d1c6e4a', 'temp dir for tests so we never touch real data/', 'claude', '2026-09-14T22:18:31Z'],
      ],
    }),

    A('greensand321/Project_Management', 'claude/vibrant-lovelace-q2m4rf', {
      headSha: 'b3f81ae60', ahead: 17, behind: 3, lastActivity: '2026-09-17T08:14:27Z',
      files: 11, add: 940, del: 122, ci: 'pending',
      pr: { number: 12, title: 'Milestone → goal → task', state: 'open', draft: true, url: '#' },
      activity: ['2026-09-14','2026-09-16','2026-09-17'],
      title: 'The milestone → goal → task schema',
      summary: 'Lays out the three-level structure with one task per branch. The schema is settled; the migration that backfills existing goals is written but not yet run.',
      progress: 'progressing', evidence: ['b3f81ae', '0e4c7d9'],
      commits: [
        ['b3f81ae60', 'backfill migration for existing goals', 'claude', '2026-09-17T08:14:27Z'],
        ['0e4c7d955', 'one task per branch, enforced at write time', 'claude', '2026-09-16T17:55:14Z'],
        ['cc019f236', 'milestone/goal/task tables', 'claude', '2026-09-14T13:21:09Z'],
      ],
    }),

    A('greensand321/Project_Management', 'claude/serene-hopper-4kd8xz', {
      headSha: '48ba01f7c', ahead: 12, behind: 8, lastActivity: '2026-09-08T19:33:40Z',
      files: 9, add: 604, del: 71, ci: 'passing', relevance: 'quiet',
      activity: ['2026-09-06','2026-09-07','2026-09-08'],
      title: 'A Supabase sync spike, parked',
      summary: 'Proves two machines can share Plane B through Supabase. It works; it stopped because the schema it syncs was still moving. Worth resuming once the schema above lands.',
      progress: 'stalled', evidence: ['48ba01f'],
      commits: [
        ['48ba01f7c', 'two-way sync, last-write-wins', 'claude', '2026-09-08T19:33:40Z', 'Good enough for one person on two machines. Not good enough for more.'],
        ['3fd7e0c14', 'row-level security on the notes table', 'claude', '2026-09-07T14:02:55Z'],
      ],
    }),

    A('greensand321/kimi-mockups', 'claude/lucid-noether-77gqla', {
      headSha: '6e2d47b09', ahead: 4, behind: 0, lastActivity: '2026-09-11T10:27:14Z',
      files: 3, add: 188, del: 205, ci: 'none', relevance: 'quiet',
      activity: ['2026-09-10','2026-09-11'],
      title: 'Typography pass on the ledger mockups',
      summary: 'Tightens the measure and settles on Fraunces for display. This is where the design language the dashboard now uses actually came from.',
      progress: 'done', evidence: ['6e2d47b'],
      commits: [
        ['6e2d47b09', 'Fraunces for display, JetBrains for facts', 'claude', '2026-09-11T10:27:14Z'],
        ['81c0a9f3d', 'tighter measure — 72ch reads better than 90', 'claude', '2026-09-10T16:50:02Z'],
      ],
    }),

    A('greensand321/kimi-mockups', 't3/export-svg', {
      headSha: 'df90c1a25', ahead: 2, behind: 6, lastActivity: '2026-09-04T12:00:00Z',
      files: 2, add: 64, del: 9, ci: 'none', relevance: 'quiet',
      activity: ['2026-09-04'],
      commits: [
        ['df90c1a25', 'export each variant as svg', 't3', '2026-09-04T12:00:00Z'],
        ['4470e18bc', 'wip', 't3', '2026-09-04T11:12:40Z'],
      ],
    }),

    A('greensand321/homelab', 'claude/bold-galois-x8ftyq', {
      headSha: '7b1c05e3f', ahead: 3, behind: 14, lastActivity: '2026-08-27T09:41:00Z',
      files: 5, add: 130, del: 44, ci: 'failing', relevance: 'quiet',
      activity: ['2026-08-26','2026-08-27'],
      title: 'Backup cron that never got finished',
      summary: 'Three weeks untouched, fourteen behind, and CI has been red the whole time. Either finish it or cut it — the rebase only gets worse from here.',
      progress: 'stalled', evidence: ['7b1c05e'],
      commits: [
        ['7b1c05e3f', 'nightly restic snapshot', 'claude', '2026-08-27T09:41:00Z'],
      ],
    }),

    A('greensand321/repo_tracker', 'main', {
      headSha: '0aa47c11e', ahead: 0, behind: 0, lastActivity: '2026-09-15T20:00:00Z',
      files: 0, add: 0, del: 0, ci: 'passing',
      commits: [['0aa47c11e', 'requirements.md replaces the spec', 'greensand321', '2026-09-15T20:00:00Z']],
    }),
  ],
};
SNAP.branches.find(b => b.name === 'main').isBase = true;

/* --- derived views. Pure functions over the snapshot; no view computes its own facts. --- */

const NOW = new Date('2026-09-17T13:42:08Z');
const threads = () => SNAP.branches.filter(b => !b.isBase);
const active = () => threads().filter(b => b.relevance === 'active');
const quiet  = () => threads().filter(b => b.relevance === 'quiet');
const repoOf = k => SNAP.repos.find(r => r.key === k);
const shortRepo = k => k.split('/')[1];
const byRecency = (a, b) => new Date(b.lastActivity) - new Date(a.lastActivity);

function age(iso) {
  if (!iso) return 'never';
  const mins = Math.round((NOW - new Date(iso)) / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.round(hrs / 24) + 'd';
}
function ageLong(iso) {
  if (!iso) return 'never';
  const d = Math.floor((NOW - new Date(iso)) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 21) return d + ' days ago';
  return Math.floor(d / 7) + ' weeks ago';
}
const clock = iso => new Date(iso).toISOString().slice(11, 16);
const dayKey = iso => iso.slice(0, 10);
const DAYNAME = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dayLabel(key) {
  const d = new Date(key + 'T12:00:00Z');
  const diff = Math.round((new Date(NOW.toISOString().slice(0,10) + 'T12:00:00Z') - d) / 86400000);
  const date = `${DAYNAME[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (diff === 0) return ['Today', date];
  if (diff === 1) return ['Yesterday', date];
  return [date, diff + ' days ago'];
}

/** Every commit from every branch, interleaved and grouped by day. The day book's spine. */
function events() {
  const out = [];
  for (const b of threads()) {
    for (const c of b.commits) out.push({ at: c.authoredAt, kind: 'commit', branch: b, commit: c });
    if (b.ci.state === 'failing') out.push({ at: b.lastActivity, kind: 'ci', branch: b, text: 'CI is red on this head' });
    if (b.pr && b.pr.state === 'merged') out.push({ at: b.lastActivity, kind: 'pr', branch: b, text: `PR #${b.pr.number} merged — ${b.pr.title}` });
    if (b.pr && b.pr.state === 'open') out.push({ at: b.lastActivity, kind: 'pr', branch: b, text: `PR #${b.pr.number} open${b.pr.draft ? ' (draft)' : ''} — ${b.pr.title}` });
  }
  return out.sort((x, y) => new Date(y.at) - new Date(x.at));
}
function days() {
  const map = new Map();
  for (const e of events()) {
    const k = dayKey(e.at);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return [...map.entries()];
}

/** The one thread that is happening NOW. Teal appears here and nowhere else. */
const nowThread = () => active().sort(byRecency)[0];

const counts = () => ({
  repos: SNAP.repos.length,
  branches: threads().length,
  active: active().length,
  quiet: quiet().length,
  failing: threads().filter(b => b.ci.state === 'failing').length,
  open: threads().filter(b => b.pr && b.pr.state === 'open').length,
  commits: threads().reduce((n, b) => n + b.commits.length, 0),
  folded: SNAP.repos.reduce((n, r) => n + r.branchCount, 0) - SNAP.branches.length,
});

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
