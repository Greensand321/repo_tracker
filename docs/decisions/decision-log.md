# Decision log

Every decision with the reason behind it. **Check here before reopening an argument.**
Overturned decisions are not deleted — they move to §3 with what replaced them, so the
reasoning trail survives.

**Precedence:** [`../requirements.md`](../requirements.md) > [`../ROADMAP.md`](../ROADMAP.md)
> `spec/bearing-spec-v0.3.html` > `plans/` > `archive/`.

Restructured 15 Sep 2026, when the owner's answers changed the product. Questions still
open: [`open-questions.md`](open-questions.md).

---

## 1. Current decisions — from the owner, 15 Sep 2026

| # | Decision | Why |
|---|---|---|
| D1 | **Two data planes.** Plane A (your repos) is strictly read-only forever — no push, merge, branch, stash, or config change. Plane B (milestones, goals, tags, notes, comments, settings) is the tool's own database, written freely. | Resolves the apparent conflict between "read-only" and wanting to store notes. Keeps the invariant that matters: the tool can never damage your work. |
| D2 | **GitHub is the primary data source.** Not local git. | Branches are created by agent sessions and pushed to origin; they are never checked out locally, so local reflog, working tree and stashes are all empty for them. |
| D3 | **GUI only.** No terminal, no markdown output, no CLI as a product surface. | The owner does not use a terminal except to debug. A CLI entry point may exist as plumbing, but nothing about the design is shaped by it. |
| D4 | **Plain English is the headline.** Commit messages, PR titles, and LLM summaries are the content; SHAs, ahead/behind and timestamps are supporting metadata. | *"The raw git bullcrap is not what I need — I care what was committed, in plain English."* |
| D5 | **Milestone → Goal → Task → Branch.** Milestones are release-level; goals hold many tasks; one task per branch. | The owner's structure. Owner authors milestones and goals; the LLM does the filing and progress upkeep. |
| D6 | **Tags are separate from the hierarchy** — free-form, many-to-many, cross-cutting. | Lets a branch belong to a theme without complicating the goal tree. |
| D7 | **More branches is the goal, not fewer.** | *"The goal isn't less branches, it's more — the whole point is to reduce mental load so I can keep up with more things at once."* This voids the old branch-reduction success metric and deprioritizes all hygiene features. |
| D8 | **`main` is the base branch, everywhere, always.** No `develop`, no per-repo overrides. | Stated directly. Removes the entire base-resolution fallback chain. |
| D9 | **Dependencies are allowed.** | *"If installing a dependency makes things easier then great, do that."* Overturns the old stdlib-only rule. |
| D10 | **Network-first.** GitHub for data, a cloud backend for sync. The local cache gives a degraded offline view; offline is not the default mode. | Follows from D2 and the two-machine requirement. |
| D11 | **Nothing hardcoded.** Thresholds and display caps are exposed in settings. | Stated directly. |
| D12 | **Personal tool, one owner, two machines.** | No multi-user, no sharing, no onboarding flow to build. |
| D13 | **GitHub is already the sync layer** for commits, branches, PRs and CI. Only Plane B needs a sync backend. | Both machines read the same origin, so that data matches by construction. Shrinks the sync problem to a few kilobytes of text. |
| D14 | **`sync-branches.yml` stays as it is** and is not part of the product. | It is a bulk merge-to-main time-saver for when several branches finish together. The tool may report drift; it never merges. |

| D20 | **Stack: a local program + a browser UI, in TypeScript.** Node 22+, Hono for the server, Octokit for GitHub, Vite + vanilla TS for the front end. You click `start.bat`; it opens the browser. | Only a program behind the page can hold a GitHub token safely, write a local backup, and call the API without `file://` restrictions. TypeScript gives one language across front and back. Bundles to a single `.exe` later without a rewrite. |
| D21 | **The LLM arrives at Stage 2**, immediately after the git history lands — not last. | The owner's stated priority order put LLM insight second, and the goal/milestone upkeep depends on it. Overturns the old "advisor built last" decision (§3). |
| D22 | **Build from `design/dashboard-concept.html`.** | It already carries the Timeline and Notes surfaces the requirements call for. Variant A ("The Bridge") is built around a "you were just here" moment that does not apply when agents did the work. |
| D23 | **Vanilla TS on the front end, not a framework.** | The mockup is vanilla HTML/CSS/JS, so it transplants directly rather than being reimplemented — and Stage 1 is exactly "make the mockup show real data." Revisit at Stage 3 if the UI gets painful; contained, because everything renders one data structure. |
| D24 | **Only commits *ahead of* `main` are shown**, via the GitHub `compare` endpoint. | A branch's full history is mostly `main`'s and says nothing about the thread. One call returns the branch's own commits, ahead/behind, and diff size together. |

