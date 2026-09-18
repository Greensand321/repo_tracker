# Decision log

Every decision with the reason behind it. **Check here before reopening an argument.**
Overturned decisions are not deleted — they move to §3 with what replaced them, so the
reasoning trail survives.

**Precedence:** [`../requirements.md`](../requirements.md) > [`../ROADMAP.md`](../ROADMAP.md)
> `spec/bearing-spec-v0.3.html` > `plans/` > `archive/`.

Restructured 15 Sep 2026, when the owner's answers changed the product. Questions still
open: [`open-questions.md`](open-questions.md).

---

## 1. Current decisions — from the owner, 15 Sep 2026

| # | Decision | Why |
|---|---|---|
| D1 | **Two data planes.** Plane A (your repos) is strictly read-only forever — no push, merge, branch, stash, or config change. Plane B (milestones, goals, tags, notes, comments, settings) is the tool's own database, written freely. | Resolves the apparent conflict between "read-only" and wanting to store notes. Keeps the invariant that matters: the tool can never damage your work. |
| D2 | **GitHub is the primary data source.** Not local git. | Branches are created by agent sessions and pushed to origin; they are never checked out locally, so local reflog, working tree and stashes are all empty for them. |
| D3 | **GUI only.** No terminal, no markdown output, no CLI as a product surface. | The owner does not use a terminal except to debug. A CLI entry point may exist as plumbing, but nothing about the design is shaped by it. |
| D4 | **Plain English is the headline.** Commit messages, PR titles, and LLM summaries are the content; SHAs, ahead/behind and timestamps are supporting metadata. | *"The raw git bullcrap is not what I need — I care what was committed, in plain English."* |
| D5 | **Milestone → Goal → Task → Branch.** Milestones are release-level; goals hold many tasks; one task per branch. | The owner's structure. Owner authors milestones and goals; the LLM does the filing and progress upkeep. |
| D6 | **Tags are separate from the hierarchy** — free-form, many-to-many, cross-cutting. | Lets a branch belong to a theme without complicating the goal tree. |
| D7 | **More branches is the goal, not fewer.** | *"The goal isn't less branches, it's more — the whole point is to reduce mental load so I can keep up with more things at once."* This voids the old branch-reduction success metric and deprioritizes all hygiene features. |
| D8 | **`main` is the base branch, everywhere, always.** No `develop`, no per-repo overrides. | Stated directly. Removes the entire base-resolution fallback chain. |
| D9 | **Dependencies are allowed.** | *"If installing a dependency makes things easier then great, do that."* Overturns the old stdlib-only rule. |
| D10 | **Network-first.** GitHub for data, a cloud backend for sync. The local cache gives a degraded offline view; offline is not the default mode. | Follows from D2 and the two-machine requirement. |
| D11 | **Nothing hardcoded.** Thresholds and display caps are exposed in settings. | Stated directly. |
| D12 | **Personal tool, one owner, two machines.** | No multi-user, no sharing, no onboarding flow to build. |
| D13 | **GitHub is already the sync layer** for commits, branches, PRs and CI. Only Plane B needs a sync backend. | Both machines read the same origin, so that data matches by construction. Shrinks the sync problem to a few kilobytes of text. |
| D14 | **`sync-branches.yml` stays as it is** and is not part of the product. | It is a bulk merge-to-main time-saver for when several branches finish together. The tool may report drift; it never merges. |

| D20 | **Stack: a local program + a browser UI, in TypeScript.** Node 22+, Hono for the server, Octokit for GitHub, Vite + vanilla TS for the front end. You click `start.bat`; it opens the browser. | Only a program behind the page can hold a GitHub token safely, write a local backup, and call the API without `file://` restrictions. TypeScript gives one language across front and back. Bundles to a single `.exe` later without a rewrite. |
| D21 | **The LLM arrives at Stage 2**, immediately after the git history lands — not last. | The owner's stated priority order put LLM insight second, and the goal/milestone upkeep depends on it. Overturns the old "advisor built last" decision (§3). |
| D22 | **Build from `design/dashboard-concept.html`.** | It already carries the Timeline and Notes surfaces the requirements call for. Variant A ("The Bridge") is built around a "you were just here" moment that does not apply when agents did the work. |
| D23 | **Vanilla TS on the front end, not a framework.** | The mockup is vanilla HTML/CSS/JS, so it transplants directly rather than being reimplemented — and Stage 1 is exactly "make the mockup show real data." Revisit at Stage 3 if the UI gets painful; contained, because everything renders one data structure. |
| D24 | **Only commits *ahead of* `main` are shown**, via the GitHub `compare` endpoint. | A branch's full history is mostly `main`'s and says nothing about the thread. One call returns the branch's own commits, ahead/behind, and diff size together. |

