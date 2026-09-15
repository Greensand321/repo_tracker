# Open questions

**Raised:** 15 Sep 2026, after reviewing the spec, both plans, and the mockups together.

Answers go here (inline, under each question), and anything that settles a design choice
graduates to a row in [`decision-log.md`](decision-log.md).

Every question states **why it matters** — what changes depending on the answer — and a
**default**: what gets built if the question is never answered. A question whose default
you are happy with does not need an answer.

**Q1–Q5 are blocking.** They change what Phase 0 *is*, not just how it behaves.

---

## Blocking

### Q1 — Where do your branches actually come from?

Are the ~40 branches mostly (a) created by you locally, checked out, worked on at a
keyboard, or (b) created by agents — Claude Code sessions and similar — that push to
origin and are never checked out on your machine?

**Why it matters — this is the big one.** Phase 0's entire data model reads *local* git:
reflog entries, working-tree status, stashes. A branch that only ever existed on origin
produces **none** of those signals. No reflog entry, no uncommitted files, no stash. Its
`lastActivity` collapses to the tip commit date, `lastAction` is permanently `commit`, and
the "pick up where you left off" card — the centrepiece — can only ever say *"this branch
has the newest commit"*, which `git for-each-ref --sort=-committerdate` already tells you
in one line.

If the answer is (b) or mostly (b), then **GitHub is the primary data source, not the
secondary one**, and `collect_github.py` moves from Phase 1 into Phase 0. That reorders the
build. The evidence in this repo points at (b): the branch this work is on is
`claude/kind-meitner-cpis9v`, and `sync-branches.yml` exists to reconcile many branches
that a human is not merging by hand.

**Sub-questions if (b):** Does each agent session get its own branch? Do you review them
locally, or entirely on GitHub? When you "pick up" such a branch, what do you actually do
next — read the diff, open a PR, merge it, or pull it down?

**Default if unanswered:** build Phase 0 as specified (local-first), accept that
agent-created branches show only commit-date activity, and treat GitHub as Phase 1.

**Answer:**

---

### Q2 — What fills the "what was I doing" text in v1?

The mockups' most valuable content is prose: *"You refactored AuthStep into an explicit
state machine and pushed with CI still running. Two tests are red because `step.next`
returns undefined when the email field is empty."*

