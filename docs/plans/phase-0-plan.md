# Bearing — Phase 0 (Milestone 0) Technical Plan

**Status:** ready for implementation handoff · **Date:** 13 Sep 2026 · **Plan version:** 1.0
**Companion documents:** `bearing-spec.html` (product spec v0.3, same folder), prototype GUI (`bearing-prototype.html` + `bearing.css` + `bearing.js`, same folder).

> **Repo note (added 15 Sep 2026, during the repo reorganization).** Two things below are
> out of date, and are corrected in [`README.md`](README.md) rather than edited into this
> plan: §3 says to create a fresh repository — that is now *this* repo (`repo_tracker`),
> with the §3 module layout rooted at `bearing/` — and the companion files are no longer in
> one flat folder (spec → `../spec/bearing-spec-v0.3.html`, prototype → `../design/prototype/`).
> Everything else stands as written.

This document is written for an implementing agent with no prior context. It is intentionally explicit: exact commands, exact schemas, exact thresholds. Where a choice is already made, it states the choice; where the implementer must decide, it says so and bounds the decision.

---

## 0. Context — what Bearing is, in 4 sentences

A local-first tool for one solo developer juggling many branches (~40) across ~4 git repos on Windows. The expensive part of context switching is not the work, it is rebuilding the mental model — so Bearing's entire job is to answer, in seconds: *where was I, what state is every branch in, what deserves attention next.* Phase 0 builds the **engine**: read git, compute per-branch state, produce a prioritized **Brief**. The Brief JSON is the product; every future surface (interactive dashboard, advisor) is a renderer over it.

**Critical owner constraint:** the owner does not work in the terminal. The terminal brief is plumbing for tests and logs; the owner-facing artifact from day one is the **HTML snapshot** (`bearing brief --html`). Every deliverable must be verifiable without reading terminal output.

## 1. Scope

**In scope (this plan only):**

| # | Deliverable |
|---|---|
| 1 | Repo discovery from config; branch enumeration per repo |
| 2 | BranchState computation: ahead/behind, last activity, diffstat, merged-ness, conflict-risk, working tree, stashes |
| 3 | Flag derivation + prioritization (deterministic, no network) |
| 4 | Renderers: Markdown brief, JSON brief, self-contained HTML "Bridge snapshot" |
| 5 | CLI: `bearing brief [--repo PATH] [--json] [--html] [--out FILE]` |
| 6 | Test suite incl. deterministic fixture-repo generator |

**Out of scope (later milestones — do not build, do not stub):**

- Session reconstruction from reflog grouping (Milestone 1)
- `bearing park` notes and their storage (Milestone 1)
- GitHub/`gh` enrichment: PRs, CI, merge-ready (Milestone 2)
- Interactive dashboard, three views, server (Phase 2)
- LLM anything (Phase 4, decided: never before advisor)
- `scan`, `config`, `sessions`, `open`, `prune`, `add` commands
- Any write operation against repos. **Bearing is strictly read-only.**

## 2. Non-negotiable constraints

1. **Python 3.11+**, stdlib only. `tomllib` for config, `argparse` for CLI, `subprocess` for git, `unittest` or `pytest` (dev-only) for tests. No GitPython, no pygit2, no requests, no framework.
2. **All git access via `git` subprocess** with `--porcelain`/machine formats. Never parse `git status` human output. Never use `-C` with user-controlled input beyond validated config paths.
3. **Offline, read-only, no LLM, no network.** No HTTP client code of any kind.
4. **Windows-first** (dev machine is win32, PowerShell 5.1): paths must tolerate backslashes and spaces (always quote subprocess args, never build shell strings); forward slashes in config must be accepted. Must also work on POSIX.
5. **Performance:** full brief across 4 repos / ~40 branches in **< 5 s** warm, < 15 s cold. Budget: ≤ 3 git subprocess calls per branch, ≤ 6 per repo. (Compute this; if a design needs more, stop and reconsider.)
6. **Timezone correctness:** all timestamps parsed with explicit offsets and compared in UTC. Reflog and commit dates from different repos must be comparable.
7. No comments are required in code, but module docstrings (1–3 lines) stating each module's single responsibility are required.

## 3. Project setup

