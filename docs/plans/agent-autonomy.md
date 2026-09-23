# The agent — the advisor that runs the program for you

**Drafted:** 23 Sep 2026 · **Status:** ✅ **confirmed 23 Sep with the owner's answers (§10);
phases 1–5 built 23 Sep** (6 and 7 wait on Stage 3 and a probe) · Decisions: D94, D95 · Supersedes the limits in D84, and
[`agent-plan.md`](agent-plan.md) (a draft that was never agreed).

---

## What this is for

The owner, 23 Sep:

> *"I want to give the agent almost full autonomy as it pertains to the program. However, I
> do not want it making any edits whatsoever to the repo. Just reads."*

And on what that means in practice: *"a true AI agent that can go around making edits by me
simply talking to it — organise the registry, update the brief, among other things."*
Pushing, merging and branching are done with other tools and are not wanted here.

The audit of 23 Sep found the advisor is not that. It answers questions, can queue a
re-read, and proposes a regrouping you must click to accept. It cannot file a branch, touch
a goal, set a vision or steer the brief — and worse, it can *say* it did any of those and
nothing checks. That gap was a choice, not a limit of the design: the workroom was built so
that the advisor "queues, never does" (D84), and regrouping was made a proposal because the
question of propose-or-act (Q76) went unanswered. It is answered now.

**The line, in one sentence:** when you ask, anything the program owns is the agent's to
change, except its settings; nothing on GitHub is, ever; and it does nothing you did not ask.

---

## 1. The one line it never crosses

| | Plane A — your repos | Plane B — the program's own data |
|---|---|---|
| **Read** | Yes — branches, commits, files a commit touched, READMEs, pull requests, CI | Yes — all of it, settings included (never the secrets) |
| **Write** | **Never.** | **Yes**, when you ask — recorded, notified and undoable (§3, §4). Settings excepted (§2). |

"Never" is enforced by **structure, not by the prompt**. A prompt is a request; it is not a
guarantee, and a model that has been told "don't push" still holds whatever tools it was
given. So:

- **There is no write path to give it.** Every GitHub request in the program goes through
  one module, `server/github.ts`, which never sets an HTTP method — every call is a GET.
  Nothing else in `server/` addresses GitHub, and nothing runs `git`. This is true today.
- **A test makes it stay true.** It fails the build if any file sends a non-GET request to
  GitHub, imports a git library, or spawns any process other than the browser opener.
- **Tools are handed doors, never modules or credentials.** A station gets a bound reader
  (D77). The agent additionally gets one *action* door, built for the one question it is
  answering; stations never get it, so no background job can write anything but its own
  answer.
- **It cannot see or change credentials, and it changes no settings at all** (§2).

This is also consistent with `requirements.md` §7 — "never … dispatches work". The agent
never starts work *on a repo* or runs a coding agent. Queuing the program's own re-reads is
the program reading, not working.

---

## 2. What it may do

When you ask, and only then (Q77):

| Area | Reads | Writes |
|---|---|---|
| **The register** | every branch — the most recent in full, the rest as one line each; any one in full on demand | — |
| **Goals** | goals, their members, their judgements | create, rename, edit the note and milestone label, delete, **mark done or not done** — done included, without asking first (Q78, §4) |
| **Filing** | which branch sits where | file, unfile, move — any number of branches in one step |
| **Visions** | what each branch is for, and whose words those are | set, confirm, clear — one branch or many; queue a redraft |
| **The brief** | the current brief and its age | rewrite it now; give it **instructions** it follows every time ("lead with anything red") |
| **The board** | what is running, queued and parked | queue re-reads and re-checks for any set of branches; retry parked work |
| **Its notebook** (§5) | what you have told it to remember | add and remove — when you say so |
| **Settings** | every setting except the secrets | **none.** It may *suggest* a change, which you apply with one click (Q79) |
| **GitHub** | commits, the files a commit touched, READMEs, pull requests, CI | **nothing, ever** (§1) |

**Settings are yours.** The agent reads them and, when it thinks one is holding you back —
too few calls per read for the size of the fleet, say — it suggests a value and says why.
The suggestion appears under its answer with an *apply* button; pressing it is you changing
the setting, not the agent. The settings screen also gains **reset to defaults**, which
fills every tunable with its default and leaves the token, the key, the repos, the provider
and the model alone; nothing changes until you press save.

**Later, with Stage 3:** notes on branches and goals (R6) and tags (3.3) arrive as new stores
the agent writes from day one, and milestones become real objects above goals (3.1). Each is
a row in this table, not a new design.

---

## 3. How autonomy stays safe: act, show, undo

