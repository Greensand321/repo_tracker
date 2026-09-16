# Stage 1 — Get the git history on screen

**Written:** 16 Sep 2026 · **Status:** ready to build · **Requirements:** [`../requirements.md`](../requirements.md)

The proof that this can work at all:

> *"If exactly one thing worked a week from now it would be having the git logs show up in
> the mockups I created — all of the descriptions from the commits, time, etc."*

**Done means:** you click a shortcut, the dashboard opens, and every branch across your
repos shows its real commit history in the authors' own words. No LLM yet.

---

## 1. The stack (decided 16 Sep 2026)

**A local program + a browser UI, in TypeScript.**

```
   you click  ──►  start.bat  ──►  Node program (localhost)  ──►  browser opens
                                          │
                                          ├── holds the GitHub token (never in the browser)
                                          ├── calls the GitHub API
                                          ├── caches to disk  (data/cache/*.json)
                                          └── serves the UI + one JSON endpoint
```

| Piece | Choice | Why |
|---|---|---|
| Language | **TypeScript**, front and back | One language across the whole app; best GitHub and Supabase libraries |
| Runtime | **Node 22+** | Native `fetch`, native test runner, no extra tooling |
| Server | **Hono** | Tiny, properly typed, trivially replaced. Serves the UI and the API. |
| GitHub | **Octokit** (`@octokit/rest`) | Official and typed; handles pagination and rate limits so we do not |
| Front end | **Vite + vanilla TS** | The mockup is already vanilla HTML/CSS/JS — it lifts across almost directly, which is the fastest path to "it looks like the mockup". See the note in §7. |
| Cache | **JSON files on disk** | Inspectable, deletable, zero setup. Plane B gets a real database in Stage 4. |

**Why a program behind the page rather than a plain HTML file:** only a program can hold a
GitHub token safely, write a local backup, and call the API without the browser's
`file://` restrictions blocking it. Once a shortcut is pinned, clicking `start.bat` and
clicking `index.html` feel identical.

---

## 2. Layout

```
repo_tracker/
├── start.bat              ← what you click (and .sh for the other machine)
├── package.json
├── tsconfig.json
├── server/
│   ├── main.ts            starts the server, opens the browser
│   ├── routes.ts          GET /api/snapshot, POST /api/refresh, settings
│   ├── github.ts          ALL GitHub calls live here — the I/O boundary
│   ├── cache.ts           read/write data/cache/*.json, ETag bookkeeping
│   ├── settings.ts        load/save settings.json (repos, token, caps)
│   └── snapshot.ts        raw API data → Snapshot        (pure)
├── shared/
│   └── types.ts           the Snapshot types — imported by both sides
├── web/
│   ├── index.html         lifted from docs/design/dashboard-concept.html
│   ├── app.css            lifted from the same
│   ├── main.ts            fetch the Snapshot, render the views
│   └── views/             board.ts · needs.ts · timeline.ts · notes.ts
├── test/
│   ├── snapshot.test.ts   pure transforms, against recorded fixtures
│   └── fixtures/          recorded GitHub responses — no network in tests
└── data/                  gitignored: cache, settings, token
```

**The rule that keeps this testable:** `github.ts` and `cache.ts` touch the outside world.
`snapshot.ts` is pure — raw API payloads in, `Snapshot` out — and is where the tests live.

---

## 3. The canonical data structure

Everything renders this. If a view needs a fact, the fact goes in here — never computed in
the view.

```ts
type Snapshot = {
  generatedAt: string          // ISO-8601 UTC
  repos: Repo[]
  branches: Branch[]
  warnings: string[]           // "couldn't reach owner/repo" — shown, never thrown
}

type Repo = {
  key: string                  // "owner/name"
  owner: string
  name: string
  branchCount: number
}

type Branch = {
  repoKey: string
  name: string                 // the LITERAL git branch name. Always shown, always searchable.
  headSha: string
  url: string                  // straight to the branch on GitHub

  commits: Commit[]            // ONLY those ahead of main, newest first  ← the point of Stage 1
  ahead: number
  behind: number
  lastActivity: string         // ISO-8601 UTC; rendered as "2 days ago"
  diff: { files: number; additions: number; deletions: number }
  activity: string[]           // dates with commits — drives the mockup's `days[]` strip

  pr: { number: number; title: string; state: 'open'|'merged'|'closed'; draft: boolean; url: string } | null
  ci: { state: 'passing'|'failing'|'pending'|'none'; url: string | null }

  // Stage 2 fills these. Null in Stage 1 — the UI must render correctly with them absent.
  title: string | null         // LLM one-liner, shown ALONGSIDE `name`, marked as generated
  summary: string | null
  progress: 'progressing'|'stalled'|'blocked'|'done' | null
}

type Commit = {
  sha: string
  message: string              // the headline
  body: string                 // the rest, if any
  author: string
  authoredAt: string           // ISO-8601 UTC
  url: string
}
```

---

## 4. What fills the mockup

`docs/design/dashboard-concept.html` is the target. Its sample data maps like this — which
is also the honest answer to what Stage 1 will and will not show:

