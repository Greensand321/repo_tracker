# Memory and work for the agent — a plan to argue with

**Drafted:** 17 Sep 2026 · **Status:** draft, not agreed. Open questions at the end.

Follows [`agent-plan.md`](agent-plan.md), which covered *what the agent does* and *what
tools it holds*. This covers the two things that plan left out: **what it remembers
between instances**, and **how it knows what to work on**.

---

## 1. You are already running this system. On me.

Worth saying first, because it changes the question.

`CLAUDE.md` + `docs/STATUS.md` + `docs/decisions/decision-log.md` is exactly the
architecture you just described, and it has been working for two weeks across a dozen
fresh instances that shared no context at all:

| What you described | What you already have | Why it works |
|---|---|---|
| A scratchpad every instance reads | `CLAUDE.md` — ~90 lines, hand-curated, always loaded | Small enough that loading it always is free |
| Feedback that sticks | The decision log — every entry carries **its reason** | A rule without a reason gets re-litigated |
| What needs doing | `STATUS.md` → "the next concrete action" | One next action, not a backlog |
| Don't rebuild dead ideas | Decision log §3, *Overturned* | Removal is as important as addition |
| Fresh instance per task | Every session in this project | Nothing carries over except what is written down |

So the question is not *"is this the right shape"* — it demonstrably is. The question is
**which parts to formalise into Plane B, and which parts fail if built literally.**

Three of them fail. That is most of what this document is about.

## 2. Three things that break

### 2.1 A single shared scratchpad becomes the problem it was built to solve

An append-only pile that every instance writes to grows without bound. In a month, a fresh
instance either reads all of it — which is "seeing everything all the time", just
relocated — or reads a slice chosen by a relevance search, which means you now own a
retrieval problem *and* a new class of bug: *"why didn't it know that?"*, which is
miserable to debug because the answer is invisible.

**The fix is not a better scratchpad. It is scoping.** Notes attach to the thing they are
about. Working on `claude/kind-meitner-cpis9v` → you get that branch's notes and its goal's
notes. Nothing else. Retrieval is solved by structure, and there is nothing to search.

Some memory genuinely *is* global — *"this user hates hedging in summaries"* is not about
any one branch. That deserves to exist, but it has to stay **small and curated**, which is
the only reason `CLAUDE.md` works. The moment it becomes a dumping ground it stops being
read carefully and starts being skimmed.

### 2.2 "Marked done by the AI" produces a list full of lies

The instance that did the work is the worst possible judge of whether it worked. It will
mark things done because it believes it did them.

**The fix: done is a predicate over the Snapshot, not a boolean the agent flips.**

> *Summarise branch X* is done when X has a summary whose `headSha` matches X's current
> head. That is free to check, checked on every read, and cannot be faked.

If a predicate cannot be written for a task, that task is not an agent task — it is a
**needs you** item. That constraint is a feature: it forces every unit of agent work to
have an observable result. It also falls out of what is already built (D40: cited SHAs are
validated against the branch; D39: insights are keyed on head SHA).

### 2.3 A hand-maintained task list goes stale; a derived one cannot

You have ~100 branches pushed by agents that run for a week. Any durable task list is
wrong within hours — the branch moved, the PR merged, CI went green.

**Derive the queue from the Snapshot every time.** "Branches with no summary at the current
head", "unfiled branches", "goals with no branches", "red CI for more than N days" — all of
these are free predicates over data already in memory, and they cannot go stale because
they are recomputed.

But pure derivation loses the one thing you need most: **"I looked at this and decided
no."** A derived queue will offer you the same dismissed item forever.

So: **derived candidates + a small persistent store of dispositions.** The queue is never
stale; the decisions persist. This is the recommendation and it is better than either half
alone.

### 2.4 One more, about the framing itself

*"Always its first day on the job"* is a good model and I want to sharpen it rather than
argue with it.

A new employee on day one does not get handed the company wiki. They get **a job**, **the
one folder that job needs**, **the house rules**, and **someone to ask**. That maps cleanly
onto what is proposed below.

But a new employee every day never gets better at the job. What makes that arrangement work
in a real organisation is that **the organisation learns, even though the person does not.**
That puts all the weight on curation: if nothing is ever *removed* from the standing orders
and the notes, the organisation gets worse over time, not better. Every standing order
therefore carries **a reason and a date**, and ones that stop earning their place get
struck — exactly how §3 of the decision log already works.

## 3. The pieces, named

Five things. The names are in the project's existing register, and each one has a single
job.

