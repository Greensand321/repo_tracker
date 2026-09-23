# Working in this repo

This repo builds a **personal reference dashboard**: it reads every branch across the
owner's GitHub repos and shows, in plain English, what each thread of work is doing.

**Read [`docs/requirements.md`](docs/requirements.md) first**, then
[`docs/STATUS.md`](docs/STATUS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

> ⚠️ The product was substantially redefined on 15 Sep 2026. The spec in `docs/spec/` and
> both files in `docs/plans/` describe a *different tool* — a local-first terminal CLI
> reading local git. **Do not implement from them.** `requirements.md` outranks everything.

## The one thing to understand

Branches here are created by **AI agents** (Claude Code, t3 code) — one branch per session,
pushed to origin, sessions running a week or more. They are never checked out on the
owner's machines. So **local git signals — reflog, working tree, stashes — are empty for
the branches that matter.** GitHub is the data source. Any design that leans on local git
state is wrong by construction.

## Layout

- **Root is program files.** `docs/` is everything written.
- Precedence: `requirements.md` > `ROADMAP.md` > `plans/stage-1-plan.md` >
  `decisions/decision-log.md` > `spec/` > the other `plans/` files > `archive/`.
  Everything after the decision log is superseded — reasoning, never instructions.

## The stack

A **local program + a browser UI, in TypeScript** (D20). Node 22+, Hono for the server,
Octokit for GitHub, Vite + vanilla TS for the front end. You click `start.bat`; it opens
the browser. Full detail: [`docs/plans/stage-1-plan.md`](docs/plans/stage-1-plan.md) §1.

Vanilla TS, not a framework (D23) — the mockup is vanilla, so it transplants directly.
Revisit at Stage 3 if the UI gets painful.

## Hard rules

1. **Two data planes.** *Plane A* — the owner's repos — is **strictly read-only forever**:
   no push, merge, branch, stash, or config change, ever. *Plane B* — milestones, goals,
   tags, notes, comments, settings — is the tool's own database, written freely. Never
   write Plane B data into a git repo.
2. **GUI only.** No terminal as a product surface, no markdown output, no CLI-shaped
   design. A command-line entry point may exist for debugging; nothing is shaped by it.
3. **Plain English is the headline.** Commit messages, PR titles, LLM summaries. SHAs,
   ahead/behind counts and timestamps are supporting metadata, shown small.
4. **One canonical data structure; every surface renders it.** If a view needs a fact, put
   the fact in the structure — never compute it inside the view.
5. **I/O at the edges, pure logic in the middle.** Fetching and storage at the boundary;
   pure, testable functions between. That is where the tests go.
6. **The literal git branch name is always shown and always searchable.** An LLM-generated
   title may sit alongside it, clearly marked — never instead of it.
7. **Nothing hardcoded.** Thresholds and display caps belong in settings.
8. **Windows-first.** Two machines, used daily. Paths with spaces must work.
9. **Write dated snapshots of branch state from day one** (D31). Nothing reads them yet.
   They exist because "what changed and by how much" cannot be reconstructed after the
   fact — skip this and the feature becomes impossible, not merely unbuilt.
10. **Stale branches fold away; they are never deleted or dropped from the data** (D35).
   ~100 branches exist, a few dozen matter at any time.

## How the assistant works

Six prompts, all of them Plane B. Before changing any of them, open
[`docs/design/ai-map.html`](docs/design/ai-map.html): every path, what each call sees and
decides, what it may never do, and which `PROMPT_VERSION` to bump when you edit one.

The four background ones are **derived onto a board and run by one dispatcher**
(`server/work/`), which checks each job against the snapshot rather than believing the
model, and parks anything that fails twice. Three of them can **look things up** before
answering — a station's tool list is part of its cache key (D74). Work the owner asks for
runs in its own lane and is the only kind written to disk (D72). The advisor is **the desk**
(D84): it may read how the fleet moved and may put work on the board through the same door
the page's buttons use — never do it, never write a goal; a regrouping it proposes is filed
only when the owner accepts it. It **remembers the last few exchanges** (D93), in memory,
expiring; the state is re-read every turn and the transcript is never a source of facts.
**This is changing** (D94, confirmed): it changes anything in Plane B when asked — never
settings, never unprompted — every change recorded, shown in a changes feed and undoable,
with Plane A read-only enforced by structure. Plan:
[`docs/plans/agent-autonomy.md`](docs/plans/agent-autonomy.md). Adding a station is adding a row in `board.ts`, not a stage
in a pipeline. Plan: [`docs/plans/workroom.md`](docs/plans/workroom.md).

**Every file the program keeps goes through `server/jsonfile.ts`** (D85): atomic writes, and
a broken file set aside rather than overwritten. Pruning is scoped to repos a read reached
(D86) — a repo GitHub would not serve is missing, not deleted.

## Before adding anything

Check [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md) — §3 lists what
was already overturned and why, so dead ideas do not get rebuilt. Check the stage in
[`docs/ROADMAP.md`](docs/ROADMAP.md): each one names what it explicitly does *not* include.

**Stage 1 is the current work** and is planned in full at
[`docs/plans/stage-1-plan.md`](docs/plans/stage-1-plan.md). Nothing blocks it. Remaining
open questions all have working defaults — see
[`docs/decisions/open-questions.md`](docs/decisions/open-questions.md).

## When you finish a session

Update `docs/STATUS.md`: where things stand, the next concrete action, and a row in the
log. If you settled a decision, add it to the decision log **with its reason**. If a
document was superseded, say so in it and record what replaced it — do not delete it.
