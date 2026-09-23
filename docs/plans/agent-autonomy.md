# The agent — the advisor that runs the program for you

**Drafted:** 23 Sep 2026 · **Status:** 📝 **awaiting the owner's confirmation. Nothing here is
built.** · Decision: D94 · Supersedes the limits in D84, and
[`agent-plan.md`](agent-plan.md) (a draft that was never agreed).

---

## What this is for

The owner, 23 Sep:

> *"I want to give the agent almost full autonomy as it pertains to the program. However, I
> do not want it making any edits whatsoever to the repo. Just reads."*

And earlier, on what that means in practice: *"a true AI agent that can go around making
edits by me simply talking to it — organise the registry, update the brief, among other
things."* Pushing, merging and branching are done with other tools and are not wanted here.

The audit of 23 Sep found the advisor is not that. It answers questions, can queue a
re-read, and proposes a regrouping you must click to accept. It cannot file a branch, touch
a goal, set a vision or steer the brief — and worse, it can *say* it did any of those and
nothing checks. That gap was a choice, not a limit of the design: the workroom was built so
that the advisor "queues, never does" (D84), and regrouping was made a proposal because the
question of propose-or-act (Q76) went unanswered. It is answered now.

**The line, in one sentence:** everything the program owns is the agent's to change when
you ask; nothing on GitHub is, ever.

---

## 1. The one line it never crosses

| | Plane A — your repos | Plane B — the program's own data |
|---|---|---|
| **Read** | Yes — branches, commits, files a commit touched, READMEs, pull requests, CI | Yes — all of it |
| **Write** | **Never.** | **Yes**, when you ask, recorded and undoable (§3) |

"Never" is enforced by **structure, not by the prompt**. A prompt is a request; it is not a
guarantee, and a model that has been told "don't push" still holds whatever tools it was
given. So:

- **There is no write path to give it.** Every GitHub request in the program goes through
  one module, `server/github.ts`, which never sets an HTTP method — every call is a GET.
  Nothing else in `server/` addresses GitHub, and nothing runs `git`. This is true today.
- **A test makes it stay true.** It fails the build if any file sends a non-GET request to
  GitHub, imports a git library, or spawns any process other than the browser opener. The
  test already guarding the tools directory (D77) is widened to the whole server.
- **Tools are handed a reader, never a credential.** The token stays on the server; a tool
  gets two or three bound read functions and cannot make a call nobody wrote (D77).
- **It cannot see or change credentials.** The GitHub token, the provider key, the provider
  and the model are outside its reach entirely (§2, settings).

This is also consistent with `requirements.md` §7 — "never … dispatches work". The agent
never starts work *on a repo* or runs a coding agent. Queuing the program's own re-reads is
the program reading, not working.

---

## 2. What it may do

Everything in the program. By area:

| Area | Reads | Writes |
|---|---|---|
| **The register** | every branch, as a compact index; any one in full on demand; search; what moved over the last days | — |
| **Goals** | goals, their members, their judgements | create, rename, edit the note and milestone label, delete, mark done or not done |
| **Filing** | which branch sits where | file, unfile, move — any number of branches in one step |
| **Visions** | what each branch is for, and whose words those are | set, confirm, clear, redraft — one branch or many |
| **The brief** | the current brief and its age | rewrite it now; give it **standing instructions** it follows every time ("lead with anything red", "leave the old experiments out") |
| **The board** | what is running, queued and parked | queue re-reads, re-checks and redrafts for any set of branches; retry parked work |
| **Settings** | all but the secrets | anything except credentials, provider and model — and spending limits only **downward** (below) |
| **Its notebook** (§4) | what you have told it to remember and to keep doing | add, change, remove — when you say so |
| **GitHub** | commits, the files a commit touched, READMEs, pull requests and their reviews, CI | **nothing, ever** (§1) |

**Spending limits only go down.** The agent may lower `llmMaxPerRun`, the reply allowance,
the worker counts or its own per-question budget, and may not raise any of them. An agent
that can raise its own budget is the one way autonomy turns into a bill; you raise them in
settings, it never does.

**Later, with Stage 3:** notes on branches and goals (R6) and tags (3.3) arrive as new stores
the agent writes from day one, and milestones become real objects above goals (3.1). Each is
a row in §2, not a new design.

---

## 3. How autonomy stays safe: act, show, undo

The old safety model was *ask first*: a proposal, and a button. It made every change cost
you a click and made talking to the agent pointless for anything that mattered. The new one
is *act, then make it visible and reversible* — which is how a trusted assistant works.

