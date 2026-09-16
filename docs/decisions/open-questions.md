# Open questions

**Round 1:** asked 15 Sep 2026, **answered 15 Sep 2026**. Recorded in §1 below.
**Round 2:** the conflicts those answers created (§2) and the decisions still needed (§3).
**Q30, Q31 and C1 were answered 16 Sep** and became decisions D20–D23 — **nothing is
blocking now.** Everything still open has a working default and can be settled while
Stage 1 is built.

Answers go inline. Anything that settles a design choice graduates to
[`decision-log.md`](decision-log.md); anything that describes the product goes to
[`../requirements.md`](../requirements.md).

---

## 1. Round 1 — answered

| Q | Answer | Landed in |
|---|---|---|
| Q1 Where do branches come from? | **Agents** — Claude Code, sometimes t3 code, each session on its own branch, pushed to origin. Owner merges to `main` by hand or via the sync workflow. Sessions run a week or more and evolve; context deliberately not rotated. | requirements §2 — **this changed the whole design** |
| Q2 What fills the prose in v1? | Accepts it will look incomplete until the LLM; said keep the LLM deferred. | **Conflicts with Q27 — see C1** |
| Q3 How do notes get entered? | **GUI.** Terminal almost never, only to debug. | R6 |
| Q4 How do you launch it? | Click a file — an `index.html` in the root for now, a proper installed program with a shortcut later. CLI is "backend code to reference," not needed if there is a better way. | requirements §5 |
| Q5 What does the pickup card do? | *"No idea what this means"* → re-explained below, **still open (Q35)** | — |
| Q6 Scale | ~8 repos; 3–4 active at a time; ≤4 branches each. | requirements §2 — **partly conflicts with Q10, see C4** |
| Q7 What is a task? | Wants **tags**, **goals**, and **milestones**. Owner authors milestones and goals; the **LLM** does the upkeep of judging progress and filing branches. Minimal manual input — the repo already holds the information. | R2, R3, R4 |
| Q8 Branch/task shape | **Milestone → Goals → Tasks → one task per branch.** Milestones are release-level markers. | R2 |
| Q9 Multiple machines | **A must.** Two machines daily. Likely Supabase or Firebase. | R9, Stage 4 |
| Q10 Branch count | **40 is steady state. The goal is *more* branches, not fewer** — hold more threads with less mental load. | requirements §2, §7 |
| Q12 Is it "Bearing"? | *"I don't know what you mean by bearing"* → **still open (Q36)** | — |
| Q13 Personal or shared? | **Personal.** | requirements §6 |
| Q14 Read-only forever? | *"Not sure what you mean"* — but: reference, not editable, **plus a comment tool on AI outputs** for prompt-tuning. | Resolved as the two-plane model, requirements §4. New feature R7. |
| Q15 The sync workflow | Stays as is — a bulk "merge everything to main" time-saver, used when several branches finish together so context does not drift. Not part of this tool. | requirements §7 |
| Q16 Base branch | **`main`, only, everywhere.** | requirements §6 |
| Q17 Thresholds | **Nothing hardcoded** — expose in settings. | R8 |
| Q18 Caps | Capping is good; scrolling/paging wanted but deferred as too technical for now. | R10 |
| Q19 Markdown brief | *"This is going to be all in the GUI in clear text… odd question, makes me think you have a slightly wrong idea."* **Correct — I did.** Markdown and terminal output are dropped entirely. | requirements §5 |
| Q20 Where does the HTML live? | Root, named `index`/`connect`; clicking it boots the program. | requirements §5, **Q30 affects how** |
| Q21 Which view? | *"Start with the first mockup"* → **ambiguous, still open (Q31)** | — |
| Q22 `gh` / dependencies | Authenticated elsewhere, but this is built from the ground up. **Dependencies allowed** if they make things easier. Everything uses GitHub. | requirements §6 — overturns stdlib-only |
| Q23 How you run it | Source in a folder, booted from **VS Code** for now; single installable program eventually. | requirements §5 |
| Q24 Privacy | Backed up locally, saved to the cloud (Firebase/Supabase). | requirements §6 |
| Q25 Agent-session awareness | **Yes, exactly the goal.** *"The raw git bullcrap is not what I need — I care what was committed, in plain English."* | requirements §1 — **partly conflicts with Q27, see C5** |
| Q26 Auto-generate config | Yes. | Stage 1.8 |
| Q27 One thing in a week | **Git logs in the mockup** — commit descriptions, time, etc., as the foundation the LLM later uses. Second: **the LLM reading those logs and giving useful insights.** | Stage 1, Stage 2 |
| Q28 Built vs specified | *"Everything is going to be built, I don't care for specs, they're just steps to the final product."* | Understood — see the re-explanation below |
| Q29 Start now? | Organize first, flag inconsistencies, then build. | This document |

---

## 2. Round 2 — conflicts your answers created

These are places where two things you said cannot both be true as stated. Each needs a
one-line answer from you.

### C1 — The LLM cannot be both deferred and second ✅ **ANSWERED 16 Sep → D21**

**Answer: Stage 2**, right after the git history. Reasoning below stands.



