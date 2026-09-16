# repo_tracker

> Designed to organize tasks in a workflow that is easy to pick up where it was left.
> No more losing track of which branch was in charge of which problem.

A **personal reference dashboard** over every branch in every repo. AI agents do the work —
one branch per session, pushed to GitHub, sessions running a week or more. This reads all
of it and shows, in plain English, what each thread is actually doing.

It is a place to get your bearings, not a place to work. It never touches your repos.

The point is not fewer branches — it is **holding more of them at once, with less mental
load.**

---

## Start here

| If you want to… | Read |
|---|---|
| **Understand what this is** | [`docs/requirements.md`](docs/requirements.md) |
| **Build the next thing** | [`docs/plans/stage-1-plan.md`](docs/plans/stage-1-plan.md) |
| Know what to do **right now** | [`docs/STATUS.md`](docs/STATUS.md) |
| **Answer what's blocking the build** | [`docs/decisions/open-questions.md`](docs/decisions/open-questions.md) |
| See the stages and what's in each | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Know why something was decided | [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md) |
| See what it should look like | [`docs/design/`](docs/design/README.md) |
| Find the full documentation map | [`docs/README.md`](docs/README.md) |

## Repository layout

```
repo_tracker/
├── .github/workflows ← repo infrastructure (branch-sync workflow)
└── docs/
    ├── requirements.md   what the tool actually is  ← start here
    ├── STATUS.md         where things stand, and the next action
    ├── ROADMAP.md        Stages 1–5, in priority order
    ├── decisions/        decisions + their reasons, and the open questions
    ├── design/           the mockups we are building toward
    ├── spec/             ⛔ old product spec — superseded
    ├── plans/            ⛔ old implementation plans — superseded
    └── archive/          superseded material, kept for its reasoning
```

**Root is for program files.** Source code lives at the root (`bearing/`, `tests/`,
`pyproject.toml`); every document lives under `docs/`.

## Current state

Planned, not yet built. **Stage 1 is ready to start** —
[`docs/plans/stage-1-plan.md`](docs/plans/stage-1-plan.md).

The product was redefined on 15 Sep 2026 once the real workflow was understood: branches
come from AI agents on GitHub, not from a developer at a keyboard. The older spec and plans
describe a different tool and are marked superseded.

**The stack:** a local program plus a browser UI, in TypeScript. You click `start.bat`, it
opens the dashboard in your browser. Nothing blocks the build.

## Ground rules

1. **Your repos are read-only. Forever.** No push, no merge, no branch, no stash. The tool's
   own data — goals, tags, notes, comments — lives in its own database, never in your repos.
2. **GitHub is the data source.** Agent branches are never checked out locally, so local git
   state is empty for them.
3. **Plain English is the headline.** Commit messages and summaries first; SHAs and
   timestamps small.
4. **One canonical data structure**; every view renders it and computes nothing itself.
5. **The literal branch name is always shown**, so you can always find the thing.
