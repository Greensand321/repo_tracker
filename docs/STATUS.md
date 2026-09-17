# Status — where the project stands

**Updated:** 16 Sep 2026 · **Stage 1 built · Stage 2 engine built** · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## ⚠️ The interface is being replaced

The mockup Stage 1 was built against (`docs/design/dashboard-concept.html`) turned out to
be a **throwaway superseded by a better design** the owner has at home. The current
`web/` is a working placeholder, not the target.

**What that costs:** `web/app.css`, `web/index.html`, `views/board.ts`, `views/timeline.ts`
— roughly 700 lines. **What it does not touch:** everything in `server/`, `shared/types.ts`,
and 58 of the 63 tests. The data/view separation (CLAUDE.md rule 4) is what makes this
cheap.

**Do not polish `web/`.** Keep it working so the engine can be verified, and swap it when
the real design arrives.

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

**Pick a design, then rebuild `web/` against it.**

Six full interfaces are drawn in `docs/design/explorations/` — open `index.html` there.
All six speak one design language, lifted from the prototype's variant C and extracted into
`base.css`; the recommendation is **D6, "The Ledger"** (D54, D55). Nothing is wired to the
engine yet: they render a fixed sample `Snapshot` from `data.js`.

Once one is chosen, the rebuild is mostly mechanical — the engine is done and the Snapshot
is the only thing the page reads. The parts that are not mechanical, and are worth deciding
first:

- **What the Snapshot still lacks.** Per-commit file lists, which CI job failed, reviewer
  state, linked issues. All additive — `collect.ts` widens, nothing restructures.
- **Plane B has no store.** The note box is drawn in D3 and D6 with nothing behind it.
- **Filed answers need an ageing rule** (D55) — they accumulate at the top forever.

After that, Stage 3: milestones → goals → branches → sub-tasks, plus notes.

## Worth knowing

- **Summaries are cached on head SHA + prompt version + model.** Editing the prompt in
  `server/advise/prompt.ts` bumps `PROMPT_VERSION` and regenerates everything — otherwise
  you would get a silent mix of old and new.
- **Every cited commit is checked against the branch.** An invented SHA is dropped rather
  than rendered as a link.
- **A fatal provider error stops the run** rather than failing identically 99 more times.
- **`data/history/*.jsonl`** has been accumulating since the first run and nothing reads it
  yet. That is deliberate (D31).
- **`BEARING_DATA_DIR`** relocates everything the tool stores.

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