You said (Q2) to keep the LLM deferred until last. But you also said the LLM should do the
upkeep of judging branch and milestone progress (Q7), that plain-English summaries are the
actual point (Q25), and that "the LLM reading those logs and giving me useful insights" is
the **second** thing you want working (Q27).

Those are not compatible. The LLM is not a finishing touch here — it is the engine of the
organizing layer, and without it the goal/milestone system needs you to maintain it by
hand, which is exactly what you said you did not want.

**I have put it at Stage 2**, right after the git history lands. Say if you would rather it
stay last, and I will move the organizing layer ahead of it — but then expect to file
branches into goals manually until it arrives.

### C2 — "Read-only" versus notes, tags, goals and comments

Not really a conflict once split apart, but the old docs conflated it, so here it is
explicitly. **Two planes:**

- **Plane A — your repos.** Strictly read-only, forever. The tool never pushes, merges,
  branches, stashes, or changes config. This is the invariant that means it can never
  damage your work.
- **Plane B — the tool's own data.** Milestones, goals, tags, notes, comments, settings.
  The tool owns this and writes it freely. It lives in the tool's database, never in your
  repos.

**Confirm this is what you meant.** Everything downstream assumes it.

### C3 — Offline-first versus the cloud

Every old document insists the tool does no networking and works fully offline. Your
answers make it network-dependent by design: GitHub is the data source, and sync runs
through Supabase or Firebase.

**Resolution I have written down:** network-first, with the local cache providing a
degraded read-only offline view. Flag if you wanted stronger offline behaviour.

### C4 — 8 repos × 4 branches, versus 40 branches

Q6 says ~8 repos, 3–4 active at a time, ≤4 branches each — that is 12–16 active branches.
Q10 says 40 is steady state. I have assumed **~40 branches exist across 8 repos, of which
12–16 are actively moving at any time.** Confirm, because it decides whether the default
view shows everything or only what is live.

### C5 — "I don't care what time it was committed" versus "descriptions, time, etc."

