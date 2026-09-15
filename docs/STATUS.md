# Status — where the project stands

**Updated:** 15 Sep 2026 · **Phase:** 0 (not started) · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this file short and current. It is the first thing to read after any time away —
> the same job Bearing does for branches, done by hand for the repo itself.

---

## Where we are

Planning is done and now cross-checked. Nothing is implemented.

- Spec is at **v0.3**, its major questions resolved (`spec/bearing-spec-v0.3.html`).
- Phase 0 plan is **ready for handoff** — exact commands, schemas, thresholds (`plans/phase-0-plan.md`).
- **`ROADMAP.md` is the cohesive plan**: every feature mapped to the code that implements
  it, the dependency spine, a Phase 0 build order, and a master module inventory.
- Visual direction settled: dashboard-first, "The Bridge" layout (`design/`).
- Repo reorganized 15 Sep; branch-sync workflow moved to `.github/workflows/`.

## The next concrete action

**Answer the blocking questions in [`decisions/open-questions.md`](decisions/open-questions.md).**
There are 29; five of them change what Phase 0 *is*:

| | Question | What it changes |
|---|---|---|
| **Q1** | Are branches created by you locally, or by agents pushing to origin? | Whether GitHub is the primary data source. Could move `collect_github.py` into Phase 0 and rewrite the activity model. |
| **Q2** | What fills the "what was I doing" prose in v1? | Whether notes (Phase 1) or the LLM (Phase 4) move earlier, or v1 ships facts only. |
| **Q3** | How do notes get entered, with no terminal? | Whether Phase 0 stays one static HTML file or needs a local server. |
| **Q4** | How do you launch it? | Whether Phase 0 needs a launcher, a scheduled task, or a server. |
| **Q5** | What does the pickup card *do* when clicked? | Whether read-only gets a narrow, deliberate exception. |

Q6, Q16, Q17, Q22 and Q23 take a minute each and unblock a lot.

## Once unblocked — the Phase 0 build order

Full detail in `ROADMAP.md`. In sequence:

1. `tests/fixture_builder.py` — deterministic repos with pinned dates. Everything is
   tested against it, so it is genuinely first.
2. `bearing/model.py` — dataclasses only; forces the schema decisions early.
3. `bearing/collect_git.py` — the single I/O boundary. Every subprocess call lives here.
4. `bearing/config.py` — load, validate, resolve bases, first-run message.
5. `bearing/analyze_branch.py` — **Q1 bites here.** Flags, activity model, conflict-risk.
6. `bearing/nextstep.py` → `prioritize.py`
7. `bearing/render_json.py` → `render_markdown.py` (golden files)
8. `bearing/render_html.py` — the Bridge snapshot. **The deliverable that matters.**
9. `bearing/cli.py` — thin.
10. Integration, perf, and the read-only assertion test.

Steps 1–4 are safe to start before Q1 is answered; step 5 is not.

## Watch out for

- **The activity model is the subtle part.** A checkout is recorded in *HEAD's* reflog, not
  the branch's. A branch with an old tip commit but a recent checkout must still rank as
  recent. Required test.
- **Timezones.** Parse ISO-8601 with offsets, convert to aware UTC immediately, never
  compare naive datetimes across repos.
- **Windows first.** Paths with spaces and backslashes, end to end. Never build shell
  strings.
- **Read-only is a hard invariant**, not a goal. There is an acceptance test for it.

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.2 → v0.3; build plan v0.2; Phase 0 plan written; mockups explored, dashboard-first chosen |
| 15 Sep 2026 | Repo reorganized: `docs/` structure, roadmap, decision log, package skeleton at root |
| 15 Sep 2026 | `sync-branches.yml` → `.github/workflows/`; roadmap expanded to features + code; 29 open questions raised, 5 blocking |
