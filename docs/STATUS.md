# Status — where the project stands

**Updated:** 16 Sep 2026 · **Stage:** 1, ready to build · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## Where we are

Planning is finished. **Nothing blocks the build.**

The product was redefined on 15 Sep once the real workflow was understood: branches are
created by **AI agents** — one per session, pushed to origin, sessions running a week or
more — and are never checked out locally. GitHub is the data source. The surface is a GUI.
The content is plain English, not git facts. Written up in
[`requirements.md`](requirements.md).

The four gating decisions were answered on 16 Sep:

| | Decision |
|---|---|
| **Stack** | A local program + a browser UI, in **TypeScript**. Node 22+, Hono, Octokit, Vite + vanilla TS. You click `start.bat`. |
| **LLM** | **Stage 2** — right after the git history lands, not last. |
| **Layout** | Build from `design/dashboard-concept.html`. |
| **Scale** | ~100 branches; a few dozen relevant. Live background refresh via ETag change detection. |
| **Front end** | Vanilla TS, not a framework — the mockup transplants directly. |

## The next concrete action

**Build Stage 1**, planned in full at [`plans/stage-1-plan.md`](plans/stage-1-plan.md).

> *"If exactly one thing worked a week from now it would be having the git logs show up in
> the mockups I created."*

Ten steps, in order. Step 7 is the milestone — the moment real commit history renders in
the mockup's Board view. Steps 1–6 are plumbing toward it.

1. Scaffold + `start.bat` → a page that says hello
2. Settings screen: paste a GitHub token, add repos
3. `github.ts` against one repo — prove auth and pagination
4. `snapshot.ts` + tests against recorded fixtures *(no network in tests)*
5. `GET /api/snapshot` returns a real Snapshot
6. Lift the mockup's markup and CSS into `web/`
7. **Render the Board view from real data** ← the proof
8. Timeline view, then Needs-you from CI + PR state
9. Cache, incremental refresh, "as of" timestamp
10. Second machine — clone, paste token, confirm

## What Stage 1 will and will not show

The mockup's `log[]` — the commit trail — is exactly what Stage 1 delivers, along with
ages, commit counts, CI state, PR titles and the activity strip. Its invented branch titles
("the signup flow"), the recall/blocker/next prose, and the step checklists are **Stage 2**,
when the LLM arrives. Your notes are **Stage 3**. Field-by-field map:
`plans/stage-1-plan.md` §4.

## Everything is answered

Round 2 closed 16 Sep → D20–D36. The app is **Bearing**. Auth is a pasted read-only token.
Sync is **Supabase**. The LLM is **OpenCode Zen**. One goal per branch, sub-tasks may
diverge. Refresh is live. ~100 branches, a few dozen relevant.

One item to confirm before Stage 2 renders it: **Q37** — may the LLM write a short
plain-English title beside the literal branch name? Example in
[`decisions/open-questions.md`](decisions/open-questions.md).

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.3; build plan v0.2; Phase 0 plan; mockups explored |
| 15 Sep 2026 | Repo reorganized: `docs/` structure, roadmap, decision log |
| 15 Sep 2026 | `sync-branches.yml` → `.github/workflows/`; 29 questions raised |
| 15 Sep 2026 | **Owner answered. Product redefined.** `requirements.md` written; roadmap rebuilt as Stages 1–5; both old plans superseded; 6 conflicts + 11 questions raised |
| 16 Sep 2026 | **Gating decisions made (D20–D24).** Stage 1 planned; Python skeleton deleted; nothing blocking |
| 16 Sep 2026 | **All remaining questions answered (D25–D36).** Name, auth, Supabase, OpenCode Zen, one-goal-per-branch, live refresh, ~100 branches. Stage 1 plan revised for scale, change detection and dated history |
