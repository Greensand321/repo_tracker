# Status — where the project stands

**Updated:** 16 Sep 2026 · **Stage 1: built** · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## Where we are

**Stage 1 works.** Bearing reads every branch across your GitHub repos and shows its real
commit history in the mockup's layout.

Run it: double-click `start.bat` (or `./start.sh`, or Run → *Run Bearing* in VS Code).
First run asks for a read-only GitHub token and your repo list.

| | |
|---|---|
| Stack | Node 22 + TypeScript. Hono server, plain `fetch` for GitHub, esbuild + vanilla TS for the page. |
| Tests | 39, no network — recorded fixtures and a stubbed `fetch`. |
| Views | **Board** and **Timeline** render live data. **Needs you** runs on CI + PR state. **Your notes** is an honest empty state until Stage 3. |

### What the screen shows

The card headline is **the newest commit message** — real plain English, available today —
with the literal branch name above it. Expanding a card shows the full commit trail on the
left and the hard facts on the right, plus links out to the branch and PR on GitHub.
Nothing is checked out, ever.

### What it deliberately does not show yet

LLM titles, the recall/blocker/next prose and the step checklists from the mockup — those
are Stage 2. Notes, goals and milestones are Stage 3. No placeholder was invented for any
of them.

## The next concrete action

**Stage 2 — the LLM layer.** See [`ROADMAP.md`](ROADMAP.md).

1. Summarise a branch from its commits: what this thread is actually doing.
2. Judge state: progressing · stalled · blocked · done.
3. "What changed since I last looked."
4. Cache by head SHA so idle branches cost nothing.
5. A comment tool on every LLM output, for prompt-tuning.
6. The conversation surface (R12).

The `Branch` type already carries `title`, `summary` and `progress` as nulls, and the UI
renders correctly without them — so Stage 2 fills fields rather than reshaping anything.

**Confirm first:** Q37 — may the LLM write a short plain-English title beside the literal
branch name? Provisionally yes; the example is in
[`decisions/open-questions.md`](decisions/open-questions.md).

Provider is OpenCode Zen (D32); the key goes in settings like the GitHub one.

## Worth knowing

- **Cost control is the design.** A repo where nothing moved answers `304` and costs
  nothing against the rate limit. Only branches whose head SHA changed get fetched. CI is
  re-checked when it was still running, because a build finishing is a change no SHA
  reflects.
- **`data/history/*.jsonl` is being written from day one** and nothing reads it yet. That
  is deliberate (D31) — change over time cannot be backfilled.
- **`data/` is gitignored** and holds your token. Each machine gets its own.

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.3; build plan v0.2; Phase 0 plan; mockups explored |
| 15 Sep 2026 | Repo reorganized; `sync-branches.yml` → `.github/workflows/`; 29 questions raised |
| 15 Sep 2026 | **Owner answered. Product redefined.** `requirements.md` written; roadmap rebuilt as Stages 1–5; both old plans superseded |
| 16 Sep 2026 | All questions closed (D20–D36); Stage 1 planned |
| 16 Sep 2026 | **Stage 1 built.** Server, GitHub layer, snapshot transform, cache, history, and the Board / Timeline / Needs views. 39 tests passing. |
