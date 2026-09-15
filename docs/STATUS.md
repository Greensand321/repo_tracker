# Status — where the project stands

**Updated:** 15 Sep 2026 · **Stage:** planning · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## Where we are

**The product changed on 15 Sep 2026**, when the owner answered the first round of
questions. It is not the tool the old spec describes.

| | Old documents assumed | Actually true |
|---|---|---|
| Who writes the code | The owner, at a keyboard | **AI agents**, each session on its own branch, pushed to origin |
| Data source | Local git — reflog, working tree, stashes | **GitHub.** Local signals are empty for agent branches. |
| Surface | A terminal CLI printing markdown | **A GUI.** No terminal. |
| Content | Branch state: ahead/behind, flags, SHAs | **Plain English** — what was committed, not when |
| Organizing | Nothing | **Milestones → Goals → Tasks → Branches**, plus tags |
| Sync | A folder replicated by Dropbox | **A cloud backend**, two machines daily |
| Success | Fewer branches | **More branches**, less mental load |

Written up in [`requirements.md`](requirements.md). Both implementation plans are
superseded; `ROADMAP.md` is rebuilt around Stages 1–5.

## The next concrete action

**Answer the two blocking items in [`decisions/open-questions.md`](decisions/open-questions.md).**

| | | |
|---|---|---|
| **Q30** | **The stack.** Local program + browser UI, pure browser page, or desktop app — and Python or TypeScript. | Blocks all of Stage 1 |
| **C1** | **Where the LLM goes.** You said defer it; you also ranked it your #2 priority and made it responsible for goal upkeep. It is currently at Stage 2. | Blocks the stage order |

Then six smaller ones: C4 (scale), C5 (time display), C6 (evolving tasks), Q31 (which
mockup), Q32 (goal cardinality), Q34 (GitHub auth).

## Then — Stage 1

Get the git history on screen in plain English: authenticate to GitHub, list repos and
branches, fetch commit history and PR/CI state per branch, cache it, render it into the
chosen mockup. No LLM, no goals, no sync.

*"That's really the biggest thing that needs to be solved to prove this is possible."*

## Nothing is implemented

`bearing/` holds a Python CLI skeleton from the old design. It is three small files and
**will likely be deleted** once Q30 is answered — do not build on it.

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.3; build plan v0.2; Phase 0 plan; mockups explored, dashboard-first chosen |
| 15 Sep 2026 | Repo reorganized: `docs/` structure, roadmap, decision log, package skeleton |
| 15 Sep 2026 | `sync-branches.yml` → `.github/workflows/`; roadmap expanded; 29 questions raised |
| 15 Sep 2026 | **Owner answered. Product substantially redefined.** `requirements.md` written; roadmap rebuilt as Stages 1–5; decision log restructured; both plans marked superseded; 6 conflicts and 11 new questions raised |
