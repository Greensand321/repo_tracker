# Roadmap

**Updated:** 15 Sep 2026 · **Status:** planning · **Requirements:** [`requirements.md`](requirements.md)

Ordered by the owner's stated priorities: **git history on screen in plain English first**,
**LLM insight over it second**, everything else after.

> **The old Phase 0–4 numbering is retired.** It described a different tool — a local-first
> terminal CLI. See `requirements.md` §9. Stages 1–5 replace it, and
> `plans/phase-0-plan.md` is superseded pending a rewrite.

> ✅ **All questions answered, 16 Sep 2026** (D20–D36). The stack is a **local program +
> browser UI in TypeScript**; the **LLM lands at Stage 2**; the build target is
> **`design/dashboard-concept.html`**; the app is called **Bearing**. Stage 1 is planned in
> [`plans/stage-1-plan.md`](plans/stage-1-plan.md) and ready to build.

---

## The shape of it

```
   GitHub  ──fetch──►  local cache  ──►  ONE canonical data structure  ──►  the GUI
  (Plane A:                                       ▲
   read-only)                                     │
                        your annotations ─────────┘
                    (Plane B: goals, tags, notes,
                     comments — synced between machines)
                                    ▲
                                    │
                            LLM summaries & judgements
                          (written into Plane B, never Plane A)
```

Three rules. The first two carry over from the old plan because they were right:

1. **One canonical data structure; every surface renders it.** If a view needs a fact, the
   fact goes into the structure — never computed inside the view.
2. **I/O at the edges, pure logic in the middle.** Fetch and storage at the boundary;
   pure, testable functions between.
3. **GitHub is already your sync.** Commits, branches, PRs and CI are identical on both
   machines because both read the same origin. Only Plane B — goals, tags, notes,
   comments, settings — needs a sync backend. A few kilobytes of text, not a pipeline.

---

## Stage 1 — The git history on screen  `← NEXT`

**The proof.** *"If exactly one thing worked a week from now it would be having the git
logs show up in the mockups I created — all of the descriptions from the commits, time,
etc. That's really the biggest thing that needs to be solved to prove this is possible."*

**What you get:** you open the app and see, for every branch across your repos, what was
actually done — in the commit authors' own words, newest first, grouped by repo and branch.

| # | Feature | Notes |
|---|---|---|
| 1.1 | Authenticate to GitHub; read the tracked repo list | Pasted read-only token for now (Q34) |
| 1.2 | List branches per repo with their PR state | `main` is the base, always |
| 1.3 | **Commit history per branch** — message, body, author, date, SHA | The core of the stage |
| 1.4 | PR state and CI status per branch | Cheap once you are already calling the API |
| 1.5 | Local cache + ETag change detection + live background updates | ~100 branches; costs near zero when nothing moved |
| 1.5b | **Dated snapshots written from day one** | D31 — change history cannot be backfilled |
| 1.6 | Supporting metadata: ahead/behind `main`, last activity, diff size | Secondary display, never the headline |
| 1.7 | Render into `design/dashboard-concept.html`'s layout | Board and Timeline light up; "Needs you" runs on CI + PR state; "Your notes" waits for Stage 3 |
| 1.8 | Settings screen: repos, refresh interval, display caps, thresholds | R8 — nothing hardcoded |

**Not in Stage 1:** no LLM, no goals, no tags, no notes, no sync.

**Exit:** on a normal working day you open it and can tell, from the screen alone, what
every active thread is doing — without opening GitHub.

---

## Stage 2 — LLM insight over the history

**The payoff, and your #2 priority.** Everything here needs only Stage 1 data.

| # | Feature | Notes |
|---|---|---|
| 2.1 | **Summarize a branch** from its commits — what this thread is actually doing, in a sentence or two | The thing that makes the screen look like the mockup |
| 2.2 | **Judge state**: progressing · stalled · blocked · effectively done | R4 |
| 2.3 | **"What changed since I last looked"** across everything | R5 |
| 2.4 | Cache by branch head SHA — re-summarize only when the branch actually moves | Keeps cost near zero on idle branches |
| 2.5 | **Comment tool on every LLM output**, stored locally for prompt-tuning | R7. Local storage now; Stage 4 syncs it. |
| 2.7 | **Conversation surface** — talk to the LLM about what it is showing you | R12, a requirement. Provider: OpenCode Zen (D32). |
| 2.6 | Every summary shows its evidence — which commits it came from | So a wrong summary is debuggable, not mysterious |

**Exit:** you open it after two days away and it tells you what moved and what stalled,
without you reading a single commit.

---

## Stage 3 — The organizing layer

**What you get:** your structure over their work. Branches become threads under goals,
under milestones.

| # | Feature | Notes |
|---|---|---|
| 3.1 | Author milestones and goals in the GUI | The one thing you maintain by hand |
| 3.2 | One goal per branch; sub-tasks under a branch may diverge from it | D29 |
| 3.3 | Tags on branches — free-form, many-to-many | R3 |
| 3.4 | Notes on branches / tasks / goals, entered in the GUI | R6 |
| 3.5 | Views: by goal, by milestone, by tag, plus the flat fleet view | |
| 3.6 | **LLM files unassigned branches into the right goal**, for your confirmation | R4 — removes the upkeep |
| 3.7 | **LLM rolls progress up** to goal and milestone level | R4 |

**Exit:** you look at a milestone and see every branch working toward it; you look at a
branch and know which goal it serves.

---

## Stage 4 — Sync between machines

Everything from Stages 1–2 already matches across machines because it comes from GitHub.
This syncs Plane B only.

| # | Feature | Notes |
|---|---|---|
| 4.1 | Set up Supabase | D28 |
| 4.2 | Schema for Plane B: milestones, goals, tasks, tags, notes, comments, settings | Small |
| 4.3 | Local-first writes, background push, last-write-wins per record | One user, two machines — conflicts are rare and cheap |
| 4.4 | Local backup file alongside the cloud copy | You asked for both |

**Exit:** make a goal on machine A, open machine B, it is there.

---

## Stage 5 — Packaging

| # | Feature |
|---|---|
| 5.1 | Single installable program with a desktop shortcut |
| 5.2 | Background refresh so it is current when you open it |
| 5.3 | Staleness indicator — "as of 11:42". A stale page that looks current is worse than no page. |

---

## Deferred indefinitely

Dropped by your answers. Kept here so the reasoning is not lost.

- **Hygiene, pruning, "safe to delete."** The goal is to hold *more* branches, not fewer.
- **Session reconstruction from local reflog.** Produces nothing for agent-created branches.
- **Markdown / terminal output.** There is no terminal in this workflow.
- **The multi-machine journal-file design.** Replaced by a cloud backend (Stage 4).
- **Churn, hotspots, file coupling.** Analytics about code, when the need is about threads of work.
- **The sandbox / Heading demo generator.** A generative feature for a tool that explicitly
  does not do the work.

---

## Nothing is blocked

Every question is answered (D20–D36). **Stage 1 is ready to build** —
[`plans/stage-1-plan.md`](plans/stage-1-plan.md).

One item to confirm before Stage 2 renders it: **Q37**, whether the LLM may write a short
plain-English title beside the literal branch name. Example in
[`decisions/open-questions.md`](decisions/open-questions.md).
