# Status — where the project stands

**Updated:** 17 Sep 2026 · **Stage 1 · Stage 2 · the interface · the assistant · the board** · **Branch:** `claude/kind-meitner-cpis9v`

> Keep this short and current. It is the first thing to read after any time away.

---

## The room is built (workroom steps 1–5)

The assistant's work is no longer three loops with three ideas of the budget. Every station
derives what it has outstanding onto **one board**, a dispatcher runs it N at a time, and a
worker's claim to have finished is **checked against the snapshot** before it counts (D68,
D69). Anything that fails twice **parks** — visible in *Waiting on you*, with a *try again* —
instead of repeating quietly forever.

**The floor** is the new panel under the advisor: who is working, on what, how long, what is
queued behind them, and what gave up. The count also sits in the dateline. `workers` in
settings decides how many run at once (default 2).

Writing the plan found a live cost bug: a vision the model correctly *declined* to draft was
never recorded, so the job was derived again every read and paid for again — every minute,
for every declined branch, forever (D70). The rule that caught it, before a line was built:
**a job whose predicate can never become true is a job that runs forever.**

**Stations can look things up.** Three of them do:

| | it can read | so that |
|---|---|---|
| **summarise** | which files a commit touched | the messages are written by the same agent whose work is in question; the files are the independent record |
| **draft a vision** | the README, the files, the branches beside it | purpose is the hardest thing to infer and the one nothing in git records — and everything downstream is measured against it |
| **assess** | the files, what moved this week, the siblings | *drifted* and *already done elsewhere* are claims that cannot be checked from one branch alone |

Nothing is collected in advance: a worker asks for the one commit it cares about and the
answer is cached on the SHA, where it is true for ever (D79). A README is one call per repo,
kept — and `CLAUDE.md` is read instead when there is no README. It is the JSON protocol, so it needs no tool support
from the provider: the model replies with `{"tool": …}`, we run it and ask again. A reply
with no `tool` key is the answer, handed to the station's own parser unchanged — no prompt
and no parser changed to gain tools.

Bounded three ways and it needs all three: the model stops asking, the lookups run out, or
the clock does. An unknown tool is a correction, a repeated one is answered from what we
already have, and a model that never answers **fails the job** rather than having its last
tool call parsed into a verdict.

**You can ask for things.** *Read it again* on any branch, *check it again* where there is
a verdict, *have a go* where nothing has said what a branch is for, *write it again* on the
brief. It queues; it does not do — the page comes back at once and the floor shows the rest,
then tells you when it lands.

Two things make that more than a button. The routine board derives from what is *missing*,
so it can never produce "read this again" — a dispatched job is decided by **freshness**
instead: done when the answer on disk is newer than the question (D81). And it runs in its
own lane with its own workers and its own purse (D82), because a read that has just spent
its budget on summaries must still be able to do the one thing you actually asked for.

What you ask for is the only work written to disk (D72): nothing in the fleet implies it, so
if the program closes mid-job it lives in `data/dispatched.json` or nowhere. It comes back
on the next start, twice, and then parks where you can see it.

> **The first read after tools regenerates every summary and every assessment.** A station's
> tool list is part of its cache key (D74), and they were written without tools. It is one
> pass at `llmMaxPerRun` a read, and then the fleet is quiet again.

Plan and what is next: [`plans/workroom.md`](plans/workroom.md) — step 6, the desk: the
advisor may dispatch on your behalf, so "regroup the register" and "rank these by my
criteria" become things you can say. D68–D83.

## The assistant is built (stage A)

Every branch can carry a **vision** — one falsifiable sentence saying what it is *for*. The
assistant drafts one where it can be specific, marks it as a proposal until you confirm, and
then compares it against what the branch actually did: *on track*, *drifted*, *done — vision
met*, *overtaken by another branch*, or *unclear*. That comparison is the two-line **For /
Now** block on every branch.

Above it sits **the brief** — three to five sentences on what looks done, what still needs
doing and what is going on. Under the register, **Waiting on you** carries the questions,
capped and answerable in place. Drift always offers both its causes (D62), and a goal is
never silently marked done (D64).

**Where it came from:** [`design/agent-shapes.html`](design/agent-shapes.html) — five shapes
the assistant could take, which turn out to be layers rather than alternatives, plus the
answer to "how does the program know when an agent is done". Shapes ② and ③ are being built
(the owner chose them and skipped ④); ⑤ is step 6.

**How it works, end to end:** [`design/ai-map.html`](design/ai-map.html) — every path from
the clock firing to what gets written, all six prompts with what each one sees, decides and
may not do, and where to change each. Open it from disk.

Plan: [`plans/vision-ux.md`](plans/vision-ux.md) (the walkthrough) and
[`plans/agent-memory-plan.md`](plans/agent-memory-plan.md) (stage A of the build order).
Decisions D61–D65.

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
| Tests | 233, no network. Recorded GitHub fixtures and a stubbed provider. |

## Try it without the GUI

There is a debug CLI (D44 — **not** a product surface; the GUI is the product):

```
npm run config     # what is configured, secrets redacted
npm run models     # the models your provider actually offers — pick one
npm run brief      # collect, summarise, and print every branch
npm run brief -- --no-llm    # deterministic only, no provider calls
```