- Create a **new git repository** at `C:\Users\alexa\Documents\github\bearing\` (the current spec/prototype folder is a scratch workspace — do not build there).
- Layout:

```
bearing/
  pyproject.toml            # [project.scripts] bearing = "bearing.cli:main"
  README.md                 # 10 lines: what it is, how to run
  bearing/
    __init__.py             # version constant
    __main__.py             # delegates to cli.main()
    cli.py                  # argparse, exit codes (I/O only, thin)
    config.py               # load/validate bearing.toml (I/O, small)
    collect_git.py          # ALL subprocess calls live here (I/O boundary)
    analyze_branch.py       # BranchState + flags (pure)
    prioritize.py           # ordering + brief sections (pure)
    nextstep.py             # flag → "next step" text rules (pure)
    render_markdown.py      # pure
    render_json.py          # pure
    render_html.py          # pure; single self-contained HTML file
    model.py                # dataclasses: BranchState, RepoState, Brief
  tests/
    fixture_builder.py      # scripted deterministic git repos
    test_analyze_branch.py
    test_prioritize.py
    test_nextstep.py
    test_render_markdown.py # golden-file tests
    test_integration.py     # fixture repo → full brief
    test_perf.py            # smoke, marked slow
```

- Purity rule (from spec §8): everything below `cli.py`/`config.py`/`collect_git.py` is pure and unit-testable without touching a real repo. `collect_git.py` returns plain dicts/dataclasses; analyzers consume those and produce the Brief; renderers consume the Brief. Tests target the pure layers primarily.

## 4. Configuration

File: `~/.bearing/bearing.toml` (`%USERPROFILE%\.bearing\bearing.toml`). Schema:

```toml
[repos]
paths = [ "C:/dev/api-service", "C:/dev/web-app" ]

[defaults]
base = "main"          # optional; per-repo override below

