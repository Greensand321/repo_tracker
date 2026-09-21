/*
 * Four branch states, shaped like `shared/types.ts`. Every design on the page renders
 * these and computes nothing of its own (rule 4).
 *
 * Three fields are NOT in the Snapshot today and are marked wherever a design uses them:
 *   state  — the one word the block leads with. Derivable from assessment + ci + pr.
 *   gist   — one CLAUSE (not a sentence) saying what the work is, with no identifiers.
 *   next   — the one thing left, or null. Today's `recap.open` with the non-finding removed.
 * They are the upstream change the page argues for; see the footer.
 */

const BRANCHES = [
  {
    id: 'fin',
    tab: 'Finished, matches',
    repo: 'Greensand321/Project_Management',
    name: 'claude/affectionate-davinci-vlzdbq',
    title: 'Financials chapter row shows only project name',
    ahead: 1, behind: 4, age: 'just now',
    goal: 'Financials panel cleanup',
    vision: {
      text: 'Make the financials chapter panel a clean project picker: each row shows only the project name (current one bold), with the full number and name in a tooltip, and frost styling neutral rather than blue.',
      proposed: true,
    },
    recap: {
      last: 'The newest commit simplified the financials chapter row to display just the project name, with the full number and name kept as a tooltip.',
      done: 'Pull request #630 merged, delivering the simplified chapter row that removes repeated project number, client, and task-order count noise.',
      open: 'Nothing looks unfinished.',
    },
    assessment: {
      verdict: 'done',
      because: 'The commit and merged PR deliver exactly the stated purpose: rows show only the project name (current bold) with the full number and name in a tooltip, and the frost styling is neutral rather than blue.',
      looked: ['after reading the branches next to it'],
    },
    pr: { number: 630, state: 'merged' },
    ci: 'passing',
    // --- not in the Snapshot yet ---
    state: 'done',
    gist: 'trimmed the financials chapter rows to just the project name, number and client moved into a tooltip',
    next: null,
  },
  {
    id: 'hooks',
    tab: 'Mid-flight, something open',
    repo: 'Greensand321/repo_tracker',
    name: 'claude/vigilant-hopper-8kq2mx',
    title: 'Retry queue for dropped webhook deliveries',
    ahead: 14, behind: 2, age: '3 hours ago',
    goal: 'Webhooks survive an outage',
    vision: {
      text: 'A webhook that fails is retried on a backoff until it lands or is given up on, and nothing is lost in between.',
      proposed: false,
    },
    recap: {
      last: 'The newest commits added the backoff schedule and the queue table, wiring the dispatcher to enqueue a delivery when the first attempt fails.',
      done: 'The queue table, its migration, and the backoff calculation are complete and covered by tests.',
      open: 'The drain worker is a stub: it reads the queue and logs, but never re-sends, and CI has been red since that commit.',
    },
    assessment: {
      verdict: 'on-track',
      because: 'Everything so far builds toward the retry path described, with the last step not yet written.',
      looked: [],
    },
    pr: { number: 118, state: 'open', draft: true },
    ci: 'failing',
    state: 'working',
    gist: 'building the retry queue for failed webhook deliveries — table, backoff and enqueue are in',
    next: 'the drain worker never actually re-sends, and CI is red because of it',
  },
  {
    id: 'drift',
    tab: 'Drifted',
    repo: 'Greensand321/Project_Management',
    name: 'claude/patient-lovelace-7fd0aa',
    title: 'Invoice export rewritten around a new PDF renderer',
    ahead: 31, behind: 9, age: '2 days ago',
    goal: null,
    vision: {
      text: 'Fix the invoice export so the totals column lines up when a line item wraps onto two lines.',
      proposed: false,
    },
    recap: {
      last: 'The newest commits replaced the PDF renderer wholesale and began porting every template onto it.',
      done: 'The new renderer is in and four of the nine templates are ported.',
      open: 'Five templates are unported and the original wrapping bug is untouched.',
    },
    assessment: {
      verdict: 'drifted',
      because: 'It is replacing the PDF renderer and porting templates, not fixing the totals column alignment it was started for.',
      looked: ['after reading the branches next to it'],
    },
    pr: null,
    ci: 'passing',
    state: 'drifted',
    gist: 'replacing the whole PDF renderer and porting templates onto it',
    next: 'the wrapping bug it was started for is still untouched',
  },
  {
    id: 'thin',
    tab: 'Nobody has said what it is for',
    repo: 'Greensand321/repo_tracker',
    name: 'claude/curious-bohr-2p91zz',
    title: null,
    ahead: 3, behind: 0, age: '6 days ago',
    goal: null,
    vision: null,
    recap: {
      last: 'The newest commits added a settings panel section and two unused toggles under it.',
      done: 'Nothing has landed.',
      open: 'Both toggles are wired to nothing, and the last commit reads like a step.',
    },
    assessment: null,
    pr: null,
    ci: 'none',
    state: 'quiet',
    gist: 'added a settings section with two toggles that are wired to nothing',
    next: 'the toggles do nothing yet',
  },
];