- **One door for every write.** Each thing the agent can change is one function in a single
  action layer, which validates the change, applies it through the existing store
  (`goals.ts`, `vision.ts`, `settings.ts`, …), and **records it**: what changed, before and
  after, the words of yours that asked for it, which conversation, and when.
- **The record is Plane B.** `data/actions.json`, through `jsonfile.ts` like every other file
  (D85), keeping the last *N* actions (a setting). It survives restarts.
- **What it did is read from the record, never from its words.** Under every answer, the list
  of changes is rendered from the actions that turn recorded. Prose cannot add to it. That is
  the structural fix for the worst audit finding: an agent that *says* it filed something.
- **Every action undoes.** One at a time, or everything from one conversation. An undo checks
  first that nothing has changed since — if you, or a later action, edited the same thing,
  it says so rather than overwriting your newer work.
- **Deleting keeps what it needs to come back.** A deleted goal is recorded with its members
  and note, so undo restores it exactly.

The proposal button does not disappear: "show me first" still gets a proposal with a *do it*
button. It simply stops being the only way.

---

## 4. The notebook — standing instructions, and what to remember

Anything you want the agent to keep knowing, or keep doing, lives in one visible, editable
list in Plane B — never in the conversation, which is only a transcript and expires (D93).

| Kind | Example | Where it is used |
|---|---|---|
| **Remember** | "Project_Management is the CRM rewrite." · "claude/punch-list is abandoned." | every conversation |
| **For the brief** | "Lead with anything red." · "Leave the September experiments out." | every brief |
| **Standing order** | "File new webhook branches under Payments." · "When every branch in a goal has merged, mark it done." | every read (below) |

**Standing orders are how it acts without being asked each time — on rules you set.** They
run as one more station on the board (D68): on a read that brings new or changed branches,
one call reads the orders and those branches and acts through the same action layer, so
every change is recorded and undoable exactly as if you had asked in person. It costs a call
only when something new arrived.

The notebook is shown in its own panel, and the agent adds to it only when you tell it to
("remember that…", "from now on…").

---

## 5. The audit, finding by finding

| # | Finding (23 Sep audit) | Fixed by | Phase |
|---|---|---|---|
| 1 | It can claim an edit it never made | the capability list in its prompt, the "what it did" list read from the record, and a check that flags any answer claiming a change none was recorded for | 1, 2 |
| 2 | "Yes, file them" cannot act on a proposal | real write tools, and memory that holds what it proposed and did, not only what it said | 1, 3 |
| 3 | Bulk requests fail part-way, silently | batch tools (one call, many branches); a run that stops early reports what it did and what is left, instead of an error | 1 |
| 4 | It sees only the 60 newest branches | an index line for **every** branch, full detail by tool on demand | 1 |
| 5 | Switching off station lookups removes its tools | its own switch and its own budget, independent of the stations' | 1 |
| 6 | Page and server remember different conversations | the page restores the server's thread on load | 1 |
| 7 | Slow: one round trip per action | batch tools; live progress on the page; native tool calling once `npm run probe` confirms it | 1, 2, 7 |

---

## 6. How it runs

- **The register as an index.** One line per branch — name, repo, goal, where it stands, age —
  for all of them, about 12k characters at a hundred branches. Full detail (the recap, the
  commits, the vision, the verdict) comes from a `branch` tool when it needs it. The
  `askBranchCap` setting becomes "how many arrive in full up front", not "how many exist".
- **Batch tools.** `file`, `queue`, `set_vision` and the rest take lists. "File these twelve
  under Payments" is one call, not twelve round trips each resending the register.
- **Its own budget.** `agentCallsPerQuestion` and `agentSeconds`, separate from the read
  budget and from the stations' lookups. When it runs out mid-task it says what it did and
  what is left — "filed 8 of 20; ask me to carry on" — rather than failing the whole answer.
- **Its own switch.** `agentEnabled`, independent of `toolsEnabled`, so turning off the
  stations' lookups no longer quietly removes its ability to act.
- **Slow work still goes to the board.** "Re-check all forty" queues forty jobs and answers in
  seconds; the floor shows them running and tells you when they land, as it does now.
- **Live progress.** While it works, the answer card shows each change as it is recorded, the
  way the floor shows jobs.
- **Memory.** The transcript (D93) also holds what it proposed and what it changed, so a
  follow-up can act on either. The page restores it after a reload, and "new thread" still
  forgets it.

