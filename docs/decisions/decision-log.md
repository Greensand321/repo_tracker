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
| ~~The advisor is built last; v1 is fully deterministic~~ | **Under review — C1** | Owner said defer, but ranked LLM insight as priority #2 and made the LLM responsible for goal/milestone upkeep. Currently placed at Stage 2. |
| ~~Brief cadence: on-demand plus a shell-startup one-liner~~ | Q39 (open) | No terminal, so no shell hook. |
| ~~`diverged` = behind base by > 20 commits~~ (and every other fixed threshold) | D11 | All thresholds move to settings. |
| ~~Success metric: branch reduction~~ | D7 | The goal is the opposite. |
| ~~Performance budget: < 5 s across 4 repos, ≤ 3 git calls per branch~~ | — | Written for local subprocess calls. A network-bound budget needs rewriting once the stack is chosen. |
| ~~`safe-to-delete` is list-only, permanently~~ | Still true, but deprioritized | Follows from D1. Just no longer a feature anyone is waiting for. |

---

## 4. Still open

See [`open-questions.md`](open-questions.md) §2 (conflicts C1–C6) and §3 (decisions Q30–Q40).

**Blocking:** Q30 (the stack) and C1 (where the LLM goes).
