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
| Know what to do **right now** | [`docs/STATUS.md`](docs/STATUS.md) |
| See how Stage 1 was built | [`docs/plans/stage-1-plan.md`](docs/plans/stage-1-plan.md) |
| See the stages and what's in each | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Know why something was decided | [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md) |
| See what it should look like | [`docs/design/`](docs/design/README.md) |
| Find the full documentation map | [`docs/README.md`](docs/README.md) |

## Run it

**Windows:** double-click `start.bat` (or pin a shortcut to it).
**Mac / Linux:** `./start.sh`. **From VS Code:** Run → *Run Bearing*.

First run installs dependencies, then opens <http://127.0.0.1:4321> in your browser and
asks for two things:

1. **A GitHub token.** Fine-grained, **read-only**, scoped to the repos you want.
   Under **Repository permissions** set four to Read-only:
   **Metadata** (required), **Contents**, **Pull requests**, **Actions**.
   Add **Commit statuses** too if your CI is not GitHub Actions. Nothing under *Account*.
   [Create one](https://github.com/settings/personal-access-tokens/new).

   > Not **Checks** — GitHub does not offer that permission to fine-grained tokens; it is
   > GitHub-App-only. Actions is what reads your CI.
2. **The repos**, one `owner/name` per line.

The token is stored in `data/settings.json` on that machine and is never sent anywhere
but GitHub. `data/` is gitignored; each machine gets its own token.

Requires Node 22+.

```
npm run dev        # the same thing, with restart-on-change
npm test           # 39 tests, no network
npm run typecheck
```

## Repository layout

```
repo_tracker/
├── start.bat / start.sh  ← what you click
├── server/               the local program: GitHub, cache, snapshot, HTTP
│   ├── github.ts           every GitHub call in the codebase
│   ├── snapshot.ts         raw payloads → the canonical Snapshot (pure)
│   ├── collect.ts          asks GitHub only for what moved
│   └── history.ts          dated record of branch state, for Stage 3
├── shared/types.ts       the Snapshot — the one structure every view renders
├── web/                  the browser UI, lifted from the mockup
├── test/                 39 tests against recorded fixtures, no network
├── data/                 gitignored: your token, the cache, the history
├── .github/workflows     repo infrastructure (branch-sync workflow)
└── docs/
    ├── requirements.md   what the tool actually is  ← start here
    ├── STATUS.md         where things stand, and the next action
    ├── ROADMAP.md        Stages 1–5, in priority order
    ├── plans/            stage-1-plan.md is live; the other two are superseded
    ├── decisions/        decisions + their reasons, and the open questions
    ├── design/           the mockups we are building toward
    ├── spec/             ⛔ old product spec — superseded
    └── archive/          superseded material, kept for its reasoning
```

**Root is for program files.** Source code lives at the root (`bearing/`, `tests/`,
`pyproject.toml`); every document lives under `docs/`.

## Current state

**Stage 1 is built.** Every branch across your repos, with its real commit history, in the
mockup's layout. Board, Needs you and Timeline views all render live GitHub data; notes
arrive in Stage 3 and the LLM in Stage 2.

The product was redefined on 15 Sep 2026 once the real workflow was understood: branches
come from AI agents on GitHub, not from a developer at a keyboard. The older spec and plans
describe a different tool and are marked superseded.

## Ground rules

1. **Your repos are read-only. Forever.** No push, no merge, no branch, no stash. The tool's
   own data — goals, tags, notes, comments — lives in its own database, never in your repos.
2. **GitHub is the data source.** Agent branches are never checked out locally, so local git
   state is empty for them.
3. **Plain English is the headline.** Commit messages and summaries first; SHAs and
   timestamps small.
4. **One canonical data structure**; every view renders it and computes nothing itself.
5. **The literal branch name is always shown**, so you can always find the thing.