**Why it matters.** Deterministic git cannot produce that sentence. It can produce *"6
ahead, 0 behind, 3 uncommitted, last action commit 47m ago, base moved in your files."*
The prose comes from exactly two places: an LLM (Phase 4, deferred by decision #5) or notes
you typed yourself (Phase 1). So the Phase 0 HTML snapshot will be **correct, useful, and
visibly barer than the mockup that sold you on it.**

Three ways out, and I would rather you pick one now than discover this at the demo:

1. **Accept it.** v1 shows facts and a rules-based next step. Prose arrives in Phase 4.
2. **Pull notes forward.** Move parking notes from Phase 1 into Phase 0 so *you* supply
   the sentence on your way out the door. Cheap — a note store is ~60 lines — and it is
   the highest-value-per-line feature in the whole product. Depends on Q3.
3. **Pull the LLM forward** for narration only, breaking decision #5.

**Default if unanswered:** option 1.

**Answer:**

---

### Q3 — How do notes get entered, if you don't use a terminal?

Decision #9 says your daily surface is visual, not the terminal. Decision #8 says parking
notes are one-liner scratchpads. But the plan's interface for them is `bearing park "..."`
— a terminal command.

**Why it matters.** These two decisions cannot both hold as specified. Either notes get
captured in the GUI — which means the HTML needs a write path, which means the local
server from Phase 2 moves earlier and Phase 0's "one static file" property is gone — or
they get captured some other way the plan does not describe (a text file you edit, a
global hotkey, a tray app, a `.bat` that prompts).

**Options:** (a) type notes into the dashboard, accepting a server in Phase 0/1;
(b) a plain `notes.md` per repo that you edit in your editor and Bearing reads;
(c) keep the CLI command and accept that notes are the one terminal thing;
(d) no notes in v1.

**Default if unanswered:** (b) — a plain file Bearing reads is the cheapest thing that
respects both decisions, and it needs no write path at all.

**Answer:**

---

### Q4 — How do you launch it?

`bearing brief --html --open` is a terminal invocation, and nothing in the plan specifies a
non-terminal way to run it.

**Why it matters.** A tool you cannot start is not a tool. Phase 0 needs a launcher, and
which one changes what gets built: a double-clickable `.bat` on the desktop (trivial), a
scheduled task that regenerates the HTML every N minutes so the page is always fresh
(needs a scheduler and a "generated at" staleness indicator), a startup item, or a pinned
browser tab pointed at a local server (that is the Phase 2 server again, in Phase 0).

**Default if unanswered:** a `bearing.bat` in the repo that runs the brief and opens the
HTML, plus a note on pinning a shortcut.

**Answer:**

---

### Q5 — What does the "pick up where you left off" card actually *do* when you click it?

**Why it matters.** Bearing is read-only forever (decision #1), so it cannot check the
branch out for you. But the whole promise is *resuming*, and a card that only describes
the branch leaves you to do the switching by hand — which is the friction the tool exists
to remove.

**Options:** (a) nothing, it is a display; (b) copy `git checkout <branch>` to the
clipboard; (c) a button that opens the repo in your editor at that branch;
(d) a `bearing resume <branch>` command that *is* allowed to check out — a deliberate,
narrow, human-triggered exception to read-only, in the same spirit as `promote` in Phase 4.

**Default if unanswered:** (b). It is one line of JavaScript, breaks no invariant, and
removes most of the friction.

**Answer:**

---

## Your actual workflow

### Q6 — Which repos, and how many branches, really?

The plan assumes ~4 repos and ~40 branches on Windows. Still accurate? Which repos
specifically — and is `repo_tracker` itself one of the tracked repos (it should be; it is
the best possible dogfood).

**Why it matters.** Four repos and forty branches fits in one screen and under the 5 s
budget. Twenty repos and four hundred branches is a different product with a different
performance design and a different first view.

**Answer:**

---

### Q7 — What is a "task", and does it live anywhere outside your head?

The README frames this as *"organize tasks in a workflow… no more losing track of which
branch was in charge of which problem."* The spec never mentions tasks or issues at all —
it is branch-centric throughout.

**Why it matters.** If tasks live in GitHub Issues, Linear, Jira, or a markdown file, then
the branch→task link is a *fact Bearing can read* rather than something you must remember,
and "which branch was in charge of which problem" becomes answerable rather than
approximated. That is potentially a whole feature the spec is missing.

**Sub-question:** if there is no tracker, would you want Bearing to *be* one — a task per
branch, with state — or should it stay purely a reader of what already exists?

**Answer:**

---

### Q8 — One branch per task, or several?

And the reverse: do several branches ever serve one task (a spike, then the real
implementation)? Do you ever have two branches that are the *same* work, one abandoned?

**Why it matters.** Decides whether branches group in the UI, and whether "supersededness"
is worth detecting. (Spec §18 explicitly *removed* a "superseded" flag as uncomputable
without guessing intent — but if you name branches in a way that reveals it, it becomes
computable.)

**Answer:**

---

### Q9 — Multiple machines: true today, or aspirational?

The build plan invests significantly in a multi-machine journal (§2.1).

**Why it matters.** It is a good design, but it is a whole subsystem — machine IDs,
append-only journals, in-memory merge, origin labeling, a sync root you have to configure.
If you work on one machine today, all of Phase 1's F1.5–F1.7 can be deferred to Phase 3+
and Phase 1 gets much smaller.

**Answer:**

---

### Q10 — What does a typical interruption look like?

Lunch (an hour)? End of day? A week between touching a given branch? Switching between
repos ten times a day?

**Why it matters.** It sets `STALENESS_DAYS` (currently 7), what "recent" means in the
pickup tie-breaker (currently a 15-minute window), and whether the brief is something you
open once each morning or keep on a second monitor all day. Those are different products.

**Answer:**

---

### Q11 — Is the branch count supposed to go *down*?

Is 40 branches a problem to be solved (Bearing should push you to close them), or a
steady state to be navigated (Bearing should just make it legible)?

**Why it matters.** Spec §15 makes "branch reduction" a success metric, and Phase 3's exit
criterion is literally *"the flags measurably drive branch reduction."* If you are happy
with 40 branches, that metric is wrong and the hygiene features are lower value than the
plan assumes.

**Answer:**

---

## Scope and identity

### Q12 — Is `repo_tracker` the same thing as Bearing?

**Why it matters.** Right now the repo is `repo_tracker`, the product is `Bearing`, and
the package is `bearing`. That is fine if Bearing is the product and repo_tracker is just
where it lives — but if `repo_tracker` is meant to be a broader thing with Bearing as one
component, the layout should show that now, while it is free.

**Default if unanswered:** they are the same thing; "Bearing" is the product name.

**Answer:**

---

### Q13 — Personal tool, or something other people will run?

**Why it matters.** Changes how much goes into first-run experience, error messages,
config validation, cross-platform testing, and packaging. A personal tool can hardcode
your paths; a shared one cannot. The current plan is written for a personal tool with
unusually good hygiene.

**Answer:**

---

### Q14 — Confirming read-only forever

Decision #1 is that Bearing never writes to a tracked repo. Q5 option (d) and the Phase 4
`promote` command both nibble at that.

**Why it matters.** It is worth being deliberate, because read-only is the reason the tool
can never hurt you, and it is much easier to hold a line than to redraw one. Do you want
(a) genuinely never, (b) never except explicit human-triggered commands like
`resume`/`promote`, or (c) it is a default, not a principle?

**Default if unanswered:** (b).

**Answer:**

---

### Q15 — Does `sync-branches.yml` reflect how you want to work?

It merges main into every branch on demand, optionally merges every branch into main
first, and reports conflicts per branch. Its comments describe main as a disposable
integration branch, with real releases shipped outside GitHub.

**Why it matters, concretely.** That workflow and Bearing's `conflict-risk` flag are
computing nearly the same thing — one after the fact in CI, one predictively and locally
in milliseconds. Bearing could tell you *before* you run the sync which branches will
conflict, and afterwards which ones did. That is a real feature that neither document
currently contains, and it only makes sense if this workflow is central to how you work
rather than a one-off.

**Sub-question:** should Bearing read GitHub Actions run results at all (Phase 1's
`collect_github.py` could), or is CI status noise?

**Answer:**

---

## Phase 0 specifics

### Q16 — Is `main` the base branch everywhere?

Any repo using `develop`, a release branch, or a long-lived integration branch?

**Why it matters.** Every ahead/behind, diffstat, merged-ness, and conflict-risk number is
computed against the base. A wrong base makes every number on the page wrong, quietly.

**Default if unanswered:** `main`, with the fallback chain in phase-0 plan §4.

**Answer:**

---

### Q17 — Are the thresholds right?

Current defaults (spec §18): `active` = touched within **7 days** · `diverged` = behind
base by **more than 20 commits** · `conflict-risk` = any file changed on both sides since
the fork point · `almost-done` = PR green and untouched **more than 1 day**.

**Why it matters.** With 40 branches, a 7-day window may mark almost nothing active, or
almost everything. These are one-line constants — easy to change, but better to start near
right, because you will judge the tool by its first run.

**Answer:**

---

### Q18 — Are the section caps right?

The brief shows: 1 pickup branch, up to 12 active (including the pickup), up to 10
needing a decision. With 40 branches, roughly half are never shown.

**Why it matters.** Too few and you will not trust it; too many and it is the branch list
you already have. Should the HTML show *everything* with the top section highlighted,
given that scrolling a web page is free in a way that scrolling a terminal is not?

**Default if unanswered:** caps as specified for markdown; the HTML shows all branches,
with pickup/active/decisions as pinned sections above the rest.

**Answer:**

---

### Q19 — Do you want the Markdown brief at all in v1?

It is currently spec'd as the default CLI output, with HTML behind a flag.

**Why it matters.** If you never read terminal output, markdown is only plumbing for tests
and logs — and if so, **HTML should be the default and markdown the flag**, which is a
one-line change now and a confusing default forever if left.

**Default if unanswered:** flip it — `bearing brief` writes and opens the HTML; `--md`
prints markdown.

**Answer:**

---

### Q20 — Where should the HTML file live, and how fresh should it be?

Currently: `~/.bearing/brief.html`, regenerated when you run the command.

**Why it matters.** A stale page is worse than no page, because it looks current. If it is
regenerated on a schedule, it needs a prominent "as of 11:42" and a warning past some age.
If it is generated on demand, it is always fresh but always a manual step (see Q4).

**Answer:**

---

### Q21 — Which view is the daily driver?

Spec §14.2 commits to three: **The Bridge** (resume-first, default), **The Map** (spatial),
**The Logbook** (timeline).

**Why it matters.** Phase 2 builds all three, but Phase 0's static snapshot builds exactly
one, and the plan picks the Bridge. If you know you would live in the Logbook instead, the
Phase 0 snapshot should be a Logbook — and the Logbook needs session reconstruction
(F1.1), which would pull Phase 1 work into Phase 0.

**Default if unanswered:** the Bridge, as spec'd.

**Answer:**

---

## Environment and data

### Q22 — Is `gh` installed and authenticated on your machine?

**Why it matters.** Every GitHub feature is spec'd as `gh` passthrough with no token
management (decision #13). If `gh` is not there, that whole path needs rethinking — and
per Q1, GitHub may be the *primary* source rather than an enrichment.

**Answer:**

---

### Q23 — Python on Windows: how is it installed, and how do you run things?

**Why it matters.** Decides whether `pip install -e .` is a reasonable instruction or
whether Phase 0 should ship as a single-file script you can run with no install at all.
Given that you do not work in the terminal, "run `pip install -e .`" is already a
friction point in the acceptance criteria.

**Answer:**

---

### Q24 — Is there anything that must never leave your machine?

The HTML snapshot contains branch names, file paths, commit subjects, and diff sizes. It
is a local file — but it is also a file that gets opened in a browser, and one you might
send someone.

**Why it matters.** Decides whether repo names and paths should be redactable, and it is
the same question the Phase 1 journal answers with "metadata-only by default" (decision
#12). Worth answering once, for both.

**Answer:**

---

### Q25 — Should Bearing know about agent sessions?

If branches come from Claude Code sessions (Q1), there is metadata that git does not
have: which session made a branch, what it was asked to do, whether it finished, the
session URL.

**Why it matters.** *"This branch is from the session where you asked for X, which
finished"* is a far better answer to "which branch was in charge of which problem" than
anything git alone can give. It may also be the actual feature you want, with the git
analysis supporting it rather than the reverse.

**Answer:**

---

### Q26 — Hand-edited TOML config: acceptable for v1?

First run prints a config file for you to paste and create (phase-0 plan §4). There is no
`add` command until Phase 1.

**Why it matters.** For a no-terminal owner, "create `%USERPROFILE%\.bearing\bearing.toml`
and paste this" is the first thing the tool ever asks of you, and it is the worst part of
the current first-run experience.

**Default if unanswered:** on first run, auto-generate the config by scanning a folder you
point at, and write it for you.

**Answer:**

---

## Priorities

### Q27 — If exactly one thing worked a week from now, what should it be?

**Why it matters.** It reorders everything above. The plan's answer is "the HTML snapshot
names the branch you actually last touched" — if yours is different, say so and the build
order changes to match.

**Answer:**

---

### Q28 — How much of this do you want built versus specified?

Phase 0 is ~600–900 lines. I can build it end-to-end, or build the engine and leave the
renderers to you, or keep going on plans first.

**Answer:**

---

### Q29 — Should I start Phase 0 now, or wait on these answers?

Q6, Q16, Q17, Q22, and Q23 are answerable in a minute and unblock a lot. Q1 is the one
that could send the design somewhere different — starting before it is answered risks
building the activity model twice.

**Default if unanswered:** start with the parts no answer changes — the fixture builder,
the data model, and `collect_git.py` — and stop before `analyze_branch.py`, which is where
Q1 first bites.

**Answer:**