| D25 | **The product is called Bearing.** | Confirmed by the owner. The repo stays `repo_tracker`; the app is Bearing. |
| D26 | **Clicking a branch expands its detail and offers links out to GitHub** — the branch and its PR. It never checks anything out. | Follows from D1. The work happens on GitHub, so jumping to the PR is the action actually wanted. |
| D27 | **GitHub auth: a fine-grained, read-only token pasted into settings.** Stored in `data/`, gitignored, never synced to the cloud. Each machine gets its own. | Simplest thing that works, scopes controlled by the owner, no OAuth flow to build. |
| D28 | **Supabase for Plane B.** | The data is relational (milestone → goal → branch → sub-task); it is plain Postgres you can inspect and repair yourself; the free tier covers kilobytes of text comfortably. |
| D29 | **Hierarchy: Milestone → Goal → Branch → Sub-task.** Exactly one goal per branch. Sub-tasks live under a branch and **may diverge from its goal**. | The owner's structure. One goal per branch keeps every view unambiguous; sub-tasks absorb the reality that a long session wanders. |
| D30 | **The task is whatever the branch is doing *now*.** The LLM re-titles it as the branch evolves. | Sessions run a week or more and change shape. A task fixed at creation would drift out of date and need manual upkeep — exactly what the owner does not want. |
| D31 | **Store dated snapshots of branch state from Stage 1 onward**, even though nothing reads them yet. | The owner wants to measure what changed and by how much. Change over time cannot be reconstructed retroactively — if the history is not being written now, that feature is impossible later. Cheap now, impossible to backfill. |
| D32 | **LLM provider: OpenCode Zen**, one API key pasted into settings (OpenAI-compatible). | The owner's choice. Revisit if volume stays low enough to justify a cheaper pay-as-you-go option, which would need more spend safeguards. |
| D33 | **Talking to the LLM is a requirement, not an optional surface.** The GUI has a text input from Stage 2 onward. | Stated directly. It also means notes (R6) become nearly free once an input surface exists, so "view-only for now" is a smaller saving than it looks. |
| D34 | **Refresh on open, then keep updating in the background** using conditional requests. | The owner wants it live. ETags make unchanged responses cost nothing against the rate limit, so continuous polling is affordable — see `plans/stage-1-plan.md` §5. |
| D35 | **~100 branches, of which a few dozen stay relevant.** Stale branches fold away in the UI; they are never hidden from the data and never deleted. | The owner's actual scale. Staleness is a display concern, not a hygiene feature (D7). |
| D36 | **t3 code needs no special handling.** Both agents push ordinary branches with ordinary commits. | Confirmed by the owner. |

| D37 | **Talk to the provider over its OpenAI-compatible HTTP API, not a vendor SDK.** | The endpoint is deliberately swappable — the same code reaches any OpenAI-compatible provider by changing one setting. A vendor SDK would weld the choice in. |
| D38 | **Do not send `response_format: json_object`.** Ask for JSON in the prompt and parse tolerantly (fences and chatter allowed). | OpenCode Zen fronts 100+ models of varying capability, and the ones that reject that parameter fail the entire request. Tolerance costs a few lines; a hard failure costs the feature. |
| D39 | **Summaries are cached on `headSha` + `promptVersion` + `model`.** | A branch that has not moved is never summarised twice — that is what makes ~100 branches cost pennies. Including the prompt version means editing the prompt regenerates everything rather than leaving a silent mix of old and new. |
| D40 | **Every commit the model cites is checked against the branch's own commits.** Invented SHAs are dropped. | A summary you cannot trace back to commits is just a claim. This is the cheapest possible hallucination guard and it costs nothing at runtime. |
| D41 | **Enrichment never blocks the snapshot.** Cached summaries apply synchronously before serving; new ones are fetched in the background and pushed to the page as they land. | A provider that is slow, down, or out of credit must cost you the summaries and nothing else. Everything that makes the page useful is already there without the LLM. |
| D42 | **A fatal provider error stops the run immediately.** | A rejected key or an empty balance fails identically for every branch; discovering that ninety-nine more times is pure waste. |
| D43 | **`BEARING_DATA_DIR` overrides where the tool's data lives.** | Lets the second machine put it elsewhere, and keeps tests out of the real data directory. |
| D44 | **A debug CLI exists (`npm run brief` / `models` / `config`) and is explicitly not a product surface.** | CLAUDE.md rule 2 already allows a debug entry point. It lets the engine be exercised and read while the interface is redesigned. No feature may be shaped around it. |