The old safety model was *ask first*: a proposal, and a button. It made every change cost
you a click and made talking to the agent pointless for anything that mattered. The new one
is *act, then make it visible and reversible* — which is how a trusted assistant works. It
never asks before a large change (Q81).

- **One door for every write.** Each thing the agent can change is one function in a single
  action layer, which validates the change, applies it through the existing store
  (`goals.ts`, `vision.ts`, …), and **records it**: what changed, before and after, the words
  of yours that asked for it, which answer it belongs to, and when.
- **The record is Plane B.** `data/actions.json`, through `jsonfile.ts` like every other file
  (D85), keeping the **last 500** changes (`agentHistory`, a setting — Q80). It survives
  restarts.
- **What it did is read from the record, never from its words.** Under every answer, the list
  of changes is rendered from the actions that answer recorded. Prose cannot add to it. And
  an answer that *claims* a change when none was recorded is flagged on screen. That is the
  structural fix for the worst audit finding.
- **Undo one, or undo everything from one prompt.** Every change has its own undo, and every
  answer has *undo all*, which reverts the whole set of edits that one prompt caused. An undo
  checks first that nothing has changed since — if you, or a later change, edited the same
  thing, it says so rather than overwriting your newer work.
- **Deleting keeps what it needs to come back.** A deleted goal is recorded with its members
  and note, so undo restores it exactly.

"Show me first" still gets a proposal with a *file them like this* button, and accepting it
goes through the same record, so it is undoable too. It simply stops being the only way.

---

## 4. The changes feed — catching what looks wrong

The owner, on letting it mark goals done: *"make a note that a notification system should be
implemented so I can track those updates and catch any that look incorrect."*

The record already knows every change; the feed is where you see them without having been
watching:

- **A "changes" panel** in the standing column, newest first, each change in plain English
  with its own *undo*. Changes you have not looked at yet are marked.
- **Goals marked done are flagged** — the one change D64 warned is never gone back to, so it
  is the one made hardest to miss: highlighted in the feed, and named in the dateline until
  you have seen it ("the agent marked 2 goals done").
- **An unseen count in the dateline**, the one line always in view (D73). *Mark all seen*
  clears it.

It is a view of the record, not a second store: the seen state lives on the same entries.

---

## 5. The notebook — what it has been told to remember

Anything you want the agent to keep knowing lives in one visible, editable list in Plane B —
never in the conversation, which is only a transcript and expires (D93).

| Kind | Example | Where it is used |
|---|---|---|
| **Remember** | "Project_Management is the CRM rewrite." · "claude/punch-list is abandoned." | every question you ask |
| **For the brief** | "Lead with anything red." · "Leave the September experiments out." | every brief — and adding one rewrites the brief at once |