| Mockup field | Comes from | Stage |
|---|---|---|
| `project` / `projectKey` | repo | **1** |
| `path` (e.g. `feat-onboarding`) | `branch.name` | **1** |
| **`log[]`** — the commit trail | **`branch.commits`** | **1 ← the core of this stage** |
| `age` ("12m") | `lastActivity`, rendered relative | **1** |
| `commits` (count) | `commits.length` | **1** |
| `ci` | `ci.state` | **1** |
| `days[]` — the activity strip | `activity` | **1** |
| `feature` | PR title when there is one | **1** (LLM improves it in 2) |
| `rank` | ordering by recency + whether it needs attention | **1** (LLM improves it in 2) |
| `name` ("the signup flow") | LLM title | 2 |
| `status` (active / watch) | LLM judgement | 2 |
| `recall` · `blocker` · `next` | LLM | 2 |
| `steps[]` — the checklist | LLM | 2 |
| `needs` | derived, then LLM | 2 |
| `note` | you, in the GUI | 3 |

**So Stage 1 lights up the Board and Timeline views with real data.** The "Needs you" view
works on CI failures and PR state only. "Your notes" stays empty until Stage 3. Cards will
show the literal branch name and the commit trail where the mockup shows an invented title
and a written recall — that gap closes in Stage 2.

---

## 5. GitHub calls

Per repo:

| Purpose | Endpoint |
|---|---|
| Branch list + head SHAs | `GET /repos/{owner}/{repo}/branches` *(paginated)* |
| All PRs at once | `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100` |

Per branch:

| Purpose | Endpoint |
|---|---|
| **Commits ahead of main, plus ahead/behind, plus diff totals** | `GET /repos/{owner}/{repo}/compare/main...{branch}` |
| CI state | `GET /repos/{owner}/{repo}/commits/{headSha}/check-runs` |

`compare` is the key call — one request returns the commits unique to the branch, the
ahead/behind counts, and the diff size. Nothing else is needed for the commit trail.

**Budget.** 8 repos × ~5 branches ≈ 96 requests for a cold run, against an authenticated
limit of 5,000/hour. Warm runs are far cheaper: branch head SHAs are compared against the
cache, and only changed branches are re-fetched. ETags make unchanged responses return 304,
which does not count against the limit at all.

**Never crash on a repo.** A repo that 404s or errors produces a `warnings[]` entry and is
skipped. One unreachable repo must not cost you the other seven.

---

## 6. Build order

Each step ends somewhere visible.

1. **Scaffold + `start.bat`.** `npm run dev` starts the server and opens the browser to a
   page that says hello. Confirms the click-to-launch loop works before anything else.
2. **Settings + token.** A settings screen: paste a GitHub token, add repos as `owner/name`.
   Saved to `data/settings.json`, which is gitignored. Token never reaches the browser after
   it is saved.
3. **`github.ts` against one repo.** Fetch branches and dump raw JSON to a file. Prove auth
   and pagination work before any transform exists.
4. **`snapshot.ts` + tests.** Raw payloads → `Snapshot`. Recorded fixtures, no network in
   tests. This is where correctness is established.
5. **`GET /api/snapshot`.** Server returns a real Snapshot for the configured repos.
6. **Lift the mockup.** Copy `dashboard-concept.html` into `web/`, strip its sample data,
   keep its markup and CSS exactly.
7. **Render the Board view** from the Snapshot. **This is the moment the proof lands.**
8. **Timeline view**, then a Needs-you view driven by CI and PR state.
9. **Cache + incremental refresh.** Instant reopen; refresh button; "as of" timestamp.
10. **Second machine.** Clone, paste the token, confirm it works. Nothing to sync yet —
    all of this comes from GitHub.

**Step 7 is the milestone.** Everything after it is improvement; everything before it is
plumbing.

---

## 7. Decisions taken inside this plan

- **Vanilla TS on the front end, not React.** The mockup is vanilla, so it transplants
  directly instead of being reimplemented — and Stage 1 is precisely "make the mockup show
  real data." If the UI gets painful once goals and tags arrive in Stage 3, introducing a
  framework then is a contained change, because everything renders one data structure.
- **JSON files for the cache, not a database.** It is a disposable mirror of GitHub. Plane B
  gets a real database when there is Plane B data to store (Stage 4).
- **Only commits ahead of `main`.** A branch's full history is mostly `main`'s history and
  tells you nothing about the thread. `compare` gives exactly the commits that are this
  branch's own work.
- **Token in `data/`, gitignored, never synced to the cloud.** Each machine gets its own.

## 8. Still open — none of these block step 1

- **Q34 — auth method.** Proceeding with a pasted personal access token (fine-grained,
  read-only, scoped to your repos). Say if you want a GitHub App instead.
- **Q36 — the product name.** `repo_tracker` in the repo, "Bearing" in the old documents.
  Only affects window titles and the header.
- **C4 — scale.** Assuming ~40 branches across 8 repos, 12–16 moving at once. Only affects
  default display caps.
- **C5 — timestamps.** Assuming relative ("2 days ago") as the default, exact on hover.