| D45 | **CI comes from GitHub Actions runs (`Actions: Read`), falling back to the commit-status API (`Commit statuses: Read`). Never from check runs.** | **GitHub does not offer the `Checks` permission to fine-grained personal access tokens** — it was withdrawn and is GitHub-App-only ([community discussion #129512](https://github.com/orgs/community/discussions/129512)). A token created exactly as this tool instructs would have 403'd on every call, and every branch would have silently read "no CI". Actions answers in one request for the common case; commit statuses are only consulted when Actions has nothing, so the cost is unchanged. |
| D46 | **The token's required permissions are: Metadata, Contents, Pull requests, Actions — all Read-only — plus Commit statuses for non-Actions CI. Nothing under Account.** | The minimum that makes every call in `github.ts` work. Recorded here because the wrong list was shipped once already. |

| D47 | **Speak all three of OpenCode Zen's protocols**, guessing from the model ID and recovering when the guess is wrong. | Zen routes model families to different endpoints — `/chat/completions` (DeepSeek, GLM, Kimi, …), `/messages` (Claude, Qwen), `/responses` (GPT, Grok). Sending a Claude model to `/chat/completions` returns a flat *"Model is unavailable"*, which reads like a billing or availability problem rather than a wrong endpoint. Supporting only one protocol silently made most of the model list unusable. What worked is remembered per model, so a wrong guess costs one extra request per run, and a failure that is *not* an endpoint mismatch (a bad key, no credit) is never retried three times. |

| D48 | **OpenCode Go and Zen pay-as-you-go are different endpoints.** Go is `https://opencode.ai/zen/go/v1` and serves every model over `/chat/completions`; Zen is `https://opencode.ai/zen/v1` and routes by model family (D47). The API key is the same for both. | A Go subscription used against the Zen URL reports *"Insufficient balance"* — indistinguishable from an empty wallet, and it sends you to add credit you do not need. The error now names the Go endpoint when it sees that message, and protocol guessing is skipped entirely on Go so no request is wasted probing `/messages` for a Claude model. |

| D49 | **Send `x-opencode-session` on every OpenCode request: one opaque ID per enrichment run, shared by every branch in that run.** | OpenCode has required the header since 6 Sep 2026 and returns 400 without it. It exists so a conversation's requests reach the same provider and keep its prompt prefix cached — and every branch in a run sends an *identical* system prompt, so routing a run together is exactly the intended use. Runs stay distinct, per the guidance that the ID be distinct across conversations. Sent only to `opencode.ai` hosts, since other providers may reject unknown headers. |

| D50 | **The page and its bundle are served `no-store`, and the UI shows a banner on any uncaught error.** | The bundle is built once at startup while `index.html` is read per request, so a browser holding an older `/app.js` pairs it with newer HTML. The old code then looks for an element the new page no longer has, throws, and the interface silently stops responding — and *reloading is what serves the stale copy*, so the obvious remedy does not work. It bricked a running install. Caching a 100 KB file from localhost buys nothing; a visible failure buys everything. |

| D51 | **"Agent-native" means native to the program, not the browser.** The agent runs server-side, reads and writes the tool's own data through a tool catalogue, and the page is its surface. It does not drive a browser and does not run in the page. | Owner's clarification. The program already holds both keys, the cache and the history, so tools are local function calls over data in memory and no secret reaches the browser. |
| D52 | **The agent writes Plane B on its own — no per-action confirmation — and every write is visible and reversible, with a log of what it did.** | Filing a hundred branches into goals is only a saving if you are not confirming each one. The safety comes from visibility and undo rather than from a prompt before each write. Plane A stays untouchable regardless (D1). |
| D53 | **Job order: answer questions → what changed since I last looked → file branches into goals → judge progress → spot drift and overlap.** | Owner's agreement with the proposed ranking. The first two need no data that does not already exist, which is why the agent comes before the organising layer rather than after it. |

---

### D54 — The interface is built in the prototype's variant C language ("The Logbook")

Supersedes **D22** (build from `dashboard-concept.html`). The owner's words: the ledger
layout "just felt so professional and like it was just ready for work. The card approach on
the other hand just look over used and childish by comparison."

The language is extracted once into `docs/design/explorations/base.css` and does not vary:
rows on a rule and no cards; a fixed-width time column; a glyph gutter; mono for machine
facts and serif italic for human reflection; teal used exactly once, on whatever is
happening now. The header comment in that file names all five, so a later revision cannot
quietly drop one.

Variant A ("The Bridge", card-based) is rejected. Variant B ("The Map") is **postponed at
the owner's request** — not rejected — to be revisited when the time is right.

### D55 — One ledger, two spines: by thread and by day

Chosen from six explorations (`docs/design/explorations/`, D6 "The Ledger"). "What is each
branch doing" and "what moved while I was away" are the only two questions the tool has to
answer, and they are the same rows grouped two ways. So there is **one** ledger with a
spine toggle, not two screens — the clearest possible expression of rule 4, since a second
screen would inevitably start computing facts of its own.

Consequences: no nav rail (the repo list is a filter, not a place); a row expands **in
place** into its dossier rather than opening a third pane; the advisor's command line is
permanent rather than behind ⌘K; and an answer is **filed into the ledger** as a dated
entry carrying its tool calls and its cost, not shown in a chat bubble that scrolls away.

### D56 — Fonts are self-hosted

The explorations ship `fonts/` (Fraunces, Inter, JetBrains Mono, latin subset, ~390 KB) and
`fonts.css` instead of linking Google Fonts. A local-first program that silently degrades
when the network is down is not local-first, and typography carries the whole hierarchy
here (D54) — falling back to system faces is not a cosmetic loss.

### D57 — The interface is the Broadsheet (exploration D4), with the register grouped by goal

The owner chose D4 over the recommended D6, and the reasons are worth keeping because
they are about how the tool gets used, not about how it looks:

- **The standing column on the right.** The single biggest reason. The ask box sits at the
  top of it and the register sits below, so a question and the thing it is a question
  about are in the same field of view.
- **“Happening now” at the top of the centre column.** Called "one big selling point".
- **The register grouped by goal**, not a flat branch list: *"the stuff below is mostly
  what the agent would organize itself, I can just comb through and see if it did it
  correctly."* The register is a checking surface, and goals are what is being checked.

D6's one genuinely better idea survives as the centre column's control: the same branches
can be read **by goal** or **by branch**, chosen from a dropdown (the owner asked for a
dropdown over a toggle). It is one grouping of one structure, not two views.

### D58 — Goals are Plane B, merged into the Snapshot at the edge

A goal groups the branches working toward it. One branch has at most one goal; assigning
a branch that already has one moves it. **Unfiled is normal, not a backlog** — most
branches start there and some never need a goal, so the unfiled group sorts last and is
labelled rather than flagged.

Goals live in `data/goals.json` and are attached to the snapshot by `applyGoals` beside
`applyCached`, not fetched with everything else. Two consequences, both deliberate:
`buildSnapshot` stays a pure transform of GitHub data (rule 5), and **filing a branch
costs no GitHub call** — the server re-merges the snapshot already in memory and pushes.

Deleting a goal unfiles its branches and touches nothing in the repo; a branch that
disappears from GitHub is pruned out of its goal, but the goal itself is kept. Plane A is
never ours to lose and Plane B is never GitHub's to delete.

### D59 — No diffstats in the dashboard

The owner: *"Seeing how many lines of code is committed is not relevant information for
this view."* `+1802 −310` is still collected and still in the Snapshot, because a later
surface — the "what changed and by how much" one that D31's dated snapshots exist for —
is exactly where it belongs. It is simply not rendered here. Ahead/behind stays: it is a
count of commits, which is navigational rather than volumetric, and it stays small (rule 3).

### D60 — The advisor answers one question in one turn, with no tools

`server/advise/ask.ts` writes the current snapshot into the prompt and asks the model
once. It is not the tool-calling agent in `docs/plans/agent-plan.md`, and it is not a
placeholder for it either — it is the floor that plan names, and the floor works anywhere.

The reason it is not the agent yet is that `npm run probe` has still not been run against
the owner's plan, so "this model can reliably call a tool" remains an assumption. Five
provider gates in a row were caused by building on exactly that kind of assumption. When
the probe comes back, this becomes the fallback path rather than being thrown away.

What the model is shown is capped by `askBranchCap` (default 60, in settings) because the
prompt — and the cost of every question — grows with the register. Every answer carries
how many branches and goals it actually saw, so a wrong answer is debuggable rather than
mysterious.

### D61 — Vision: one falsifiable sentence per branch, and it is what everything is judged against

Built. `docs/plans/vision-ux.md` is the walkthrough; this is what the decision rests on.

Inference gives the **is**; only the owner gives the **ought**. A model reading commits can
say accurately what a branch did — it cannot say whether that is what was wanted, because
"wanted" is not in the data. The vision is that missing half, stated once.

**A vision must be falsifiable or it is worthless.** "Improve the UI" can never be
contradicted, so it can never detect drift or be satisfied. The drafting prompt is told to
**decline rather than pad**, and declining is recorded as a normal outcome, not a failure.

Four states, and the distinction between two of them is load-bearing: `yours` and
`confirmed` are authoritative; `proposed` is the assistant's draft and is marked everywhere
it appears, never the basis for calling anything done. A draft silently treated as the
owner's intent makes every assessment downstream inherit a guess nobody saw.

An assessment is cached on **head SHA plus the vision text**: either moving makes the
comparison stale. Rewriting a vision therefore discards its assessment; merely confirming
one does not, because the words did not change.

### D62 — Drift is reported with both its causes, never resolved by guessing

When a branch diverges from its vision it is either that the branch wandered, or that the
owner changed their mind. The assistant cannot tell, and guessing is worse than asking — so
every drift report offers **"that's the new plan"** (which rewrites the vision in one click)
alongside "it wandered".

Without that path the mechanism rots inside a month: visions get written once, work
legitimately evolves, and everything reads as drifted forever.

"It wandered" deliberately writes nothing. The vision was right and the branch is the
problem, and fixing a branch is work on GitHub — Plane A is read-only forever (rule 1).

### D63 — `overtaken` is a fleet-level verdict, and the per-branch prompt may not return it

A branch made pointless because another branch satisfied its purpose first is the finding
that pays for the whole vision mechanism: nothing in git records it, and only stated intent
compared across the fleet can see it.

It is therefore produced by the brief — the one pass that sees everything — and the
per-branch assessment prompt has `overtaken` **stripped** from its allowed verdicts, because
a branch judged alone cannot know. A model that returns it anyway is downgraded to
`unclear` rather than believed.

### D64 — Goal judgement is proposed, never applied

`Goal.done` stays the owner's boolean. The assistant writes a separate `judgement` —
`progressing`, `at-risk`, `stalled`, `looks-done`, `needs-you` — with its reasoning and the
branches it rests on. `looks-done` surfaces as a question with an **accept** button and
nothing else flips it.

A wrong "done" is the single most damaging output the assistant has, because it is the one
the owner will never go back and check.

### D65 — Questions are derived, capped, and never asked about quiet branches

What is waiting on the owner is computed from the snapshot every read, never stored, so it
cannot go stale and answering one makes it disappear because the state changed rather than
because a flag was set.

Ordered by what it costs to leave alone: drift, overtaken, a goal that looks done, then the
setup questions. Capped by `maxOpenQuestions` (default 3) and **quiet branches are never
asked about** — most of a hundred branches are quiet, and an unasked question is not a
failure.

### D66 — A header the provider requires is set by the client, not by its callers

`x-opencode-session` is mandatory on OpenCode Go — a request without it is a flat 400
(D49). It was sent only when a caller passed a session id, and three of the six call sites
did not: **the brief failed on every single read**, for as long as the program was open,
and the only sign was a line in the terminal behind `start.bat`.

`complete()` now sets it unconditionally for an OpenCode base URL, minting one when the
caller has no batch to name. Callers that *do* have a batch still pass theirs, which is
what keeps a run's shared prompt prefix on one provider.

The general rule, which is the reason this is a decision and not just a fix: **a
requirement of the protocol belongs in the one place that speaks the protocol.** If every
call site has to remember, some of them will not, and the failure will look like a model
problem rather than a plumbing one.

A test now also asserts that nothing under `server/advise/` reaches a provider except
through `complete()`, because the guarantee only holds while that is true.

### D67 — A failure the owner cannot see is a failure that goes unfixed

The same bug ran for a day unnoticed. Its errors *were* appended to the snapshot, but
nothing announced them, so the page was never told — and the next read replaced the
snapshot before anyone looked. It was visible only in the terminal, which rule 2 says is
not a product surface.

Two changes: the refresh loop announces after appending advisor errors, and the count
appears in the dateline — the one line always in view — as well as in Notices, which sits
at the bottom of a long column. This is D50 applied to the background rather than to the
page: anything that breaks should say so on screen.

### D68 — Work is derived onto a board, never queued

Every read derives the whole set of outstanding jobs from the snapshot plus what is already
on disk — the same derivation `assist()` already does, consumed by a dispatcher instead of
a `for` loop. Job ids are **derived and stable** (`kind:repo:branch:headSha`), so a read
landing while a worker is mid-flight finds the job already claimed rather than starting a
second one.

The reason this shape rather than a queue: **routine work then recovers from a crash for
free.** A summarise that died halfway leaves no summary on disk, so the next read derives
it again. There is nothing to restore and nothing to reconcile, because there is no second
copy of the truth. A queue would be exactly that second copy, and the copy is the thing
that goes stale.

Work the owner *dispatched* is the exception and is written down (D72), because nothing in
the fleet implies it — it exists only because they asked.

### D69 — Every job carries a predicate, and done is checked rather than claimed

Three stopping conditions, all three needed: the worker stops asking for tools; the
predicate agrees against the snapshot; the budget runs out. The middle one is what makes a
room of workers safe here, and Bearing is unusual in being able to have it — *"summarise
this branch"* is done when a summary exists at this head SHA, which is free to check and
cannot be faked.

The exception is judgement — *is this goal done?* — which has no predicate, which is
precisely why it stays a proposal the owner accepts (D64).

Two consequences kept deliberately: every disagreement between a worker's claim and its
predicate is **counted**, because a rising number is the only early sign that the tools are
wrong or the job is too big; and a job that fails twice **parks as something waiting on
you** rather than retrying or vanishing (D67 again, one layer down).

**A job whose predicate can never become true is a job that runs forever.** That rule found
a live cost bug the moment it was written — see D70.

### D70 — Declining to draft a vision is recorded, not just returned

`draft vision` was derived as *"active, has commits, `vision === null`"*. The model is
instructed to decline rather than write something unfalsifiable, and a decline wrote
nothing — so the branch still had no vision, the job was derived again on the next read,
and it was paid for again. Every minute, for every branch it had ever declined, for as long
as the program was open.

A decline is now stored against the head SHA it was made at: the branch moving is what
makes the question worth asking again, and nothing else does. The bug is ordinary; what is
worth keeping is that the predicate rule found it on paper, before any of it was built.

### D71 — Two lanes: routine work is capped, dispatched work is never queued behind it

`workers` (default 2) runs the board. `dispatchWorkers` (default 2) serves work the owner
asked for, starting immediately and in addition. The owner's reasoning, kept because it is
the actual justification for such a small number: the only real burst is the first import;
after that branches move every few minutes, and a machine left running overnight finishes
everything regardless.

Both are settings (rule 7), and both are capped — "spin up another rather than block" is
right, "spin up another every time" is how a runaway bill arrives faster.

### D72 — Only dispatched work is persisted, and it reboots on the next start

Written to `data/dispatched.json` when accepted, cleared when its predicate passes, put
back on the board at startup if it is still there. Rebooted twice without finishing, it
parks — otherwise one poison job re-runs on every startup for the rest of the program's
life.

Routine work is deliberately *not* logged for recovery: it is derivable, and a recovery log
for derivable work is a second source of truth that will eventually disagree with the
first. The append-only run log (`data/runs.jsonl`) is a separate thing, and it is for the
owner and for the disagreement counter, not for recovery.

### D73 — The floor is a product surface

The owner asked to see how many workers are active and what each is doing, so it is built
rather than left as a debug view: a count in the dateline beside the failure count (D67),
and a panel under the advisor listing live jobs in plain English — *"Reading what
claude/kind-meitner is doing"*, with the job kind as small supporting metadata (rule 3).
Dispatched work is marked as the owner's. Parked jobs join *Waiting on you* rather than
starting a second list of problems. The panel is derived from the board like every other
surface (rule 4).

### D74 — A station's tool list is part of its prompt version

Adding a tool changes what a station can see and therefore what it writes. If the cache key
does not move, the store silently mixes answers drawn from different evidence with no way
to tell which is which — the exact failure `PROMPT_VERSION` already exists to prevent
(D39). So the tool set is folded into the version, and adding a tool regenerates
everything that station produced, the same way editing its prompt does.

This also settles the tool caution recorded in `ai-map.html`: it was calibrated to one real
burn (`response_format` failing whole requests on some Zen models) and generalised further
than the evidence supported. Native tool calling is used where the model supports it, with
a plain JSON protocol as the floor — same catalogue either way — because the provider is
swappable by design (D32), not because the models are suspect.

### D75 — The budget is counted in provider calls, and a job is claimed only if the read can pay for it in full

`llmMaxPerRun` used to count *jobs*, which was fine while every job was one call. With
lookups it stopped meaning anything: a cap of forty claimed forty jobs, each of which could
then look eight things up — three hundred and sixty calls behind a number that said forty.

Two changes. The budget is now a purse counted in calls: claiming a job takes one, and every
lookup asks for another. And a pass claims jobs against a **reserve** — one call, plus one
more for a station that has tools — rather than against the raw cap.

The reserve is the part worth keeping. Claiming purely by the cap was *worse* than a guess:
a budget of four claimed four jobs, each then wanted a lookup there was no money for, and
the read finished nothing at all while spending everything. Better to start half the work
and finish it than to start all of it and finish none.

When the purse does empty mid-conversation, the job **fails without writing anything**. The
alternative — hand back the half-finished exchange — has the station parse a tool call as a
verdict and store "unclear, no reason given", which is an accounting limit wearing the
clothes of a judgement. Nothing written, nothing charged for twice: the next read does it
properly.

### D76 — A fatal provider error parks nothing

A rejected key, an empty wallet, a model that does not exist: nothing about the *job*
failed, and every other job would fail identically. So the attempt is not counted and
nothing parks.

Found by an audit, and it was worse than it sounds. Two reads with a bad key gave every
claimed job its second failure, so the whole fleet parked; fixing the key brought back one
branch, and the rest sat in *Waiting on you* needing a click each — a repair job created
entirely by the reporting of the original problem. Settings changes now also clear every
remembered failure, because a key, a model and an endpoint are exactly what was just edited.

### D77 — A tool never sees a secret

`ToolContext` carries `SafeSettings` — the same object the browser is allowed, with the
GitHub token and the provider key removed. A tool's output goes straight into a prompt that
goes straight to a provider, and a tool cannot leak what it never had.

This costs nothing today, because no tool wants either. It is written down now because the
first tool that touches GitHub (step 4) will be the moment someone reaches for the token —
and the answer is that it gets a narrow reader passed to it, never the credentials to make
its own calls. A test asserts that nothing under `server/tools/` names either secret, or
writes anything anywhere.

### D78 — The brief is a stage, not a condition

It was derived only when the board was otherwise empty, which reads as "it goes last" and
means something else: **a parked job is still on the board**. One branch the model would not
summarise blocked the brief — the most valuable thing the assistant writes — permanently.

Jobs now carry a stage: everything about one branch is 0, the brief is 1. The dispatcher
works the lowest stage that has anything *runnable* in it, and work that has given up is
filtered out before that choice is made. Ordering stays a number, so there is still no
foreman deciding it.

## 2. Carried over from the old documents

Still true, and still good reasons.

| # | Decision | Why |
|---|---|---|
| D15 | **One canonical data structure; every surface renders it.** If a view needs a fact, the fact goes into the structure — never computed in the view. | The old "Brief JSON is the product" rule. It is what lets surfaces change without touching the engine. |
| D16 | **I/O at the edges, pure logic in the middle.** Fetching and storage at the boundary; pure, testable functions between. | Where correctness is guaranteed and where the tests live. |
| D17 | **The literal git branch name is always shown and always searchable.** | You act on the real name; an alias adds a translation step exactly when you have no context to spare. *(Whether an LLM title may appear alongside it: Q37.)* |
| D18 | **Notes are one-liner scratchpads, not a journal** — now entered in the GUI. | A journal is a second thing to maintain; a one-liner is something you actually write. |
| D19 | **Show a capped, prioritized set** rather than everything. | Stated again in Q18. Paging through the remainder is wanted but deferred. |

---

## 3. Overturned

Kept because the arguments still explain how the current design was reached.

| Old decision | Replaced by | Why it fell |
|---|---|---|
| ~~Python 3.11+, stdlib only, no dependencies~~ | D9 | Owner: dependencies are fine if they help. The constraint existed to keep a CLI portable; the product is not a CLI. |
| ~~All git access via `git` subprocess with porcelain formats~~ | D2 | The data comes from the GitHub API now. Local git may still be read for repos that are cloned, but it is not the source of truth. |
| ~~Offline-first; the tool does no networking~~ | D10 | GitHub is the data source and sync is cloud-based. |
| ~~Multi-machine sync via one append-only journal file per machine in a replicated folder~~ | D13 + Stage 4 | Owner wants a real backend (Supabase/Firebase). Also unnecessary: GitHub already syncs everything except annotations. |
| ~~Journal scope is metadata-only by default~~ | — | Obsolete with the journal design. Privacy question re-asked as part of Q33. |
| ~~GitHub via `gh` CLI passthrough, no token management~~ | Q34 (open) | "Built from the ground up"; `gh` on both machines complicates packaging. |
| ~~The advisor is built last; v1 is fully deterministic~~ | **D21** | Owner said defer, but ranked LLM insight as priority #2 and made the LLM responsible for goal/milestone upkeep. Resolved 16 Sep: the LLM lands at Stage 2. |
| ~~Python 3.11+ as the implementation language~~ | **D20** | Chosen for a portable stdlib-only CLI. The product is a GUI; TypeScript spans front and back. The Python skeleton was deleted. |
| ~~Brief cadence: on-demand plus a shell-startup one-liner~~ | Q39 (open) | No terminal, so no shell hook. |
| ~~`diverged` = behind base by > 20 commits~~ (and every other fixed threshold) | D11 | All thresholds move to settings. |
| ~~Success metric: branch reduction~~ | D7 | The goal is the opposite. |
| ~~Performance budget: < 5 s across 4 repos, ≤ 3 git calls per branch~~ | — | Written for local subprocess calls. A network-bound budget needs rewriting once the stack is chosen. |
| ~~`safe-to-delete` is list-only, permanently~~ | Still true, but deprioritized | Follows from D1. Just no longer a feature anyone is waiting for. |
| ~~Build the dashboard from `dashboard-concept.html`~~ (D22) | **D54** | Wrong file. The three-variant prototype was in `docs/design/prototype/` the whole time; variant C is the design language. Cards are out. |
| ~~Board / Needs you / Timeline / Your notes as four views~~ | **D57** | One column, one list, one grouping control. The four tabs were four filters pretending to be places. |

---

## 4. Still open

See [`open-questions.md`](open-questions.md) §2 (conflicts C1–C6) and §3 (decisions Q30–Q40).

**All questions are answered.** Round 2 closed on 16 Sep 2026 → D20–D36.

The only item still genuinely open is **Q37** — whether the LLM may write a short
plain-English title to sit beside the literal branch name. The owner said yes but noted the
question was unclear, so it is re-explained in `open-questions.md` with an example and
should be confirmed before Stage 2 renders one.