It adds to the notebook only when you tell it to ("remember that…", "from now on the brief
should…"), and you can remove any entry from the panel.

**No standing orders.** An earlier draft let the notebook hold rules the agent applied on its
own at every read ("file new webhook branches under Payments"). The owner's answer to Q77 —
never act unprompted — rules that out: a rule firing on a background read is the agent
acting without being asked in that moment. The background stations keep doing exactly what
they do today.

---

## 6. The audit, finding by finding

| # | Finding (23 Sep audit) | Fixed by | Phase |
|---|---|---|---|
| 1 | It can claim an edit it never made | the capability list in its prompt, the "what it did" list read from the record, and a flag on any answer claiming a change none was recorded for | 1, 2 |
| 2 | "Yes, file them" cannot act on a proposal | real write tools, and memory that holds what it proposed and did, not only what it said | 1, 3 |
| 3 | Bulk requests fail part-way, silently | batch tools (one call, many branches); a run that stops early reports what it did and what is left, instead of an error | 1 |
| 4 | It sees only the 60 newest branches | every branch in the prompt — the recent in full, the rest one line each — and a `branch` tool for full detail | 1 |
| 5 | Switching off station lookups removes its tools | its own switch and its own budget, independent of the stations' | 1 |
| 6 | Page and server remember different conversations | the page restores the server's thread on load | 1 |
| 7 | Slow: one round trip per action | batch tools; native tool calling once `npm run probe` confirms it | 1, 7 |

---

## 7. How it runs

- **Every branch in view.** The `askBranchCap` most recent arrive in full, as today; every
  other branch arrives as one line — name, repo, goal, where it stands, age. A `branch` tool
  gives any of them in full. No branch is invisible.
- **Batch tools.** Filing, queuing and setting visions take lists. "File these twelve under
  Payments" is one call, not twelve round trips each resending the register.
- **Its own switch and budget.** `agentEnabled` decides whether it may *change* things — off,
  it still answers and reads — and `agentCallsPerQuestion` and `agentSeconds` bound one
  answer, separate from the read budget and from the stations' lookups. When it runs out
  mid-task it says what it did and what is left rather than failing the whole answer.
- **Slow work still goes to the board.** "Re-check all forty" queues forty jobs and answers in
  seconds; the floor shows them running and tells you when they land, as it does now.
- **Memory.** The transcript (D93) also carries what it proposed and what it changed, so a
  follow-up can act on either. The page restores it after a reload; "new thread" forgets it.

---

## 8. Build order

Each phase is useful alone and leaves the program working.

| | Phase | What lands | Done when |
|---|---|---|---|
| ✅ **1** | **Honest and whole** — no new powers | capability list · claimed-but-not-done flag · every branch in the prompt + `branch` tool · batch `queue` · partial runs reported · `agentEnabled` and its own budget · thread restored on reload · transcript remembers proposals and actions · the read-only test across all of `server/` | every audit finding except "cannot edit" is closed, each with a test |
| ✅ **2** | **The record, undo, the changes feed** | the action layer · `data/actions.json` (500) · "what it did" from the record · undo one, undo all from one prompt, conflict-checked · the changes panel, goal-done flagged, unseen count in the dateline | a change made by talking can be seen, found later in the feed, and undone |
| ✅ **3** | **Goals and filing** | create, rename, note, delete, done / not done · file, unfile, move many · "organise the register" acts · accepting a proposal is recorded | "organise the register by theme" files everything in one answer, and *undo all* reverts it |
| ✅ **4** | **Visions, the brief, the board** | set, confirm, clear visions in bulk · brief instructions · retry parked · read the board | "have the brief lead with what's red" changes every brief after it |
| ✅ **5** | **The notebook, settings** | the notebook panel · settings readable, suggestions you apply · **reset to defaults** on the settings screen | a suggestion appears with an *apply* button, and the agent has changed no setting |
| **6** | **Stage 3 stores** | notes, tags, milestones — written by the agent from day one | per Stage 3 in the roadmap |
| **7** | **Native tool calling** | provider-native tools where `npm run probe` says they work; the JSON protocol stays the floor (D32) | fewer, cheaper round trips on the owner's model |

Phase 1 comes first on purpose: **an agent that can act must first be one that cannot lie
about acting.**

---

## 9. What it costs

- **A question** grows by one line per branch beyond the cap, and shrinks in round trips,
  because batch tools replace one call per action with one call per task. The provider
  session keeps the register prefix cached across a conversation (D66).
- **Undo and the feed** cost nothing: they are local.
- **The agent adds no background cost.** It acts only when asked (Q77), so an unattended
  program spends exactly what it spent before.

---

## 10. The owner's answers — 23 Sep

| # | Question | Answer |
|---|---|---|
| **Q77** | Should it ever act unprompted? | **Never.** It acts only on what you ask. Standing orders are dropped (§5). |
| **Q78** | May it mark a goal done? | **Yes, on its own judgement within a request**, without asking first — and every one is flagged in the changes feed so a wrong one gets caught (§4). |
| **Q79** | Which settings may it change? | **None.** It reads them (never the secrets) and suggests; you apply. Plus a **reset to defaults** button. |
| **Q80** | How much undo history? | **The last 500 changes.** |
| **Q81** | Should it ask before large changes? | **No.** Undo one change, or everything from one prompt, instead. |

---

## 11. What it will never do

- **Write to GitHub in any way** — push, merge, create or delete a branch, open or comment on
  a pull request or issue, review, label, trigger a workflow, change a setting.
- **Run `git`, or any program.**
- **Act without being asked.**
- **Change a setting**, see a credential, or change the provider or model.
- **Erase its own record of what it did.**

---

## 12. Decisions this changes

| Decision | Change |
|---|---|
| **D84** — the desk queues, never does; regrouping is a proposal | **Superseded for Plane B.** It acts on anything the program owns except settings; proposals remain available on request. Queuing slow work to the board stays. |
| **D64** — a goal judgement is proposed, never applied | **Narrowed.** Still true of the brief's own judgements, which never mark anything done. The agent may mark a goal done within a request, and every such change is flagged in the feed. |
| **D77** — a tool never sees a secret | **Unchanged, and widened** by the read-only test (§1). |
| **D93** — the advisor remembers the last few exchanges | **Extended.** The transcript also carries proposals and changes; the notebook (§5) is where anything durable goes. |
| `requirements.md` §4, §7 | **Unchanged.** Plane A read-only forever; the program never starts work on a repo. |