| D25 | **The product is called Bearing.** | Confirmed by the owner. The repo stays `repo_tracker`; the app is Bearing. |
| D26 | **Clicking a branch expands its detail and offers links out to GitHub** — the branch and its PR. It never checks anything out. | Follows from D1. The work happens on GitHub, so jumping to the PR is the action actually wanted. |
| D27 | **GitHub auth: a fine-grained, read-only token pasted into settings.** Stored in `data/`, gitignored, never synced to the cloud. Each machine gets its own. | Simplest thing that works, scopes controlled by the owner, no OAuth flow to build. |
| D28 | **Supabase for Plane B.** | The data is relational (milestone → goal → branch → sub-task); it is plain Postgres you can inspect and repair yourself; the free tier covers kilobytes of text comfortably. |
| D29 | **Hierarchy: Milestone → Goal → Branch → Sub-task.** Exactly one goal per branch. Sub-tasks live under a branch and **may diverge from its goal**. | The owner's structure. One goal per branch keeps every view unambiguous; sub-tasks absorb the reality that a long session wanders. |
| D30 | **The task is whatever the branch is doing *now*.** The LLM re-titles it as the branch evolves. | Sessions run a week or more and change shape. A task fixed at creation would drift out of date and need manual upkeep — exactly what the owner does not want. |
| D31 | **Store dated snapshots of branch state from Stage 1 onward**, even though nothing reads them yet. | The owner wants to measure what changed and by how much. Change over time cannot be reconstructed retroactively — if the history is not being written now, that feature is impossible later. Cheap now, impossible to backfill. |
| D32 | **LLM provider: OpenCode Zen**, one API key pasted into settings (OpenAI-compatible). | The owner's choice. Revisit if volume stays low enough to justify a cheaper pay-as-you-go option, which would need more spend safeguards. |
| D33 | **Talking to the LLM is a requirement, not an optional surface.** The GUI has a text input from Stage 2 onward. | Stated directly. It also means notes (R6) become nearly free once an input surface exists, so "view-only for now" is a smaller saving than it looks. |
| D34 | **Refresh on open, then keep updating in the background** using conditional requests. | The owner wants it live. ETags make unchanged responses cost nothing against the rate limit, so continuous polling is affordable — see `plans/stage-1-plan.md` §5. |
| D35 | **~100 branches, of which a few dozen stay relevant.** Stale branches fold away in the UI; they are never hidden from the data and never deleted. | The owner's actual scale. Staleness is a display concern, not a hygiene feature (D7). |
| D36 | **t3 code needs no special handling.** Both agents push ordinary branches with ordinary commits. | Confirmed by the owner. |

| D37 | **Talk to the provider over its OpenAI-compatible HTTP API, not a vendor SDK.** | The endpoint is deliberately swappable — the same code reaches any OpenAI-compatible provider by changing one setting. A vendor SDK would weld the choice in. |
| D38 | **Do not send `response_format: json_object`.** Ask for JSON in the prompt and parse tolerantly (fences and chatter allowed). | OpenCode Zen fronts 100+ models of varying capability, and the ones that reject that parameter fail the entire request. Tolerance costs a few lines; a hard failure costs the feature. |
| D39 | **Summaries are cached on `headSha` + `promptVersion` + `model`.** | A branch that has not moved is never summarised twice — that is what makes ~100 branches cost pennies. Including the prompt version means editing the prompt regenerates everything rather than leaving a silent mix of old and new. |
| D40 | **Every commit the model cites is checked against the branch's own commits.** Invented SHAs are dropped. | A summary you cannot trace back to commits is just a claim. This is the cheapest possible hallucination guard and it costs nothing at runtime. |
| D41 | **Enrichment never blocks the snapshot.** Cached summaries apply synchronously before serving; new ones are fetched in the background and pushed to the page as they land. | A provider that is slow, down, or out of credit must cost you the summaries and nothing else. Everything that makes the page useful is already there without the LLM. |
| D42 | **A fatal provider error stops the run immediately.** | A rejected key or an empty balance fails identically for every branch; discovering that ninety-nine more times is pure waste. |
| D43 | **`BEARING_DATA_DIR` overrides where the tool's data lives.** | Lets the second machine put it elsewhere, and keeps tests out of the real data directory. |
| D44 | **A debug CLI exists (`npm run brief` / `models` / `config`) and is explicitly not a product surface.** | CLAUDE.md rule 2 already allows a debug entry point. It lets the engine be exercised and read while the interface is redesigned. No feature may be shaped around it. |

