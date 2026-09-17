# Status — where the project stands

**Updated:** 17 Sep 2026 · **Stage 1 built · Stage 2 built · interface rebuilt** · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## The interface is built

The placeholder is gone. `web/` is now **the Broadsheet** (D57): a masthead, a leader
column that opens with whatever is happening now, and a standing column on the right
holding the advisor and a register grouped by goal. The design language is the prototype's
variant C, extracted and documented at the top of `web/app.css` — five rules, and losing
any one of them turns it back into an ordinary dashboard.

The centre list reads the same branches **by goal** or **by branch**, chosen from the
dropdown. That is one grouping of one structure, not two views.

Six explorations led here and are kept in `docs/design/explorations/` as reasoning. The
recommendation there was D6; the owner chose D4 and the reasons are in D57.

## Where we are

| | |
|---|---|
| **Stage 1** | Built. Every branch across your repos, with its real commit history, PR and CI state. ETag change detection; a repo that has not moved costs nothing. |
| **Stage 2 engine** | Built. Per-branch plain-English title, summary, and progress judgement, cached so an idle branch is never re-summarised. |
| **Stage 2 surfaces** | Deliberately not built — the comment tool, the chat panel, and "what changed since I last looked" all wait for the real design. |
| Tests | 63, no network. Recorded GitHub fixtures and a stubbed provider. |

## Try it without the GUI

The interface is a placeholder, so there is a debug CLI (D44 — **not** a product surface):

```
npm run config     # what is configured, secrets redacted
npm run models     # the models your provider actually offers — pick one
npm run brief      # collect, summarise, and print every branch
npm run brief -- --no-llm    # deterministic only, no provider calls
```

Settings live in `data/settings.json` and can be hand-edited: `llmApiKey`, `llmBaseUrl`
(defaults to `https://opencode.ai/zen/v1`), `llmModel`, `llmMaxPerRun`.

**`llmModel` is empty on purpose.** Run `npm run models` and pick one — a guessed model ID
would fail at the worst moment.

## The next concrete action

**Run `npm run probe`.** It is two provider calls and a few hundred tokens, and it is the
last thing standing between the current single-turn advisor (D60) and the tool-calling
agent in `docs/plans/agent-plan.md`. Everything else in Stage 2 is now built.

After that, in order:

- **Milestones above goals.** `Goal.milestone` is a plain string today so the idea could
  be used before the structure exists. The register already groups by goal; grouping goals
  by milestone is the same move one level up.
- **The advisor filing goals itself.** The register exists to be *checked* (D57), which
  presumes something proposed the filing. That needs the agent, hence the probe.
- **What the Snapshot still lacks**: which CI job failed, reviewer state, per-commit file
  lists, linked issues. All additive — `collect.ts` widens, nothing restructures.
- **Stage 4**, Supabase sync, so goals and notes reach the second machine.

## Worth knowing

- **Summaries are cached on head SHA + prompt version + model.** Editing the prompt in
  `server/advise/prompt.ts` bumps `PROMPT_VERSION` and regenerates everything — otherwise
  you would get a silent mix of old and new.
- **Every cited commit is checked against the branch.** An invented SHA is dropped rather
  than rendered as a link.
- **A fatal provider error stops the run** rather than failing identically 99 more times.
- **`data/history/*.jsonl`** has been accumulating since the first run and nothing reads it
  yet. That is deliberate (D31).
- **`BEARING_DATA_DIR`** relocates everything the tool stores — `settings.json`, `goals.json`,
  `insights.json`, the cache and the history. Tests point it at a temp directory so they can
  never write into the real one.
- **Filing a branch under a goal costs no GitHub call.** Goals are merged into the snapshot
  already in memory and pushed to the page (D58).
- **The page re-reads after every write rather than waiting for the push.** The server does
  announce goal changes, but only while the event stream is up, and it reconnects on a
  three-second timer — leaning on it alone meant a click in that window silently did nothing.
- **Fonts are served from `web/fonts/`**, not Google Fonts (D56).

## Log

| Date | What happened |
|---|---|
| 13 Sep 2026 | Spec v0.1 → v0.3; build plan v0.2; Phase 0 plan; mockups explored |
| 15 Sep 2026 | Repo reorganized; 29 questions raised; **product redefined** — agents on GitHub, not a developer at a keyboard |
| 16 Sep 2026 | All questions closed (D20–D36); Stage 1 planned and **built** |
| 16 Sep 2026 | **The design files were the wrong ones.** Interface marked as placeholder pending the real ones |
| 16 Sep 2026 | **Stage 2 engine built** (D37–D44): provider client, prompt, parser with a hallucination guard, SHA-keyed cache, background enrichment, and a debug CLI |
| 16 Sep 2026 | Five provider gates debugged live (D45–D50); agent plan written (D51–D53) |
| 17 Sep 2026 | **The prototype was right all along** — the re-sent files are byte-identical to `docs/design/prototype/`. The wrong file was `dashboard-concept.html`, which `web/` was built from. D22 overturned |
| 17 Sep 2026 | **Six full interfaces built** in the variant C language (`docs/design/explorations/`). D6 "The Ledger" recommended. D54–D56 recorded |
| 17 Sep 2026 | **D4 "The Broadsheet" chosen and built** — `web/` rebuilt from scratch against it. Goals land as Plane B with their own store, API and tests; the advisor answers questions single-turn. D57–D60 recorded |
