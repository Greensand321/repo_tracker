# Bearing — Roadmap

**Updated:** 15 Sep 2026 · **Current phase:** Phase 0, not started (planning complete)

This is the cohesive plan: every feature, the code each one requires, and the order they
have to be built in. Sources: spec v0.3 §6/§18, phase-0 plan, build plan v0.2 §2–§5.
Where they disagree, the spec wins.

> **Five open questions block parts of this plan** — see
> [`decisions/open-questions.md`](decisions/open-questions.md). The largest (Q1) could
> reorder the phases entirely. Read it before starting Phase 0.

---

## Contents

- [Numbering](#a-note-on-numbering--phase-milestone-tier)
- [The dependency spine](#the-dependency-spine)
- [Phase 0 — The Brief engine](#phase-0--the-brief-engine)
- [Phase 1 — Context](#phase-1--context)
- [Phase 2 — Surfaces & Hygiene](#phase-2--surfaces--hygiene)
- [Phase 3 — Insight](#phase-3--insight-optional)
- [Phase 4 — Advisor & LLM](#phase-4--advisor--llm-built-last-on-purpose)
- [Master code inventory](#master-code-inventory)
- [Known gaps in the plan](#known-gaps-in-the-plan)

---

## A note on numbering — "phase", "milestone", "tier"

Three schemes appear across the documents. They describe the same work.

| Spec v0.3 | Build plan v0.2 | Informally |
|---|---|---|
| Phase 0 | M0 | tier 0 / "the start" |
| Phase 1 | M1 + M2 | tier 1 |
| Phase 2 | M5 (+ hygiene from M6) | tier 2 |
| Phase 3 | M6 | tier 3 |
| Phase 4 | M3 + M4 + M7 | tier 4 |

**Use "Phase N".** Milestone numbers survive only as references into
`plans/build-plan-v0.2.md`, still the best description of *how* several of these are built.

The one real conflict: build plan v0.2 §12 defines v1 as "M0–M4, advisor on by default."
Spec v0.3 overturned that — **the advisor is Phase 4, built last; v1 is fully
deterministic.** Everything else in the build plan stands.

---

## The dependency spine

Nothing in a later row can be built correctly before the row above it exists.

```
  config → repo discovery → branch enumeration → base resolution
                                     ↓
                          raw git facts (collect_git)
                                     ↓
                      BranchState  ──► flags ──► nextStep
                                     ↓
                            prioritize → Brief
                                     ↓
              ┌──────────────┬───────┴────────┬──────────────┐
          markdown         json            HTML snapshot   dashboard
          (plumbing)    (the contract)     (Phase 0 GUI)   (Phase 2)
```

Everything hangs off **Brief JSON**. It is the contract: treat it as public API, version
it, and never let a renderer compute anything the Brief does not already contain. If a
surface needs a fact, the fact goes in the Brief — not in the renderer.

Later phases widen the Brief rather than reshaping it:

| Phase | Adds to the Brief |
|---|---|
| 1 | `sessions[]`, `notes[]`, per-branch `pr{}`, `origin`/`age` on machine-local facts |
| 2 | nothing — it is a renderer |
| 3 | `insight{}` per repo (hotspots, coupling, velocity) |
| 4 | `summary{}` per branch, `proposals[]` — all optional, all degradable |

---

## Phase 0 — The Brief engine

`← WE ARE HERE`

**Status:** not started · **Plan:** [`plans/phase-0-plan.md`](plans/phase-0-plan.md) · **Size:** ~600–900 lines of Python excluding tests

**What you get:** double-click something, and an HTML page tells you which branch you were
last in, what state it is in, and which branches need a decision. No network, no LLM.

### Features → code

| # | Feature | Code | Pure? |
|---|---|---|---|
| F0.1 | Load config; discover repos; validate paths | `config.py` | I/O |
| F0.2 | Enumerate branches per repo; apply exclusions (`dependabot/*`, `renovate/*`) | `collect_git.py` | I/O |
| F0.3 | Resolve base per repo (override → default → `main` → `master` → `origin/HEAD` → none) | `collect_git.py` + `config.py` | I/O |
| F0.4 | Ahead/behind, merge-base, diffstat, merged-ness | `collect_git.py` → `analyze_branch.py` | both |
| F0.5 | **Activity model** — `lastActivity` = max(tip commit, branch reflog, HEAD-reflog checkouts *to* this branch); `lastAction` = type of the newest | `collect_git.py` → `analyze_branch.py` | both |
| F0.6 | Working tree counts + stash count, attached **only** to the checked-out branch | `collect_git.py` | I/O |
| F0.7 | Conflict-risk — intersect of files changed on branch vs on base since fork point | `analyze_branch.py` | pure |
| F0.8 | Flags: `active`, `stale`, `diverged`, `conflict-risk`, `dirty`, `safe-to-delete` | `analyze_branch.py` | pure |
| F0.9 | `nextStep` text — deterministic rules, top-down, first match wins | `nextstep.py` | pure |
| F0.10 | Prioritization into `pickup` / `active` / `decisions`, with caps and tie-breaking | `prioritize.py` | pure |
| F0.11 | Markdown brief | `render_markdown.py` | pure |
| F0.12 | **Brief JSON** — stable key order, documented as the contract | `render_json.py` | pure |
| F0.13 | **HTML Bridge snapshot** — one self-contained file, opens from disk | `render_html.py` | pure |
| F0.14 | CLI `brief` + flags + exit codes (0/2/3/4/5) + first-run message | `cli.py` | I/O |
| F0.15 | Deterministic git fixture repos | `tests/fixture_builder.py` | test |

### Data model introduced

`model.py` — `BranchState`, `RepoState`, `Brief`, `Diffstat`, `WorkingTree`. Schema in
phase-0 plan §6. These dataclasses are the spine; every later phase adds fields to them
rather than inventing parallel structures.

### Build order — tracer bullets, in this sequence

Each step is independently testable and leaves the tree green.

1. **`tests/fixture_builder.py`** — deterministic scratch repos, commit dates pinned via
   `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`. Everything downstream tests against this, so it
   is genuinely first. Must produce: dirty tree, a stash, a merged branch, one 21 commits
   behind, two sharing changed files, a `dependabot/x`, a branch with an old tip but a
   recent checkout, and commits at mixed UTC offsets.
2. **`model.py`** — dataclasses only, no logic. Cheap to write, and it forces the schema
   decisions before any code depends on them.
3. **`collect_git.py`** — the single I/O boundary; every `subprocess` call in the codebase
   lives here. Commands are enumerated in phase-0 plan §5. Returns plain dicts/dataclasses.
   Non-zero exit is *data absent*, never a crash.
4. **`config.py`** — `bearing.toml` load + validate + base resolution + first-run message.
5. **`analyze_branch.py`** — pure. Flags at exact boundaries (6.99 vs 7.01 days), the
   activity model, conflict-risk intersect, timezone normalization to aware UTC.
6. **`nextstep.py`** → **`prioritize.py`** — pure, rule order and tie-breaking are the tests.
7. **`render_json.py`** → **`render_markdown.py`** — golden files.
8. **`render_html.py`** — the Bridge snapshot. **The deliverable that matters.**
9. **`cli.py`** — thin: argparse, exit codes, diagnostics to stderr one line each.
10. **`test_integration.py`** + **`test_perf.py`** + the read-only assertion test.

### The two load-bearing tests

- **Read-only.** Run the full pipeline, assert `git status --porcelain` unchanged and no
  new refs or stashes. This is the product's central promise; it gets a test, not a habit.
- **Activity model.** A branch with an old tip commit but a recent checkout ranks by the
  checkout. Checkouts land in *HEAD's* reflog, not the branch's — the subtlety most likely
  to be got wrong, and the one that decides whether the pickup card is ever right.

### Explicitly not in Phase 0 — do not build, do not stub

Session reconstruction · `park` notes · any GitHub/PR/CI data · the interactive dashboard ·
anything LLM · the `scan`/`config`/`sessions`/`open`/`prune`/`add` commands.

### Exit

A real-repo run where the resume card names the branch you actually last touched, in
< 5 s across 4 repos, verifiable without reading terminal output. Full list: phase-0 plan §11.

---

## Phase 1 — Context

**Status:** planned · **Detail:** build plan §2.1, §4 (M1, M2)

**What you get:** the brief stops being a snapshot of *now* and starts remembering — what
a session looked like, what you scribbled on the way out, what happened on your other
machine, and what GitHub knows.

### Features → code

| # | Feature | Code | Depends on |
|---|---|---|---|
| F1.1 | Reflog → **sessions** with gap detection; `bearing sessions` | `analyze_session.py` (pure) | F0.5 |
| F1.2 | `bearing park "…"` — one-liner notes, stored and resurfaced per branch | `store_notes.py` + `cli.py` | F0.12 · **blocked by Q3** |
| F1.3 | Scan snapshot cache — second run reuses it | `store_cache.py` | F0.12 |
| F1.4 | `bearing config` — read/write config without hand-editing TOML | `cli.py` + `config.py` | F0.1 |
| F1.5 | Stable `machineId`; append-only `<syncRoot>/machines/<id>.jsonl` | `journal_writer.py` | F0.5 |
| F1.6 | Merge all machine journals in memory; label origin + age | `journal_reader.py` (pure merge) | F1.5 |
| F1.7 | Sync-root config; `metadata-only` default, WIP patches opt-in | `config.py` + `journal_writer.py` | F1.5 |
| F1.8 | GitHub PR / review / CI via `gh` passthrough | `collect_github.py` | F0.12 |
| F1.9 | Flags `merge-ready`, `ci-failing`, `almost-done` | `analyze_branch.py` | F1.8 |

### Design constraints carried from the build plan

- **One writer per file.** Each machine appends only to its own journal, so there are no
  write conflicts by construction. The reader merges: per `(repo, branch)` take the latest
  activity, union the notes, attribute the origin.
- **Bearing does no networking.** The sync root is a plain folder replicated by whatever
  you already use. This is why there is no sync code to write — only a path to read.
- **Staleness honesty.** Every machine-local fact renders with origin and age
  ("last activity on `laptop-2`, 3d ago"), so a synced snapshot is never mistaken for
  current local state.
- **`gh` passthrough, not a token.** If `gh` is not authenticated, GitHub features silently
  no-op and the brief still renders.

### Exit

Notes survive restarts and resurface on the right branch · a branch touched on machine A
shows on machine B, labeled · the brief shows PR/CI state and degrades cleanly offline.

---

## Phase 2 — Surfaces & Hygiene

**Status:** planned · **Design:** [`design/`](design/README.md) · **Detail:** spec §14.2, build plan §4 (M5)

**What you get:** the daily surface. Three views over the same Brief, switchable.

### Features → code

| # | Feature | Code | Notes |
|---|---|---|---|
| F2.1 | `bearing open` — local server, renders the Brief live | `serve.py` (stdlib `http.server`) | The first component that is long-running |
| F2.2 | **The Bridge** — resume-first (default view) | `render_dashboard.py` + static assets | Extends F0.13 |
| F2.3 | **The Map** — spatial: projects as islands, branches as trails | same | From prototype variant B |
| F2.4 | **The Logbook** — timeline: the week as an interleaved stream | same | From prototype variant C; needs F1.1 sessions |
| F2.5 | `bearing shell-init` — opt-in, non-blocking startup one-liner | `shellinit.py` | Windows/PowerShell detail still open (Q-A) |
| F2.6 | Hygiene & risk radar: stale, old-base, merge-ready, conflict-prone, safe-to-delete | `hygiene.py` (pure) | Mostly a re-presentation of F0.8 + F1.9 |

**The rule that makes this cheap:** the dashboard renders the Brief JSON with **zero engine
changes**. If building a view requires touching the engine, the Brief was missing a field —
add the field, do not compute in the renderer.

### Exit

The dashboard renders Brief JSON with no engine changes; startup hook is opt-in and
non-blocking.

---

## Phase 3 — Insight *(optional)*

**Status:** speculative · **Detail:** build plan §4 (M6)

| # | Feature | Code |
|---|---|---|
| F3.1 | Velocity & churn analytics | `analyze_insight.py` (pure) |
| F3.2 | **Hotspots** — frequent change × size | `analyze_insight.py` |
| F3.3 | **File coupling** — files that change together | `analyze_insight.py` |
| F3.4 | "Almost done" — PR open, CI green, approvals, untouched > 1 day | `analyze_branch.py`, needs F1.8 |
| F3.5 | "Decision debt" — branches that represent an unmade decision | `hygiene.py` |

Requires new collection: `--numstat` across history, which is the first thing that will
challenge the < 5 s budget. Expect to cache it (F1.3).

**Exit:** the flags measurably drive branch-count reduction.

---

## Phase 4 — Advisor & LLM *(built last, on purpose)*

**Status:** deferred by decision · **Detail:** build plan §3, §7, §8

The engine is deterministic; the advisor is probabilistic. The advisor **never mutates a
repo** — everything it produces is an artifact you choose to act on. Its failure mode is
wrong prose or a bad demo, never a corrupted repository.

| # | Feature | Code |
|---|---|---|
| F4.1 | Advisor client — structured output, schema-validated, retry-once-then-degrade | `advise/client.py` |
| F4.2 | **Narrate** — WIP summary + next step, cached by `{repo, branch, headSha, configHash}` | `advise/narrate.py` |
| F4.3 | **Plan** — `bearing plan <branch>`, PR descriptions, changelogs | `advise/plan.py` |
| F4.4 | Direction packet — deterministic, token-budgeted assembly | `advise/packet.py` (pure) |
| F4.5 | **Heading** — direction inference → opportunity scan → plan → demo | `advise/heading.py` |
| F4.6 | Sandbox — disposable `git worktree`, caps on time/disk/tokens | `sandbox/worktree.py` |
| F4.7 | Verification gate — detect and run the project's harness; tag `verified`/`unverified` | `sandbox/verify.py` |
| F4.8 | Proposals store + gallery; keep / discard / **promote** | `proposals/store.py` |
| F4.9 | Budget caps, model tiering, prompt versioning | `advise/budget.py` |
| F4.10 | Conversational advisor over the complete data layer | `advise/chat.py` |

`promote` is the only write path in the entire product, and it is human-triggered. It
creates a local branch. It never commits, never pushes, never merges.

**Exit:** an automated test proves the source working tree is byte-for-byte unchanged
after a demo run.

---

## Master code inventory

Everything that must exist, by phase. Purity column is load-bearing: **I/O modules are the
only place `subprocess`, the filesystem, or the network may appear.**

| Module | Phase | Purity | Single responsibility |
|---|---|---|---|
| `bearing/__init__.py` | 0 | — | version constant |
| `bearing/__main__.py` | 0 | — | delegate to `cli.main()` |
| `bearing/cli.py` | 0 | I/O | argparse, exit codes, diagnostics |
| `bearing/config.py` | 0 | I/O | load/validate `bearing.toml`, resolve bases |
| `bearing/collect_git.py` | 0 | **I/O** | every git subprocess call in the codebase |
| `bearing/model.py` | 0 | pure | dataclasses: BranchState, RepoState, Brief |
| `bearing/analyze_branch.py` | 0 | pure | BranchState + flags |
| `bearing/nextstep.py` | 0 | pure | flag → next-step text |
| `bearing/prioritize.py` | 0 | pure | ordering + brief sections |
| `bearing/render_json.py` | 0 | pure | the contract |
| `bearing/render_markdown.py` | 0 | pure | terminal/plumbing output |
| `bearing/render_html.py` | 0 | pure | self-contained Bridge snapshot |
| `bearing/analyze_session.py` | 1 | pure | reflog → sessions, gap detection |
| `bearing/store_notes.py` | 1 | I/O | parking notes |
| `bearing/store_cache.py` | 1 | I/O | scan snapshot cache |
| `bearing/journal_writer.py` | 1 | I/O | append this machine's events |
| `bearing/journal_reader.py` | 1 | I/O + pure merge | read all journals, merge, attribute |
| `bearing/collect_github.py` | 1 | I/O | `gh` passthrough: PR, reviews, CI |
| `bearing/serve.py` | 2 | I/O | local dashboard server |
| `bearing/render_dashboard.py` | 2 | pure | three views over the Brief |
| `bearing/hygiene.py` | 2 | pure | risk radar |
| `bearing/shellinit.py` | 2 | I/O | startup one-liner |
| `bearing/analyze_insight.py` | 3 | pure | churn, hotspots, coupling |
| `bearing/advise/*.py` | 4 | I/O | client, narrate, plan, heading, packet, budget |
| `bearing/sandbox/*.py` | 4 | I/O | worktree, verify |
| `bearing/proposals/store.py` | 4 | I/O | proposals + promote |

**Phase 0 is 12 modules.** If it grows past that, re-read the plan's §2 before adding a
thirteenth.

---

## Known gaps in the plan

Found reviewing the spec, both plans, and the mockups together. Each is a real gap, not a
detail — the first three change what Phase 0 should be. Full detail and the decisions
needed: [`decisions/open-questions.md`](decisions/open-questions.md).

1. **The data source may be wrong for the actual workflow** (Q1). Phase 0 reads *local*
   git — reflog, working tree, stashes. A branch created by a remote agent and pushed to
   origin, never checked out locally, produces none of those signals: no reflog entry, no
   working tree, no stash. Its `lastActivity` collapses to the tip commit date and
   `lastAction` is always `commit`. If most branches arrive that way, GitHub is the primary
   source and Phase 1's `collect_github.py` belongs *in* Phase 0.
2. **The narrative gap** (Q2). What sells the mockups is prose — *"you refactored AuthStep
   and pushed with CI still running; two tests are red on the empty-email path."*
   Deterministic git cannot produce that. It comes from an LLM (Phase 4) or from notes you
   typed (Phase 1). Phase 0's snapshot will therefore be flags, counts, and a rules-based
   next step — correct, useful, and much barer than the mockup. Worth deciding deliberately
   rather than discovering at the demo.
3. **Notes have no entry path** (Q3). Decision #9 says the owner's surface is visual, not
   the terminal. `bearing park "…"` is a terminal command. Something has to give: either
   notes get captured in the GUI (which needs a write path, so the Phase 2 server moves
   earlier), or via a non-terminal capture the plan does not currently describe.
4. **Launching has no entry path either** (Q4). `bearing brief --html --open` is also a
   terminal invocation. Phase 0 needs a double-clickable launcher — a `.bat`, a shortcut,
   or a scheduled task — and nothing in the plan specifies one.
5. **"Pick up where you left off" stops at telling you** (Q5). Resuming means checking out
   the branch, which read-only forbids (decision #1). The plan never says what the card's
   primary action *is* — copy the checkout command? Open the repo in an editor? Nothing?