Q25 says timestamps are noise; Q27 lists time as something you want shown. **I have assumed
the commit message is the headline and time appears as a relative subtitle** ("2 days
ago"), with exact timestamps and SHAs available but not prominent. Confirm.

### C6 — Long evolving sessions versus one task per branch

You said a session can run a week or more and evolve as the work changes (Q1), but also
that it is one task per branch (Q8). If a branch's work changes shape halfway through, its
"task" has drifted.

**Options:** (a) the task is whatever the branch is doing *now*, and the LLM re-titles it
as it evolves; (b) the task is fixed at creation and you re-file manually; (c) a branch
keeps a short history of what it has been about. **I lean (a)**, since it needs no upkeep
from you.

---

## 3. Round 2 — decisions still needed

### Q30 — The stack ✅ **ANSWERED 16 Sep → D20**

**Answer: option A — a local program + browser UI — in TypeScript.** Planned in
[`../plans/stage-1-plan.md`](../plans/stage-1-plan.md) §1. Reasoning below stands.



You want: click something → the app opens · reads GitHub · stores your notes and goals ·
syncs to a second machine · is a proper installed program eventually · developed from VS
Code now.

Three ways to build that:

| | **A. Local program + browser UI** | **B. Pure browser app** | **C. Desktop app (Tauri/Electron)** |
|---|---|---|---|
| What you click | `start.bat`, or a shortcut to it | `index.html` directly | A real `.exe` |
| GitHub token | Held by the program, never in the browser | Lives in browser storage | Held by the app |
| Stores notes/goals | Local file + cloud | Cloud only (browser cannot write files) | Local file + cloud |
| Works from `file://` | N/A | **Fragile** — browsers block API calls and modules from `file://` | N/A |
| Iterate in VS Code | Yes, run and refresh | Yes | Yes, slightly heavier |
| Becomes a single installed program | Yes (bundled to one `.exe`) | Needs wrapping in C anyway | Already is one |
| Language | Python or Node backend + HTML/JS front | HTML/JS only | HTML/JS + a thin Rust/Node shell |

**My recommendation: A.** It is the shortest path to Stage 1, keeps your GitHub token out
of the browser, writes a local backup naturally, and bundles into a single `.exe` later
without a rewrite. The one honest cost: you click `start.bat` rather than `index.html` —
identical once a shortcut is pinned.

**B is tempting** — literally one file you double-click — but `file://` restrictions bite
immediately, and it can never write a local backup.

**Sub-question: Python or Node/TypeScript for the backend?** Python matches the existing
documents. TypeScript means one language across front and back and has first-class
Supabase and GitHub libraries. **I lean TypeScript** given the GUI is the product and the
old Python-CLI reasoning no longer applies — but Python is a fine choice and I will take
your preference.

**Answer:**

---

### Q31 — Which mockup, exactly? ✅ **ANSWERED 16 Sep → D22**

**Answer: `design/dashboard-concept.html`.** What it can and cannot show with Stage 1 data
is mapped field by field in [`../plans/stage-1-plan.md`](../plans/stage-1-plan.md) §4.



"Start with the first mockup" is ambiguous — there are two candidates and they are very
different:

1. **`design/prototype/bearing-prototype.html`, variant A ("The Bridge")** — the first of
   three switchable variants. Resume-first: one hero card on top, then attention flags,
   then per-project lanes of branch cards.
2. **`design/dashboard-concept.html`** — the newer standalone concept. Board / Timeline /
   Notes / Needs views, per-branch step checklists, recall + blocker + next, command palette.
   Denser, and closer to what you describe wanting.

Open both and say which. **I lean 2** — it already has the timeline and notes surfaces your
answers call for, where variant A is built around a "you were just here" moment that does
not apply when agents did the work.

**Answer:**

---

### Q32 — Can a branch serve more than one goal?

You said one task per branch, goals have many tasks — but also *"I want the option to
assign as many branches to however many tasks."* Those differ.

**Options:** (a) strict — one branch → one task → one goal (simplest, clearest views);
(b) flexible — a task may span branches and a branch may serve several goals (more true to
messy reality, but every view needs to handle duplicates).

**I lean (a) for the schema, with tags (R3) covering the cross-cutting cases** — that gets
you the flexibility without the ambiguity.

**Answer:**

---

### Q33 — Supabase or Firebase?

Only Plane B syncs — goals, tasks, tags, notes, comments, settings. Kilobytes of text.

**I lean Supabase**: it is plain Postgres, the data is relational (milestone → goal → task),
the free tier covers this comfortably, and you can inspect and fix your own data in a SQL
editor. Firebase is document-oriented and would fit this hierarchy less naturally.

**Answer:**

---

### Q34 — How should it authenticate to GitHub?

**Options:** (a) a personal access token you paste into settings once (simplest, works
immediately, you control the scopes); (b) a GitHub App / OAuth flow (nicer, more setup,
more code); (c) shell out to the `gh` CLI you already have authenticated (no token
handling at all, but requires `gh` installed on both machines and makes packaging harder).

**I lean (a)** — a fine-grained, read-only token scoped to your repos, stored locally,
never synced to the cloud.

**Answer:**

---

### Q35 — What happens when you click a branch? *(this was Q5, re-explained)*

My original question was badly worded. Plainly: **when you click a branch on the screen,
what do you want to happen?**

The tool will not check anything out — it never touches your repos. So the options are:

- (a) It expands to show the full commit history, notes and detail, and nothing else.
- (b) Same, plus buttons that open that branch or its PR **on GitHub** in your browser.
- (c) Same, plus a button that copies `git checkout <branch>` to your clipboard.

**I lean (b)** — given the work happens on GitHub, jumping straight to the PR is probably
the action you actually want.

**Answer:**

---

### Q36 — Is it called "Bearing"? *(this was Q12, re-explained)*

"Bearing" is the product name used throughout the spec and mockups you were given — it
came from those documents, not from you, which is presumably why it did not land. The
metaphor is the one you used yourself: *"to get my bearings straight."*

The repo is `repo_tracker`, the documents say `Bearing`, and the code package is `bearing`.
**Keep the name, or pick another?** Purely cosmetic, but cheap to fix now and annoying
later.

**Answer:**

---

### Q37 — Does the LLM get to write a human-readable title per branch?

The old spec locked "always literal git branch names, never invented ones." But the mockups
show human titles ("the signup flow") and you want plain English over raw git.

**Proposal:** the literal branch name is always shown and always searchable; the LLM adds a
generated one-line title *alongside* it, clearly marked as generated. Best of both — you
can still find the branch, but you read English first.

**Answer:**

---

### Q38 — Which LLM, and who pays for the calls?

Stage 2 needs a provider. The old build plan named OpenCode Zen; that was chosen for a
different design. Options: the Anthropic API directly (a key in settings, pay per use),
whatever you already subscribe to, or something local.

Volume is low — one summary per branch, re-run only when the branch moves — so this should
be cents per day, not dollars.

**Answer:**

---

### Q39 — How fresh should the data be?

**Options:** refresh when you open the app · refresh on a button · refresh in the
background every N minutes.

**I lean:** refresh on open, plus a manual refresh button, plus a visible "as of" timestamp.
Background refresh arrives with packaging (Stage 5).

**Answer:**

---

### Q40 — Does t3 code need different handling?

You mentioned agents are Claude Code *and sometimes t3 code*. If they name branches
differently, or if one of them leaves metadata the other does not, the tool may need to
know the difference.

**Do they both just push normal branches with normal commits?** If so, no special handling
is needed and this is a non-question.

**Answer:**

---

## Appendix — two things I explained badly the first time

**"Built versus specified" (Q28).** Fair — that was jargon. I meant: how much should I write
down before writing code? Your answer is clear: specs are steps toward the product, not the
point. So I am keeping documentation to what earns its place — this file, `requirements.md`,
`ROADMAP.md`, and the decision log — and building from there.

**"How do you launch it" (Q4).** The real question underneath was whether the app needs a
program running in the background, because that is a genuine fork in the road, not a
detail. A plain `.html` file you double-click cannot hold a GitHub token safely or write
files to your disk; something running behind it can. That is exactly what Q30 asks, and it
is why it blocks everything else.