| Piece | What it is | Scope | Who writes it |
|---|---|---|---|
| **Standing orders** | Durable instructions, ~20 lines, always loaded | Global | You, mostly. Agent proposes. |
| **Notes** | One-liners attached to a branch or a goal (R6) | The object | Both |
| **The docket** | Derived work + persisted dispositions | The fleet | Derived + you |
| **Orders** | The packet one instance is handed for one task | One task | Assembled, never written |
| **The run log** | What an instance was shown, did, and cost | One run | The system |

### 3.1 Standing orders

The `CLAUDE.md` of the advisor. Small, always in the prompt, each entry dated and reasoned.

They come from **R7, which has been a requirement since day one and was never built**: a
comment tool next to anything the AI produced, so you can say what was good or bad about it
*and tune prompts later*. This is the "later".

The loop: you mark a summary wrong and say why in one line → that becomes a **candidate**
standing order → you confirm or discard it → confirmed ones go into every summary prompt
from then on.

```
SO-4  Never say a branch is "blocked" unless CI is red or a PR is
      requesting changes. Slow is not blocked.
      — 17 Sep, from feedback on claude/serene-hopper-4kd8xz
```

Why candidates rather than direct writes: one annoyed comment should not silently become a
permanent law. The confirm step is cheap and it is what keeps the list short.

**This is the highest-value piece in the document per line of code**, because it is the one
that compounds: every confirmed order improves every future summary, forever, at the cost
of about 15 tokens.

### 3.2 Notes

R6, already drawn in the interface with nothing behind it. A one-liner on a branch or a
goal, in your words or the agent's, marked as to which.

They double as the agent's scoped memory. When an instance works on a branch it gets that
branch's notes and its goal's notes — which is the whole of "working context" for that job,
and it is bounded by construction.

### 3.3 The docket

What needs doing. Two layers:

- **Derived candidates** — recomputed from the Snapshot every read. Free, never stale.
- **Dispositions** — a tiny store keyed on *(kind, subject, head SHA)*: `done`, `dismissed`,
  `snoozed until`, `needs you`. Keyed on head SHA so that **a dismissal expires when the
  branch moves**, which is correct: you dismissed the old state, not the branch.

Rules for a docket item:
- It names its **subject** (one branch, or one goal — never "the fleet").
- It carries a **`doneWhen`** predicate.
- It carries the **guidelines** for its kind — how this job is done here.
- No predicate ⇒ it is a *needs you* item, and no instance is dispatched for it.

### 3.4 Orders — the packet

The answer to *"avoid the AI seeing everything all the time"*. A deterministic assembly,
budgeted, and **logged verbatim**:

```
1. System prompt          stable, cacheable, never varies
2. Standing orders        ~20 lines, global
3. The task               one item: kind, subject, doneWhen
4. Guidelines for kind    how this job is done here
5. The subject            ONE branch or goal, in full, from the Snapshot
6. Scoped notes           that object's notes, and its goal's
7. Tool catalogue         grouped by cost (agent-plan §3)
```

What is **not** in it: other branches, other goals, other tasks, the docket, prior runs,
anything from a different repo. If the instance needs more it asks with a tool, and the ask
is logged.

Every packet has a **token budget per task kind, in settings** (rule 7). Over budget, the
subject is trimmed — oldest commits first — and the trim is recorded in the run log.

The log is the point. A bad output is only debuggable if you can see exactly what the
instance was shown, and "the model is being dumb" is almost always "the model was shown the
wrong thing".

### 3.5 The run log

One row per run: task, packet size, tool calls, tokens, wall time, result, and whether
`doneWhen` actually went true afterwards. Rolls up into the one number that matters:

> **How often does an instance claim done when the predicate disagrees?**

That is the honesty metric for the whole system, and it is why the predicate is not
optional.

## 4. Alternatives, weighed

### Memory

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **None** — better inputs only | Nothing to curate, nothing to go stale, zero code | Your feedback evaporates; the same wrong summary recurs forever | Rejected — R7 exists for a reason |
| B | **Object-scoped notes** | Retrieval solved by structure; bounded by construction; is already R6 | Cannot hold anything global | **Take** |
| C | **Global free-form scratchpad** (as proposed) | Maximally flexible; nothing to model up front | Unbounded; retrieval unsolved; becomes the context problem it was built to solve | Take a *curated 20-line* version only |
| D | **Standing orders from feedback** | Compounds; tiny; directly answers R7 | Needs a confirm step, or it fills with noise | **Take** |
| E | **Embeddings over everything** | Scales past anything you will ever have | Makes "why did it say that" nearly undebuggable; ~100 branches does not need it | Rejected — reconsider at 10× the data |

