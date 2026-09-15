# Decision log

Every locked decision in one place, with where it came from. **Check here before
reopening an argument.** If a decision is overturned, do not delete the row — strike it
and add the replacement, so the reasoning trail survives.

Precedence when documents disagree: **spec v0.3 > phase-0 plan > build plan v0.2 > archive.**

---

## Locked

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | **Bearing is strictly read-only.** It never writes to a tracked repo — no branch, no stash, no ref, nothing. | Removes the entire class of "the tool broke my work" risk. It is an invariant with an acceptance test, not an aspiration. | spec §3, phase-0 plan §1 |
| 2 | **Stack: Python 3.11+, stdlib only.** `tomllib`, `argparse`, `subprocess`. No GitPython, no pygit2, no requests, no framework. | Zero install friction, nothing to keep current, trivially portable to Windows. | build plan §11.1, phase-0 plan §2 |
| 3 | **All git access via `git` subprocess** with porcelain/machine formats. Never parse human-readable output. | Machine formats are stable contracts; human output is not. | phase-0 plan §2 |
| 4 | **The Brief JSON is the product.** Terminal, HTML, and dashboard are interchangeable renderers over it. | Lets surfaces change without touching the engine — the Phase 2 dashboard should need zero engine changes. | spec §8, build plan §2 |
| 5 | **The advisor is built last (Phase 4).** v1 is fully deterministic. | It draws on *all* Bearing data, so building it early means building it half-finished. | spec v0.2 decision 1 & 4 |
| 6 | ~~v1 = M0–M4 including Heading; advisor on by default with strict caps.~~ **Overturned** by #5. | Build plan v0.2 locked this on 13 Sep; spec v0.3 reversed it the same day. The spec wins. | build plan §11.3–4, overturned by spec v0.3 |
| 7 | **Literal git branch names, always.** Bearing never invents display names. | You search for and check out the real name; a pretty alias adds a translation step exactly when you have no context to spare. Note the prototypes violate this — see `design/README.md`. | spec v0.2 decision 2, §4.5 |
| 8 | **Parking notes are scratchpad one-liners, not a journal.** | A journal is a second thing to maintain; a one-liner is something you actually write on the way out the door. | spec v0.2 decision 3 |
| 9 | **The owner's daily surface is visual, not the terminal.** The HTML snapshot ships in Phase 0; the interactive dashboard is a committed Phase 2 deliverable in three views. | The owner does not work in the terminal. A tool you have to read logs to use would not get used. | spec v0.3 §14.2, phase-0 plan §0 |
| 10 | **Dashboard views: The Bridge (default) · The Map · The Logbook.** | Three genuinely different paradigms rather than three screens; all render the same Brief. | spec §14.2 |
| 11 | **Multiple machines**, reconciled by one append-only `.jsonl` journal per machine in a synced folder, merged in memory. Bearing does no networking itself. | Each machine writes only its own file, so there are no write conflicts by construction. Sync is whatever you already use. | build plan §2.1, §11.2 |
| 12 | **Journal scope is metadata-only by default**; WIP patches are opt-in. | Branch names and SHAs leaving the machine is a different risk from source content leaving it. | build plan §2.1, §8 |
| 13 | **GitHub via `gh` CLI passthrough.** No token management; if `gh` is not authenticated, GitHub features silently no-op. | Not owning credentials is cheaper and safer than owning them well. | spec v0.2 decision 5, §17 |
| 14 | **`safe-to-delete` is list-only, permanently.** Bearing flags; you delete. | Follows from #1. | spec §17 |
| 15 | **Default branch exclusions:** `dependabot/*`, `renovate/*`; configurable. | Bot branches are noise in a fleet view. | spec §17, phase-0 plan §4 |
| 16 | **Brief cadence: on-demand + an opt-in shell-startup one-liner.** Scheduled digests cut. | A digest you did not ask for becomes another thing to ignore. | spec §17 |
| 17 | **Purity rule:** `collect_*`/`config`/`cli` do I/O; everything below them is pure and testable without a real repo. | This is where correctness is guaranteed and where the tests live. | spec §8, build plan §5, phase-0 plan §3 |
| 18 | **Working tree and stashes are repo-level**, attached only to the checked-out branch's state; every other branch gets `null`/`0`. | Uncommitted files belong to the checkout, not to a branch. Listing them per branch would be a lie. | spec §7, phase-0 plan §5 |
| 19 | **`diverged` = behind base by > 20 commits.** v0.1's "> 3× ahead" rule removed. | A branch far *ahead* is finished work waiting to merge, not a risk. | spec §18 |
| 20 | **Advisor output is artifacts, never repo operations** ("generate, don't operate"). `promote` is the only write path and is human-triggered. | Its failure mode becomes *wrong prose or a bad demo*, never a corrupted repo. | build plan §1, §8 |
| 21 | **Performance budget: < 5 s warm across 4 repos / ~40 branches.** ≤ 3 git calls per branch, ≤ 6 per repo. | A tool for saving seconds cannot cost seconds. Also a design forcing-function: needing more calls means the design is wrong. | phase-0 plan §2 |
| 22 | **This repository (`repo_tracker`) is Bearing's home.** Source at the root, documents under `docs/`. | Supersedes phase-0 plan §3, which predates this repo and says to create a fresh one at `C:\Users\alexa\Documents\github\bearing\`. That instruction is now satisfied here. | 15 Sep 2026, this repo |

---

## Still open — none of these block Phase 0

| # | Question | Notes |
|---|---|---|
| A | Windows `shell-init` details — PowerShell profile hook, path handling in config | Phase 2. Phase 0 only needs paths with spaces and backslashes to work. |
| B | Sync root location and default scope for the journal | Phase 1. Metadata-only is already decided; the *path* is not. |
| C | Sandbox location + auto-clean policy | Phase 4. |
| D | LLM model names for the cheap / mid / strong tiers | Phase 4. Provider is OpenCode **Zen** (pay-as-you-go, OpenAI-compatible) — *not* the Go subscription, which targets coding-agent traffic. |
| E | Repo and branch include/exclude patterns beyond the bot defaults | Phase 0 ships the hardcoded default list; config comes later. |
| F | Name availability for "Bearing" | Worth a check before anything is published. |

---

## How to add a decision

One row, past tense, with the *reason* — not just the choice. The reason is what makes it
possible to tell later whether the decision still holds. If it came from a document, cite
the section so the full argument stays findable.