---

## 7. Build order

Each phase is useful alone and leaves the program working.

| | Phase | What lands | Done when |
|---|---|---|---|
| **1** | **Honest and whole** — no new powers | capability list in the prompt · claimed-but-not-done check · index of every branch + `branch` tool · batch `queue` · partial runs reported · own switch and budget · thread restored on reload · transcript remembers proposals and actions · the read-only test widened to all of `server/` | every audit finding except "cannot edit" is closed, each with a test |
| **2** | **The record and undo** | the action layer · `data/actions.json` · "what it did" rendered from the record · undo one or all, conflict-checked · live progress | an action made by talking can be seen and undone from the page |
| **3** | **Goals and filing** | create, rename, note, delete, done / not done · file, unfile, move many · "organise the register" acts, with "show me first" still available | "organise the register by theme" files everything in one answer, and one click undoes it |
| **4** | **Visions, the brief, the board** | set, confirm, clear, redraft visions, in bulk · brief instructions · retry parked · queue anything | "update the brief to lead with what's red" changes every brief after it |
| **5** | **The notebook, standing orders, settings** | the notebook panel · the standing-orders station · settings within the limits of §2 | a standing order files a newly pushed branch on the next read, recorded and undoable |
| **6** | **Stage 3 stores** | notes, tags, milestones — written by the agent from day one | per Stage 3 in the roadmap |
| **7** | **Native tool calling** | provider-native tools where `npm run probe` says they work; the JSON protocol stays the floor (D32) | fewer, cheaper round trips on the owner's model |

Phase 1 comes first on purpose: **an agent that can act must first be one that cannot lie
about acting.** Giving it write tools before the honesty checks would turn today's worst
finding from a misleading sentence into a misleading change.

---

## 8. What it costs

- **A question** grows by the index — roughly 12k characters at a hundred branches — and
  shrinks in round trips, because batch tools replace one call per action with one call per
  task. The provider session keeps the register prefix cached across a conversation (D66).
- **Standing orders** cost one call on a read that brought something new, and nothing on a
  read that did not.
- **Undo** costs nothing: it is local.
- **The ceiling is yours.** The agent's own budget is a setting, and it may lower but never
  raise any spending limit (§2).

---

## 9. What it will never do

- **Write to GitHub in any way** — push, merge, create or delete a branch, open or comment on
  a pull request or issue, review, label, trigger a workflow, change a setting.
- **Run `git`, or any program.**
- **See or change credentials**, or change the provider or model.
- **Raise its own spending limits.**
- **Erase its own record of what it did.**
- **Act on its own initiative** beyond the standing orders you gave it (Q77).

---

## 10. Open questions

Each has a working default, so none blocks phase 1.

| # | Question | Default |
|---|---|---|
| **Q77** | Should it ever act **unprompted**, beyond the standing orders you give it — say, filing an obviously-related new branch without a rule? | **No.** It acts when you ask, and on the rules you set. Background stations keep writing summaries, drafts and verdicts as today. |
| **Q78** | May it **mark a goal done** when you tell it to? (D64 says a judgement is never applied.) | **Yes when you ask, or when a standing order of yours says so. Never on its own.** D64 still holds for the brief's judgements. |
| **Q79** | Which **settings** may it change? | Everything except credentials, provider and model; spending limits only downward; adding or removing a repo allowed and undoable — removing one keeps its data (D86). |
| **Q80** | How much **undo history** is kept? | The last 500 actions, as a setting. |
| **Q81** | Should it **ask first** above some size — "this moves forty branches, go ahead?" | **No.** It acts, the answer leads with a one-line summary and *undo all*. A threshold can be added later if it ever surprises you. |

---

## 11. Decisions this changes

| Decision | Change |
|---|---|
| **D84** — the desk queues, never does; regrouping is a proposal | **Superseded for Plane B.** It acts on anything the program owns; proposals remain available on request. Queuing slow work to the board stays. |
| **D64** — a goal judgement is proposed, never applied | **Narrowed.** Still true of the brief's own judgements. A goal may be marked done when the owner asks, or by the owner's standing order (Q78). |
| **D77** — a tool never sees a secret | **Unchanged, and widened** by the read-only test (§1). |
| **D93** — the advisor remembers the last few exchanges | **Extended.** The transcript also carries proposals and actions; the notebook (§4) is where anything durable goes. |
| `requirements.md` §4, §7 | **Unchanged.** Plane A read-only forever; the program never starts work on a repo. |