**Recommended: B + D, with a hard-capped C.**

### The work queue

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **Pure derived**, no storage | Never stale; zero maintenance | Cannot remember "no"; will nag forever | Half of the answer |
| B | **Durable task table** (as proposed) | Holds your own tasks; a real history | Stale within hours at your branch velocity; "done" is a claim | Not alone |
| C | **Derived + dispositions** | Never stale *and* remembers decisions | Two concepts instead of one | **Take** |

### Who dispatches

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **You press a button** per item | Total control; no surprise cost | You are the scheduler, which is the job you wanted removed | Start here |
| B | **Auto on read**, capped per run | Genuinely hands-off | Silent spend; a bad standing order does damage at scale | **Where this lands**, after A proves out |
| C | **Batch on a schedule** | Cheapest per item | Answers are always a bit stale | Only if cost bites |

D52 already settled that the agent writes on its own, everything visible and reversible.
That points at **B** — but A first, because you cannot tune a loop you have not watched.

## 5. What I would build, in order

Each stage is useful on its own and none of the first three need tool calling — which
matters, because the probe still has not run.

| | Stage | What lands | Rough size |
|---|---|---|---|
| **A** | **Standing orders from feedback** (R7) | ✎ on any summary → one line of feedback → candidate → confirm → in every prompt after | ~200 lines + store + tests |
| **B** | **Notes** (R6) | The note box that is already drawn gets a store; agent reads them in its packet | ~150 lines |
| **C** | **The docket** | Derived candidates + dispositions; a pane in the right-hand column | ~350 lines |
| **D** | **Orders + runs** | Packet assembly, budgets, run log, one instance per task | ~500 lines, needs the probe |

**Start with A.** It is the smallest thing that delivers exactly what you named — *"feedback
I give it on what it writes in summaries"* — it works with the single-turn advisor that
already exists (D60), and it is the only piece that compounds.

## 6. What I would not build

- **A free-form scratchpad every instance appends to.** Named plainly because it is the most
  natural thing to reach for and it is the one that rots. Everything it would hold belongs
  either on an object (notes) or in the standing orders.
- **Agent-set `done` with no predicate.** See §2.2.
- **Cross-task memory between instances.** If two tasks need to share something, that
  something is a note on an object, not a whisper between runs.
- **A second data structure for agent state.** The docket is derived from the Snapshot;
  dispositions and notes join it at the edge, the way goals already do (D58). Rule 4 holds.
- **Embeddings.** Not at this scale, and not at the cost of debuggability.

## 7. The scale check, honestly

This is a single-user dashboard over ~100 branches, a few dozen of which matter. There is a
real risk of building an agent-operations platform for a personal tool, and I would rather
say so now than half way through stage D.

The load-bearing question: **how many agent tasks a week is this actually handling?** If the
answer is "ten", stages A and B are the whole product and C and D are ceremony. If it is
"two hundred", all four earn their place.

Stages A and B are worth building either way — they are requirements R6 and R7, they are
small, and they are useful with no agent at all. **C and D should wait for evidence that the
volume is real.** That evidence is cheap to get: stage C's derived candidates can be
*counted* without any of it being actionable, just to see how long the list actually is.

## 8. Open questions

**Q56 — How much feedback do you want to give?** One click (✓ / ✗) is frictionless and
low-signal. One click plus a sentence is what makes a standing order writable. A full form
will not get used twice. I assume **click + one optional line**, with the line being what
promotes it to a candidate order.

**Q57 — Do standing orders need confirming, or should feedback apply immediately?** I have
assumed confirm, to keep the list short and deliberate. Immediate is less friction and
risks a bad rule quietly degrading every summary.

**Q58 — Is the docket a surface, or just a filter on the register?** The register already
groups by goal. "Needs a decision" could be one more grouping in that same dropdown rather
than a new pane — which would be cheaper and more consistent, but gives the agent's work
nowhere of its own to live.

**Q59 — What is a task allowed to cost?** This sets the packet budget, the tool-call cap and
the model tier. Still the unanswered Q54 from the agent plan, and now blocking two things
instead of one.

**Q60 — Should an instance ever be told about a *second* branch?** Filing a branch under a
goal (J3) arguably needs to see the sibling branches to judge the fit. That is the first
real crack in strict one-subject scoping, and worth deciding deliberately rather than
discovering.

---

## What this does not change

The two-plane rule is untouched: every store here is Plane B, and no tool in this document
writes to a git repo. The agent's most destructive possible act remains mislabelling a goal.
