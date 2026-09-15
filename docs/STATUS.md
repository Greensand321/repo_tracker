# Status — where the project stands

**Updated:** 15 Sep 2026 · **Phase:** 0 (not started) · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this file short and current. It is the first thing to read after any time away —
> the same job Bearing does for branches, done by hand for the repo itself.

---

## Where we are

Planning is **done**. Nothing is implemented.

- Product spec is at **v0.3** and its major questions are resolved (`spec/bearing-spec-v0.3.html`).
- The Phase 0 implementation plan is **ready for handoff** — exact git commands, exact
  schemas, exact thresholds, acceptance criteria (`plans/phase-0-plan.md`).
- The visual direction is settled: dashboard-first, "The Bridge" layout (`design/`).
- This repo was reorganized on 15 Sep 2026: docs under `docs/`, source at the root.

## The next concrete action

**Implement Phase 0, starting with the git collector.** Work test-first, in the order the
plan lays out:

1. `tests/fixture_builder.py` — deterministic scratch repos with pinned commit dates.
   Everything else is tested against these, so it comes first.
2. `bearing/collect_git.py` — the single I/O boundary. Every subprocess call in the
   codebase lives in this file. Commands are listed in phase-0 plan §5.
3. `bearing/analyze_branch.py` → `prioritize.py` → `nextstep.py` — all pure, all unit-tested.
4. `bearing/render_markdown.py` + `render_json.py` — golden-file tested.
5. `bearing/render_html.py` — the Bridge snapshot. **This is the deliverable that matters**;
   the owner does not read terminal output.
6. `bearing/cli.py` + `config.py` — thin, I/O only.

Size check from the plan: ~600–900 lines of Python excluding tests. Past ~1,500, something
is being over-built.

## Watch out for

- **The activity model is the subtle part.** A checkout is recorded in *HEAD's* reflog, not
  the branch's. A branch with an old tip commit but a recent checkout must still rank as
  recent. There is a required test for exactly this (phase-0 plan §5, §11).
- **Timezones.** Parse ISO-8601 with offsets, convert to aware UTC immediately, never
  compare naive datetimes across repos.
- **Windows first.** Paths with spaces and backslashes must work end-to-end. Never build
  shell strings; always pass argument lists.
- **Read-only is a hard invariant**, not a goal. There is an acceptance test for it.

## Open questions blocking nothing

Listed in `decisions/decision-log.md` under "Still open". None of them block Phase 0.

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.2 → v0.3; build plan v0.2; Phase 0 plan written; mockups explored, dashboard-first chosen |
| 15 Sep 2026 | Repo reorganized: `docs/` structure, roadmap, decision log, package skeleton at root |
