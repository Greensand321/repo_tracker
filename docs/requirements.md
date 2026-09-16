# Requirements — what this tool actually is

**Written:** 15 Sep 2026, from the owner's answers to `decisions/open-questions.md`.
**Status:** this document now outranks `spec/bearing-spec-v0.3.html`, which was written for
a different tool (see [§9](#9-what-changed-from-spec-v03)). It is the source of truth until
a v0.4 spec replaces it.

Items marked **[OPEN]** are not decided yet and are tracked in `decisions/open-questions.md`.

---

## 1. What this tool is

> *"This tool is solely for reference and to get my bearings straight."*

A personal dashboard that answers one question across every repo and branch at once:
**what is actually happening, in plain English.**

It is a **reference surface, not a workspace.** It never does the work and never changes
the repos. It tells you where everything stands so you can hold more threads at once
without the mental load of remembering them.

The critical reframing from the owner:

> *"The raw git bullcrap is not what I need. I don't care what time it was committed —
> I care what was committed, in plain English."*

Commit messages, PR titles, and eventually LLM summaries are the content. SHAs, ahead/behind
counts, and timestamps are **supporting metadata**, not the headline.

---

## 2. The actual workflow this serves

This is the part the old spec got wrong, and everything downstream depends on it.

| | How it actually works |
|---|---|
| **Who writes the code** | AI agents — Claude Code, sometimes t3 code. Not the owner at a keyboard. |
| **Where branches come from** | Each agent session gets its own branch and pushes it to origin. |
| **Session lifetime** | **Long.** A session can run a week or more, evolving as work changes. Context is deliberately not rotated unless the task is genuinely new. |
| **Where work lands** | The owner merges to `main` manually, or in bulk via `.github/workflows/sync-branches.yml` when several branches finish together. |
| **Terminal use** | Almost never. Only to debug something specific. |
| **Machines** | Two, used daily, both regularly. |
| **Scale** | ~8 repos tracked; 3–4 active at a time. **~100 branches total**, all of which eventually enter the tool; **a few dozen stay relevant** and the rest simply go stale. Stale branches fold away in the UI — they are never deleted and never dropped from the data. |

### What this implies

1. **GitHub is the primary data source, not an enrichment.** A branch created by an agent
   and pushed to origin was never checked out on either of the owner's machines. It has no
   local reflog entry, no working tree, no stash. Every local-git signal the old plan was
   built on is empty for the branches that matter.
2. **A branch is a session is a thread of work.** It is long-lived and evolves. The unit of
   attention is the thread, not the commit.
3. **The owner's input must be minimal.** Almost everything is already recorded in the repo
   by the agents. The tool reads; it does not ask you to maintain it. The one exception the
   owner accepts: authoring milestones and goals by hand (§4).
4. **More branches is the goal, not fewer.** *"The goal isn't less branches, it's more —
   the whole point is to reduce mental load so I can keep up with more things at once."*
   This voids the old "branch reduction" success metric entirely.

---

## 3. Functional requirements

### R1 — Show what was done, in plain English
For every branch across every tracked repo: commit messages, when (relative — "2 days ago"),
who/what made them, PR state, CI state. Rendered into the dashboard, not a terminal.
**This is the proof-of-concept.** The owner's words: *"the biggest thing that needs to be
solved to prove this is possible."*

### R2 — An organizing hierarchy the owner defines
```
Milestone      — release-level. "A major marker of progress," like a version.
  └─ Goal      — a body of work under a milestone. Holds many branches.
       └─ Branch — the literal git branch (one agent session). Exactly ONE goal per branch.
            └─ Sub-task — may diverge from the branch's goal.
```
- The owner authors milestones and goals **by hand**, in the GUI.
- **One goal per branch**, which keeps every view unambiguous.
- **Sub-tasks live under a branch and may diverge from its goal** — this is where the
  reality of a week-long session that wandered gets absorbed.
- **The task is whatever the branch is doing now.** The LLM re-titles it as the branch
  evolves; nothing is fixed at creation and left to rot.

### R3 — Tags
Free-form tags on branches, so the owner can see which branches align with a theme
independently of the milestone/goal tree. Cross-cutting, many-to-many.

### R4 — Progress judgement (LLM)
The LLM reads the commit history and decides:
- Is this branch **progressing**, stalled, or done?
- Is this goal progressing? Is this milestone progressing?
- Which goal does an unassigned branch belong to?

This is upkeep the owner explicitly does not want to do by hand. It is also the reason the
LLM is not optional garnish — it is the engine of the organizing layer. See conflict **C1**.

### R5 — Insight, not just status
*"The LLM actually reading those logs and then giving me useful insights."* Second-highest
near-term priority after R1.

### R6 — Notes
One-liner notes, **entered in the GUI**, attached to branches/tasks/goals. Never a terminal
command.

### R7 — Comments on AI output
A comment tool next to anything the AI produced, so the owner can record what was good or
bad about it and **tune prompts later**. This is a personal feedback log against LLM
outputs, not repo content.

### R11 — Change over time
Track how branch, goal and milestone state changes, so the owner can measure *what* moved
and *by how much*. This is why dated snapshots start being written in Stage 1 (D31) even
though nothing reads them until later: **change history cannot be reconstructed
retroactively.**

### R12 — Talking to the LLM
A conversational surface in the GUI is a **requirement**, not an optional extra. It is the
one place the owner always types. Consequence: because an input surface exists anyway,
notes (R6) become nearly free — "view-only for now" saves less than it appears to.

### R8 — Settings
Thresholds and display options are editable in a settings screen. **Nothing hardcoded** —
what counts as "stale", how many items show per section, and so on.

### R9 — Two-machine sync
The same view on both machines, every day. Non-negotiable.

**Key simplification:** GitHub *is already* the sync layer for everything in R1 — commits,
branches, PRs, CI are identical from both machines because both read the same origin. Only
the owner's own annotations need syncing: milestones, goals, task assignments, tags, notes,
comments, settings. That is a small amount of text, not a data pipeline.

### R10 — Capped, prioritized views
Show a bounded amount, ordered by what deserves attention. Scrolling/paging through the
remainder is wanted but explicitly deferred as "too technical right now."

---

## 4. The two data planes

The old documents conflate these, which is why "read-only" kept seeming to conflict with
notes, tags, and goals. They are separate:

| | **Plane A — the repos** | **Plane B — the tool's own data** |
|---|---|---|
| Contains | Commits, branches, PRs, CI, diffs | Milestones, goals, tasks, tags, notes, comments, settings |
| Source of truth | GitHub | This tool |
| Access | **Strictly read-only, forever.** Never a branch, a merge, a push, a stash, a config change. | Full read/write. This is the tool's database. |
| Sync | Already synced — it is GitHub | Needs a sync solution (R9) |

**"Read-only" means Plane A only.** It was never meant to stop the tool from storing your
own notes. Restating it this way resolves the apparent conflict without weakening the
invariant that matters: *the tool can never damage your work.*

---

## 5. Surfaces and how it runs

- **GUI only.** No terminal. No markdown output. No CLI as a product surface.
  A command-line entry point may exist as plumbing for debugging; it is not how the tool is
  used, and nothing about the design should be shaped by it.
- **Boots from a file in the repo root** — `index.html` or similar — by clicking it or a
  desktop shortcut to it. **[OPEN — see the stack question]**: a pure static page and a page
  served by a small local program look identical once running, but only one of them can hold
  a GitHub token safely and write notes to disk. This decides the stack.
- **Iteration today:** source in a folder, opened and run from VS Code.
- **Eventually:** packaged as a single installable program with a shortcut.
- **Starting layout:** build from the existing mockup **[OPEN — which one]** and evolve.

---

## 6. Constraints

| | |
|---|---|
| Platform | Windows-first. Paths with spaces must work. |
| Network | **Required.** GitHub is the data source; sync is cloud-based. Offline is a degraded mode, not the default. |
| Dependencies | Allowed. *"If installing a dependency makes things easier then great, do that."* This overturns the old stdlib-only rule. |
| Base branch | `main`, everywhere, only. No `develop`, no per-repo overrides. |
| Auth | GitHub. `gh` is authenticated in other apps, but this is built from the ground up — assume a token or an app of its own. **[OPEN]** |
| Sync backend | Supabase or Firebase. **[OPEN — not chosen]** |
| Privacy | Data backed up locally, saved to the cloud. Personal tool, single user. |
| LLM | Deferred, but *not* as far as the old plan assumed — see conflict **C1**. |

---

## 7. Non-goals

- **Not a workspace.** It never edits code, runs agents, or dispatches work.
- **Not a branch-reduction tool.** Hygiene, pruning, and "safe to delete" drop to the bottom
  of the priority list. The owner wants to *hold more* branches, not fewer.
- **Not a terminal tool.** Not a CLI with a GUI bolted on.
- **Not multi-user.** Personal, one owner, two machines.
- **Not a replacement for `sync-branches.yml`.** That workflow stays exactly as it is: a
  bulk "merge everything to main" time-saver. The tool may *report* on drift, but never
  performs merges.

---

## 8. Priority order

Straight from the owner, in their order:

1. **R1 — git logs, in plain English, in the mockup.** The proof it can work at all.
2. **R4 / R5 — the LLM reading those logs and producing real insight.**
3. Everything else.

`ROADMAP.md` is built around exactly this order.

---

## 9. What changed from spec v0.3

The old spec is not wrong so much as **aimed at a different tool**: a local-first,
terminal-centric CLI for a developer who writes code at a keyboard and forgets which branch
they were on. This one is a GUI reference dashboard over work that AI agents did on GitHub.

| Spec v0.3 / phase-0 plan assumed | Actually true |
|---|---|
| Local git is the data source — reflog, working tree, stashes | GitHub is. Local signals are empty for agent branches. |
| The activity model (HEAD-reflog checkout detection) is the centrepiece | It produces nothing here. Commit history is the centrepiece. |
| Markdown brief in a terminal is the default output | There is no terminal. GUI only. |
| A CLI with flags is the product surface | The CLI is not a product surface at all. |
| Python 3.11+, stdlib only, no dependencies | Dependencies are fine. **[OPEN]** whether Python is even the right stack. |
| Offline-first, no networking in the tool | Network-dependent by design: GitHub + a cloud sync backend. |
| Sync via a plain folder replicated by Syncthing/Dropbox | Supabase or Firebase. **[OPEN]** |
| Success = fewer branches | Success = holding *more* branches with less mental load. |
| LLM strictly last, after everything else | LLM is the engine of the organizing layer and the #2 near-term priority. |
| No concept of tasks, goals, milestones, or tags | The whole organizing hierarchy the owner wants. |

**What survives from the old documents**, and is still worth keeping:

- The read-only invariant for Plane A — sharpened, not weakened.
- The purity rule: I/O at the edges, pure logic in the middle, tests on the pure layer.
- **One canonical data structure that every surface renders.** The old "Brief JSON is the
  product" rule is exactly right and carries over unchanged.
- Literal git branch names as the identifier you can always search for. **[OPEN]** whether
  an LLM-written human title may appear *alongside* it.
- The visual language of the mockups: layout, palette, typography, card structure.
- `sync-branches.yml`, untouched.