[repos.overrides]     # optional section
"C:/dev/web-app" = { base = "develop" }
```

- Missing file or empty `paths` → print a short message with the exact TOML to paste, exit code 2. This is the **first-run UX**; there is no `add` command in Phase 0.
- A path that doesn't exist or isn't a git repo (no `.git` dir, or `git rev-parse --git-dir` fails) → warn on stderr, skip that repo, continue. Exit code stays 0 unless *all* repos fail (then 3).
- Default `base` resolution per repo, in order: explicit override → `[defaults] base` → `main` if it exists → `master` if it exists → `git symbolic-ref --short refs/remotes/origin/HEAD` basename → else `None` (branch is its own base; ahead/behind = 0/0, skip merged checks).
- Exclude branches matching: `dependabot/*`, `renovate/*` (hardcoded default list; a `[repos] exclude = ["pattern"]` list may be added, glob-style matching, case-insensitive). The configured `base` branch itself is never listed as a working branch.

## 5. Data collection — exact git commands

All commands run with `git -C <repo-path> ... --no-optional-locks` (read-only politeness). Capture `stdout` only; treat non-zero exit as data-absent, never crash.

| Purpose | Command | Notes |
|---|---|---|
| Enumerate branches | `git for-each-ref refs/heads --format=%(refname:short)%09%(objectname)%09%(committerdate:iso8601-strict)` | one call per repo; tab-separated |
| Resolve base | (rules in §4; existence via `git rev-parse --verify refs/heads/<base>` exit code) | no text parsing needed |
| Ahead/behind | `git rev-list --left-right --count <base>...<branch>` | output `behind<TAB>ahead` |
| Merge-base | `git merge-base <base> <branch>` | reuse for diffstat + conflict-risk |
| Diffstat totals | `git diff --shortstat <merge-base> <branch>` | parse `N files changed, X insertions(+), Y deletions(-)` |
| Files changed on branch | `git diff --name-only <merge-base> <branch>` | for conflict-risk intersect |
| Files changed on base | `git diff --name-only <merge-base> <base>` | for conflict-risk intersect |
| Merged into base | `git rev-list --count <base>..<branch>` == 0 | "no unique commits" |
| Branch reflog (last touch) | `git reflog show <branch> --format=%gd%x09%cs%x09%gs -n 5 --date=iso8601-strict` | commits/rebases on the branch |
| HEAD reflog (checkouts) | `git reflog HEAD -n 200 --format=%cs%x09%gs` | filter lines `checkout: moving from A to B` |
| Current branch | `git symbolic-ref --short HEAD` | detached HEAD → no branch; repo-level note |
| Working tree | `git status --porcelain=v1` | count `M/A/D/R` staged vs unstaged by column, `??` untracked |
| Stashes | `git stash list` | count only |

**Activity model (important subtlety):** a checkout is recorded in **HEAD's reflog**, not the branch's reflog. Therefore:

```
lastActivity(branch) = max(
  committerdate of branch tip,
  timestamps of that branch's own reflog entries,
  timestamps of HEAD-reflog entries ending in "moving from <any> to <branch>"
)
lastAction = the type of the newest of those events: commit | checkout | rebase | reset | stash | merge
```

HEAD reflog is capped at the last 200 entries per repo (perf guard); if a branch's last checkout predates that window, fall back to commit/reflog dates — acceptable.

**Timestamps:** parse ISO-8601-with-offset (`iso8601-strict` gives `2026-09-13T11:42:07+02:00`); convert to aware UTC datetimes immediately; store ISO-8601 UTC in output. Never compare naive datetimes.

**Working tree and stashes are repo-level:** attach `workingTree` and `stashes` only to the currently checked-out branch's BranchState; all other branches get `null`/0. This is a spec decision (§7) — do not list them per branch.

## 6. Data model (mirrors spec §7, Phase 0 subset)

```json
{
  "repo": "api-service",
  "name": "feat/webhooks",
  "base": "main",
  "headSha": "a1b2c3d",
  "lastActivity": "2026-09-13T09:42:00Z",
  "lastAction": "commit",
  "ahead": 6, "behind": 0,
  "diffstat": { "additions": 214, "deletions": 38, "files": 7 },
  "mergedIntoBase": false,
  "workingTree": null,
  "stashes": 0,
  "flags": ["active", "dirty"],
  "nextStep": "3 uncommitted files — commit or stash before switching threads"
}
```

RepoState: `{ repo, base, currentBranch, branchCount, warnings[] }`.
Brief: `{ generatedAt, repos[], branches[], sections { pickup[], active[], decisions[] } }` — sections hold branch references in display order (see §7).

## 7. Analysis — flags, thresholds, prioritization

**Flags (Phase 0 set; exact thresholds):**

| Flag | Rule |
|---|---|
| `active` | `lastActivity` ≤ 7 days ago (constant `STALENESS_DAYS = 7`) |
| `stale` | not `active` AND not `mergedIntoBase` |
| `diverged` | `behind > 20` |
| `conflict-risk` | non-empty intersect of files-changed-on-branch ∩ files-changed-on-base AND `behind > 0` |
| `dirty` | working tree has any staged/unstaged/untracked files (checked-out branch only) |
| `safe-to-delete` | `mergedIntoBase` OR (`ahead == 0` AND `behind >= 0` AND not base itself) |
| `almost-done` | not in Phase 0 (needs PR data — arrives Milestone 2; do not compute) |

**Prioritization & brief sections:**

1. `pickup` — exactly one entry: the branch with the newest `lastActivity` among non-merged, non-safe-to-delete branches, **preferring a `dirty` working tree when the newest two activities are within 15 minutes of each other** (you were "in" that repo). Show last 3 git actions for it (from reflog lines, truncated to 60 chars each).
2. `active` — remaining `active` branches, ordered by `lastActivity` desc, cap 12 total across `pickup`+`active`.
3. `decisions` — branches with any of: `stale`, `diverged`, `conflict-risk`, `safe-to-delete`, ordered by (staleness age desc). Cap 10.
4. Parking notes section: **omitted in Phase 0** (`park` arrives Milestone 1).

**`nextStep` text — deterministic rules, evaluated top-down, first match wins:**

| Condition | Text |
|---|---|
| `dirty` and is pickup branch | `N uncommitted files — commit or stash before switching threads` |
| `diverged` and `conflict-risk` | `behind base by N, overlapping files — rebase will conflict` |
| `conflict-risk` | `base moved in your files — rebase soon, expect conflicts` |
| `diverged` | `behind base by N commits — rebase when convenient` |
| `safe-to-delete` and `mergedIntoBase` | `merged — delete at your leisure` |
| `safe-to-delete` | `no unique commits — safe to delete` |
| `stale` | `untouched for N days — keep, rebase, or close?` |
| none | `in flight — ahead N of base` (or `at base` if ahead 0) |

## 8. Renderers

### 8.1 Markdown (`render_markdown.py`)
Section headers as `──` delimited lines matching spec §14.1 style; per branch: `repo/branch · <humanized age> · <lastAction>`, flags as `[!]`/`[~]`/`[?]` markers, one next-step line. Humanized ages: "just now", "N minutes ago", "N hours ago", "yesterday", "N days ago", "N weeks ago". Golden-file tested.

### 8.2 JSON (`render_json.py`)
Exact serialization of the Brief structure in §6. Stable key order. This is the contract for all future surfaces — treat it as public API; document in README.

### 8.3 HTML Bridge snapshot (`render_html.py`) — the owner's day-one GUI
- Emits **one self-contained file** (inline CSS, no external requests, no JS build, works opened directly from disk via double-click).
- Layout = **The Bridge** variant of the prototype: header ( Bearing · generated timestamp ), **resume hero card** (the pickup branch: name `repo / branch`, last 3 actions as a mini-trail, uncommitted files as chips, next-step line), **attention flag row** (decision branches as small cards with severity colors: red=conflict/diverged, amber=stale, green=safe-to-delete, brass=dirty), then **per-project lanes** of branch cards (literal name `repo/branch`, note area absent in Phase 0, `↑ahead ↓behind`, last touch, flags).
- **Visual reference:** lift the palette, typography (Fraunces/Inter/JetBrains Mono via Google Fonts link), and card structure from `bearing.css` sections `vA` (`.hero`, `.flag`, `.bcard`, `.proj`) in the prototype folder. Keep the brass-on-dark-navy look. **Adaptations mandated by spec v0.3 §14.2:** branch display is always `repo / branch-name` (never invented names); there is no advisor panel (that space is a static "next actions" list); a single optional `<details>`-based expand per card is allowed for diffstat — no JS required.
- Default output: `~/.bearing/brief.html`, and **also open it in the default browser when invoked as `bearing brief --html --open`** (`os.startfile` on Windows, `webbrowser` elsewhere). `--html` without `--open` just writes the file and prints its path.

## 9. CLI contract

```
bearing brief [--repo PATH] [--json] [--html] [--out FILE] [--open] [--no-render]
```

- Default (no flags): markdown to stdout (plumbing/logs).
- `--repo PATH`: restrict to one repo (repeatable). Path must match a configured repo (by resolved absolute path), else exit 4.
- `--json`: Brief JSON to stdout. `--html`: write snapshot file. `--out FILE`: override output path. `--open`: open result in browser (implies `--html`).
- Exit codes: 0 ok · 2 no repos configured · 3 all repos failed · 4 bad repo argument · 5 unexpected git error.
- All diagnostics → stderr, one line each, actionable ("skipped C:/dev/web-app: not a git repository").

## 10. Testing strategy

- **`fixture_builder.py`** builds deterministic scratch repos under a temp dir: seeds `.gitconfig`-local identity, then creates branches/commits with **pinned dates** via `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` env vars; creates checkouts (HEAD reflog), a dirty tree, a stash, a merged branch, a diverged branch (21 commits behind), overlapping-file branches (conflict-risk), and a `dependabot/x` branch to prove exclusion. Builder is pure-ish I/O helper; all other tests build on it.
- Unit tests: flag thresholds at exact boundaries (6.99 vs 7.01 days), activity model (checkout recorded via HEAD reflog only), conflict-risk intersect, prioritization tie-breaking, nextStep rule order, timezone mixing (one fixture commit with +02:00 offset, one with −07:00).
- Golden tests: markdown and JSON output for a full fixture scenario committed as files; regenerating requires explicit flag.
- Integration: run CLI as subprocess against fixture; parse JSON; assert section assignment.
- Perf smoke (marked slow, skipped in CI-less runs by default): generate 4 repos × 12 branches with 30 commits each; assert < 5 s.
- **Human acceptance (owner):** run against the owner's real repos (config provided at review time), open `bearing brief --html --open`, and the resume card must name the branch the owner actually last touched. That is the demo that defines done.

## 11. Acceptance criteria — definition of done

- [ ] `pip install -e .` then `bearing brief --json` on fixture repos produces valid Brief JSON per §6 schema
- [ ] All flag rules in §7 pass unit tests at boundary values
- [ ] Activity model proven by test: a branch with an old tip commit but a recent *checkout* is ranked by the checkout time
- [ ] Markdown + JSON golden files pass; HTML snapshot renders correctly when opened from disk (no console errors, no external deps beyond fonts)
- [ ] Performance smoke passes (< 5 s, 4 repos)
- [ ] Read-only proven: a test runs the full pipeline and asserts `git status --porcelain` unchanged and no new refs/stashes in fixture repos
- [ ] Windows: paths with spaces work end-to-end (fixture repo in a directory with a space in its name)
- [ ] Exit codes and first-run message per §9/§4
- [ ] Real-repo acceptance demo (§10) passes

## 12. Known edge cases to handle (each needs a test)

Detached HEAD (repo-level warning, no pickup preference) · branch with 0 commits ahead of base and base not detectable · repo with a single branch (it is the base) · empty repo (no commits — warn, skip) · unicode branch names (use `refname:short`, no shell strings — safe by construction) · reflog empty (fresh clone — HEAD reflog exists, branch reflog may not) · branch names containing `/` (normal, no special handling) · config path given with backslashes or forward slashes (resolve via `pathlib`, compare resolved absolute) · `behind` huge (>1000: render as ">1000" in markdown, exact in JSON).

## 13. Handoff notes for the implementing agent

1. Read `bearing-spec.html` §4, §7, §18 for the product intent behind these rules; do not re-litigate decided points (LLM deferred, literal names, read-only, advisor last).
2. The prototype files in the spec folder are the visual source of truth for §8.3 — but they are exploratory: their invented branch display names and advisor panels are explicitly **not** part of the product. Only layout/palette/typography carry over.
3. If any instruction here conflicts with the spec, the spec wins; if both are ambiguous, choose the option that deletes code rather than adds it, and record the decision in the PR description.
4. Estimate: a focused implementation is ~600–900 lines of Python excluding tests. If it is growing past ~1,500, something in this plan is being over-built — stop and re-read §2.