---

## 2. Carried over from the old documents

Still true, and still good reasons.

| # | Decision | Why |
|---|---|---|
| D15 | **One canonical data structure; every surface renders it.** If a view needs a fact, the fact goes into the structure — never computed in the view. | The old "Brief JSON is the product" rule. It is what lets surfaces change without touching the engine. |
| D16 | **I/O at the edges, pure logic in the middle.** Fetching and storage at the boundary; pure, testable functions between. | Where correctness is guaranteed and where the tests live. |
| D17 | **The literal git branch name is always shown and always searchable.** | You act on the real name; an alias adds a translation step exactly when you have no context to spare. *(Whether an LLM title may appear alongside it: Q37.)* |
| D18 | **Notes are one-liner scratchpads, not a journal** — now entered in the GUI. | A journal is a second thing to maintain; a one-liner is something you actually write. |
| D19 | **Show a capped, prioritized set** rather than everything. | Stated again in Q18. Paging through the remainder is wanted but deferred. |

---

## 3. Overturned

Kept because the arguments still explain how the current design was reached.

| Old decision | Replaced by | Why it fell |
|---|---|---|
| ~~Python 3.11+, stdlib only, no dependencies~~ | D9 | Owner: dependencies are fine if they help. The constraint existed to keep a CLI portable; the product is not a CLI. |
| ~~All git access via `git` subprocess with porcelain formats~~ | D2 | The data comes from the GitHub API now. Local git may still be read for repos that are cloned, but it is not the source of truth. |
| ~~Offline-first; the tool does no networking~~ | D10 | GitHub is the data source and sync is cloud-based. |
| ~~Multi-machine sync via one append-only journal file per machine in a replicated folder~~ | D13 + Stage 4 | Owner wants a real backend (Supabase/Firebase). Also unnecessary: GitHub already syncs everything except annotations. |
| ~~Journal scope is metadata-only by default~~ | — | Obsolete with the journal design. Privacy question re-asked as part of Q33. |
| ~~GitHub via `gh` CLI passthrough, no token management~~ | Q34 (open) | "Built from the ground up"; `gh` on both machines complicates packaging. |
| ~~The advisor is built last; v1 is fully deterministic~~ | **D21** | Owner said defer, but ranked LLM insight as priority #2 and made the LLM responsible for goal/milestone upkeep. Resolved 16 Sep: the LLM lands at Stage 2. |
| ~~Python 3.11+ as the implementation language~~ | **D20** | Chosen for a portable stdlib-only CLI. The product is a GUI; TypeScript spans front and back. The Python skeleton was deleted. |
| ~~Brief cadence: on-demand plus a shell-startup one-liner~~ | Q39 (open) | No terminal, so no shell hook. |
| ~~`diverged` = behind base by > 20 commits~~ (and every other fixed threshold) | D11 | All thresholds move to settings. |
| ~~Success metric: branch reduction~~ | D7 | The goal is the opposite. |
| ~~Performance budget: < 5 s across 4 repos, ≤ 3 git calls per branch~~ | — | Written for local subprocess calls. A network-bound budget needs rewriting once the stack is chosen. |
| ~~`safe-to-delete` is list-only, permanently~~ | Still true, but deprioritized | Follows from D1. Just no longer a feature anyone is waiting for. |

---

## 4. Still open

See [`open-questions.md`](open-questions.md) §2 (conflicts C1–C6) and §3 (decisions Q30–Q40).

**All questions are answered.** Round 2 closed on 16 Sep 2026 → D20–D36.

The only item still genuinely open is **Q37** — whether the LLM may write a short
plain-English title to sit beside the literal branch name. The owner said yes but noted the
question was unclear, so it is re-explained in `open-questions.md` with an example and
should be confirmed before Stage 2 renders one.
