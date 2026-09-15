# Working in this repo

This repo builds **Bearing** — a local-first, read-only tool that reconstructs a
developer's working context across many branches and repos. Start with
[`docs/STATUS.md`](docs/STATUS.md) for where things stand, then
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Layout

- **Root is program files.** `bearing/` (the package), `tests/`, `pyproject.toml`.
- **`docs/` is everything written.** `spec/` · `plans/` · `design/` · `decisions/` · `archive/`.
- Document precedence when sources disagree: **spec v0.3 > phase-0 plan > build plan v0.2
  > archive.** `docs/archive/` is reasoning, never instructions.

## Hard rules — these are invariants, not preferences

1. **Never write to a tracked repo.** Bearing reads. No branch, no stash, no ref, no config
   change, ever. There is an acceptance test for this.
2. **Python 3.11+, stdlib only.** No third-party runtime dependencies. `tomllib`,
   `argparse`, `subprocess`. Test tooling may be dev-only.
3. **All git access goes through `collect_git.py`**, via `subprocess` with porcelain or
   machine formats. Never parse human-readable git output. Never build shell strings —
   always pass argument lists, because Windows paths have spaces in them.
4. **Purity:** `cli.py`, `config.py`, and `collect_git.py` do I/O. Everything below them is
   pure and unit-testable without a real repo. Keep it that way — that is where the tests
   live and where correctness is guaranteed.
5. **Literal git branch names**, always rendered as `repo / branch-name`. Bearing never
   invents display names, whatever the mockups show.
6. **No LLM, no network, until Phase 4.** No HTTP client code of any kind before then.
7. **Windows-first.** Paths with spaces and backslashes must work end-to-end. Timestamps
   are parsed with explicit offsets and compared in UTC — never naive.

## Before adding anything

Check [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md). Several of these
were settled twice; the reason is recorded alongside each one so it can be re-evaluated
rather than just re-argued. Check the phase in
[`docs/ROADMAP.md`](docs/ROADMAP.md) too — each phase names what it explicitly does *not*
build. "Do not build, do not stub" means exactly that.

## When you finish a session

Update `docs/STATUS.md`: where things stand, the next concrete action, and a row in the
log. That file is what makes this repo pick-up-able — the same job Bearing does for
branches, done by hand.

If you locked a decision, add it to the decision log with its reason. If a document was
superseded, move it to `docs/archive/` and record what replaced it — do not delete it.