Settings live in `data/settings.json` and can be hand-edited: `llmApiKey`, `llmBaseUrl`
(defaults to `https://opencode.ai/zen/v1`), `llmModel`, `llmMaxPerRun`, `workers`.

**`llmModel` is empty on purpose.** Run `npm run models` and pick one — a guessed model ID
would fail at the worst moment.

## The next concrete action

**Workroom step 3 — the tool layer.** The contract, the JSON-protocol loop, the free tools
(`sibling_branches`, `what_changed` — which finally reads the dated history nothing has ever
read), and a per-job tool budget. Tools are safe to let loose now that a job's result is
checked rather than believed.

**Run `npm run probe` alongside it.** Two provider calls. It decides native tool calling
versus the JSON protocol — *which*, not *whether*, since the protocol floor works on any
model that can return JSON, which yours demonstrably can.

After that, in order:

- **Step 5, dispatch**, then **step 6, the desk** — see `plans/workroom.md`.
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
- **`complete()` sets `x-opencode-session` itself** (D66). Never add a provider call that
  bypasses it — a test enforces this.
- **Job ids are derived, not minted** — `kind:repo:branch:headSha`. That is what makes a read
  landing mid-flight find a job already claimed, and what retries a parked job at exactly the
  right moment: when the branch moves, and never before.
- **The board lives in `server/work/`.** `board.ts` derives it (pure-ish, the stations are
  rows), `run.ts` spends the budget. Nothing under `server/advise/` may read `llmMaxPerRun` —
  a test enforces that too.
- **Adding a station is adding a row in `board.ts`**, with its `run`, its `doneWhen`, its
  `stage` and its `reserve`.
- **`llmMaxPerRun` counts provider calls, not jobs** (D75). A job is claimed only when the
  read can pay for it in full — a lookup costs the same as an answer.
- **A tool is handed `SafeSettings` and a two-method GitHub reader, never the token** (D77,
  D79). Nothing under `server/tools/` may name a credential or call `fetch`, and a test
  enforces both.
- **`data/evidence.json`** holds what the tools fetched: READMEs per repo, file lists per
  commit SHA. Both permanently true, so it is one call ever. Plane B, gitignored.
- **A tool error the worker can fix goes back to it; anything else fails the job** (D80).
- **`data/dispatched.json`** holds what you asked for, and only that. Routine work is
  derived, so it needs no recovery; asked-for work is implied by nothing (D72).
- **A lane decides what is claimed, never what is shown** (D82). Both lanes publish the
  whole board, and a claim is re-checked at the moment of claiming — the two run side by
  side and would otherwise both pay for the same job.
- **Two workers wanting the same README make one call.** They miss the cache in the same
  millisecond otherwise — measured, and it doubled every GitHub call.
- **Announcements to the page are coalesced at 300ms.** The page re-reads the whole snapshot
  on every one, and the board announces on every job claimed, every lookup and every job
  done — several hundred full reads a run, for a panel whose unit of meaning is "something
  moved".
- **A parked job never blocks the brief** (D78). Ordering is `stage`, and work that gave up
  is filtered out before the next stage is chosen.
- **Advisor failures show in the dateline as well as Notices** (D67).
- **One budget per read, not one per step.** `llmMaxPerRun` is spent across summarising,
  drafting and assessing together. It used to cap the first two and not the third.
- **The assistant costs almost nothing on an unchanged fleet.** An assessment is cached on
  head SHA + vision text; the brief and every goal judgement share one cache key hashed over
  every branch, vision and verdict. Nothing moves, nothing is spent.
- **Declining to draft a vision is a success.** `npm run brief` will show branches with none;
  that means the model could not be specific, which is the correct answer.
- **`data/visions.json`** holds visions and assessments, **`data/assist.json`** the brief and
  its judgements. Both Plane B, both gitignored.

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
| 17 Sep 2026 | **The brief was 400ing on every read** — three call sites never sent the mandatory OpenCode session header, and nothing surfaced it on screen. D66, D67 |
| 17 Sep 2026 | **The assistant, stage A**: vision per branch, vision-vs-reality assessment, goal judgement, the brief, and the questions panel. D61–D65 |
| 18 Sep 2026 | **The workroom, step 5**: you can ask for a second opinion, in its own lane, surviving a restart. Work asked for is decided by freshness rather than by what is missing. D81–D83 |
| 18 Sep 2026 | **The workroom, step 4**: `repo_readme` and `commit_files` — fetched on demand, cached for ever, and wired into summarise, draft-vision and assess. A tool gets a reader, never the token. D79, D80 |
| 17 Sep 2026 | **The workroom, step 3 and an audit**: stations can look things up (the JSON protocol, two free tools, `assess` wired). The audit found four: a bad key parked the whole fleet, the call budget could be overshot ninefold, a parked job blocked the brief for ever, and a model that never answered had its tool call stored as a verdict. D75–D78 |
| 17 Sep 2026 | **The workroom, steps 1–2**: work derived onto a board, done checked rather than claimed, failures park, and the floor shows the room working. A declined vision was being re-paid every read. D68–D74 |
| 17 Sep 2026 | **D4 "The Broadsheet" chosen and built** — `web/` rebuilt from scratch against it. Goals land as Plane B with their own store, API and tests; the advisor answers questions single-turn. D57–D60 recorded |
