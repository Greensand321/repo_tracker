# repo_tracker — *Bearing*

> Designed to organize tasks in a workflow that is easy to pick up where it was left.
> No more losing track of which branch was in charge of which problem.

**Bearing** is the tool this repo builds: a local-first, read-only context-restoration
system for a solo developer juggling ~40 branches across ~4 repos. When you sit back
down it answers, in ten seconds: *where was I, what state is every branch in, what
deserves attention next.*

The core insight it is built around: **the expensive part of switching tasks is not the
work, it is rebuilding the mental model.** Every feature is judged by how much
time-to-first-productive-action it removes.

---

## Start here

| If you want to… | Read |
|---|---|
| Know what to do **right now** | [`docs/STATUS.md`](docs/STATUS.md) |
| See the phases and what's in each | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Build the first milestone | [`docs/plans/phase-0-plan.md`](docs/plans/phase-0-plan.md) |
| Understand the product | [`docs/spec/bearing-spec-v0.3.html`](docs/spec/bearing-spec-v0.3.html) *(open in a browser)* |
| See what it should look like | [`docs/design/`](docs/design/README.md) |
| Know why something was decided | [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md) |
| Find the full documentation map | [`docs/README.md`](docs/README.md) |

## Repository layout

```
repo_tracker/
├── bearing/          ← program files: the Python package (Phase 0 engine goes here)
├── tests/            ← test suite + deterministic git fixture builder
├── pyproject.toml    ← packaging; installs the `bearing` command
└── docs/             ← everything written so far
    ├── STATUS.md         where the project stands, and the next action
    ├── ROADMAP.md        Phase 0–4, what is in each, current status
    ├── spec/             canonical product spec (v0.3)
    ├── plans/            implementation plans
    ├── design/           the mockups we are building toward
    ├── decisions/        locked decisions + the reasons behind them
    └── archive/          superseded material, kept for its reasoning
```

**Root is for program files.** Source code lives at the root (`bearing/`, `tests/`,
`pyproject.toml`); every document lives under `docs/`.

## Current state

Nothing is implemented yet. The spec, the design direction, and a fully-specified
Phase 0 plan are done — the repo is staged so implementation can start cold.
See [`docs/STATUS.md`](docs/STATUS.md).

## Ground rules (from the spec — do not re-litigate)

1. **Read-only.** Bearing never writes to your repos. Not a branch, not a stash, nothing.
2. **Offline & deterministic first.** Phase 0–3 need no network and no LLM.
3. **The Brief JSON is the product.** Every surface — terminal, HTML, dashboard — is a
   renderer over it.
4. **Literal git branch names, always.** Bearing never invents display names.
5. **The advisor is built last**, on a complete data layer, never half-finished.
