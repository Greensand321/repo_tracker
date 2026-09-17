# The assistant — memory, judgement and work

**Drafted:** 17 Sep 2026 · **Revised:** 17 Sep 2026 · **Status:** **stage A built** (D61–D65).
Stages B–D not agreed. Open questions at the end.

Follows [`agent-plan.md`](agent-plan.md), which covered *what the agent does* and *what
tools it holds*. This covers what it knows, what it decides, and how it keeps track.

---

## 1. What the assistant is for

In the owner's words:

> *"Think of it as my personal assistant. It tells me what goals are done, what goals still
> need to be done and what work is going on. It knows the context about what I want and what
> I'm doing far better than me. I just have these big ideas and various things that need to
> be accomplished — my assistant simply helps me orchestrate better."*

**The assistant is not a feature of Bearing. It is the point of it.** `requirements.md` R4
already says so — *"the LLM is not optional garnish, it is the engine of the organizing
layer"* — and everything below is downstream of taking that literally.

The division of labour, from R2 and R4, is settled and worth restating because the whole
design hangs off it:

| You | The assistant |
|---|---|
| Have the ideas | Keeps track of them |
| Author milestones and goals by hand | Files branches into them, judges their progress, rolls it up |
| Decide what matters | Tells you what changed and what is waiting on you |

## 2. The three questions

Everything the assistant does serves one of three standing questions. They are not features
to be requested; they are what it answers continuously, without being asked.

| Question | What answering it takes | Status today |
|---|---|---|
| **What goals are done?** | Roll branch state up to goal state, with evidence (R4) | `Goal.done` is a hand-set boolean. Nothing judges it. |
| **What still needs doing?** | Work derived from the fleet, split into yours and its | Nothing. |
| **What work is going on?** | Plain-English branch state, and what moved since you looked | Half built: summaries exist, the now band exists, `what_changed` does not. |

## 3. "Knows my context better than me" — what that actually requires

> **Superseded and corrected.** An earlier draft of this section claimed a model *cannot*
> infer what a goal is for, "at any model quality". That was overstated. A model reading a
> handful of PRs and commits can work out what software is being built and what a branch is
> doing to it — Bearing already does exactly that, every time it summarises a branch.

The narrower claim is the true one:

> **Inference gives you the *is*. Only you supply the *ought*.**

The assistant can tell you, accurately, that a branch spent three days benchmarking mmap. It
cannot tell you whether that was a worthwhile detour or three wasted days, because
"worthwhile" is a function of what you were trying to do.

So it reads the work and describes it — and the one thing it cannot read, and therefore the
one thing worth asking for, is **what you meant the branch to be for**. Said once, it turns
every later assessment from a guess into a comparison.

That mechanism is **vision**, and it has its own walkthrough:
**[`vision-ux.md`](vision-ux.md)**. In short: one falsifiable sentence per branch, in your
words or drafted and confirmed, against which the work is measured. It is what makes
*drifted*, *done against its vision* and *overtaken by another branch* computable at all.

Three consequences shape everything below:

1. **The assistant asks, rather than invents.** A drafted vision is marked as a draft and is
   never the basis for calling something done. Silently treating its own guess as your intent
   is how reasoning becomes invisible.
2. **Asked once, written down, never asked again.** This is the honest version of "knows
   better than me": not that it is smarter, but that it never forgets and you do.
3. **Not knowing is stated.** When many things are moving and there is no clear thread, it
   asks about the *shape* rather than inventing one — see `vision-ux.md` §5.

## 4. Three things that break if built literally

### 4.1 A single shared scratchpad becomes the problem it was built to solve

An append-only pile that every instance writes to grows without bound. In a month a fresh
instance either reads all of it — which is "seeing everything at once", just relocated — or
reads a slice chosen by relevance search, which means owning a retrieval problem *and* a
miserable new bug class: *"why didn't it know that?"*, miserable because the answer is
invisible.

**The fix is not a better scratchpad. It is scoping.** Notes attach to the thing they are
about. Working on a branch → that branch's notes and its goal's notes. Retrieval is solved
by structure and there is nothing to search.

Some memory genuinely *is* global — *"I hate hedging in summaries"* is about no particular
branch. That deserves to exist but must stay **small and curated**, which is the only reason
`CLAUDE.md` works on fresh instances of me.

### 4.2 "The AI marks it done" — true for work, false for judgement

These are two different things and conflating them is how a status board fills with lies.

**Mechanical work** — summarise this branch, file it under that goal — has an observable
result. Done is a **predicate over the Snapshot**, not a boolean the agent flips:

> *Summarise branch X* is done when X carries a summary whose `headSha` matches X's current
> head. Free to check, checked on every read, impossible to fake.

**Judgement** — is this goal done? — has no predicate. You cannot write one, and pretending
otherwise would be dishonest about what the system knows.

So judgement is **proposed, evidenced and provisional**:

```
"Ship the ledger interface" — looks done
   2 of 2 branches merged · nothing open · last movement 6 days ago
   [ accept ]  [ not yet, because… ]
```

It sits in the brief until you accept it, or until it becomes undeniable — every branch
merged, nothing open, your own note saying what done meant now satisfied. **The assistant
never silently flips a goal to done.** A wrong "done" is the single most damaging thing it
can produce, because it is the one you will not go back and check.

### 4.3 A hand-maintained task list goes stale; a derived one cannot

~100 branches pushed by agents that run for a week. Any durable task list is wrong within
hours — the branch moved, the PR merged, CI went green.

**Derive the work from the Snapshot every read.** It cannot go stale because it is
recomputed. But pure derivation loses the one thing you most need: *"I looked at this and
decided no."* A derived list will offer you the same dismissed item forever.

So: **derived work + a small persistent store of dispositions**, keyed on *(kind, subject,
head SHA)* so that a dismissal expires when the branch moves — which is right, because you
dismissed the old state, not the branch.

## 5. The pieces

Seven, named in the project's existing register. Each has one job.

| Piece | What it is | Who writes it |
|---|---|---|
| **The brief** | The standing answer to the three questions, regenerated on read | The assistant |
| **Judgements** | Goal and milestone progress, with evidence, provisional until accepted | The assistant proposes, you accept |
| **The docket** | Derived work, in two columns: its work and yours | Derived + your dispositions |
| **Vision** | What a branch is *for*, in one falsifiable sentence — the yardstick | You, or drafted and confirmed |
| **Notes** | Everything else worth remembering about a thing (R6) | Both, marked as to which |
| **Standing orders** | How you want things done. ~20 lines, always loaded, dated and reasoned | You confirm; the assistant proposes |
| **Orders + run log** | The packet one instance is handed, and the record of what it did | Assembled; never hand-written |

### 5.1 The brief

Not a query — a standing answer, regenerated whenever the fleet moves, sitting at the top of
the leader column where "happening now" is today.

```
Three goals in play. "Ship the ledger interface" looks done — both branches
merged, nothing open since Friday. "Make the advisor trustworthy" is the one
in your way: CI red two days on the provider test. "Two machines, one set of
notes" has not moved in nine days and I do not know what would finish it.

Since you last looked: 6 commits on 2 branches, 1 PR merged, 1 CI failure.
```

Three questions, answered in that order, in plain English (rule 3). The "since you last
looked" line is J2 from the agent plan, and the dated snapshots written since Stage 1 (D31)
are exactly the data it needs — this is the feature they were written for.

### 5.2 Judgements

Per goal: `done` · `progressing` · `at risk` · `stalled` · `needs you`, each with the
evidence it was drawn from — which branches, which SHAs — validated against the Snapshot the
same way summary evidence already is (D40).

A judgement is **cached on the composite key of its branches' head SHAs, plus the prompt
version and model** — the same trick as D39. A goal whose branches have not moved is never
re-judged, which is what makes running this continuously nearly free (§8).

### 5.3 The docket

Two columns, one derivation.

**Its work** — has a `doneWhen` predicate, so the assistant can do it and the result is
checkable: unsummarised branches, unfiled branches, goals whose judgement is stale.

**Your work** — has no predicate, because it needs a decision only you can make. In practice
most of it is **vision questions**, which is a better answer than open-ended asks for
context: *"I think this branch is for X — right?"*; *"this has drifted from what you said —
new plan, or wandered?"*; *"three branches moved and I see no common thread — one push or
three things?"*. Each is concrete and answerable in a click.

The second column is not a lesser thing. **It is the assistant doing its actual job:**
noticing what is waiting on you, which is the part you cannot do for yourself because it
requires holding all of it at once.

### 5.4 Vision, notes, and 5.5 standing orders

**Vision** is what a branch is *for* — the yardstick, one falsifiable sentence, fully
described in [`vision-ux.md`](vision-ux.md). It is not a note and should not be stored as
one: a note is remembered, a vision is **compared against**. Every branch assessment is
vision versus reality, and the verdicts that matter most — *drifted*, *overtaken* — exist
only because there is a stated intent to contradict.

**Notes** (R6) are everything else worth remembering about a thing: an observation, a
reminder, a piece of context that is not a yardstick. They are also the agent's scoped
memory — an instance working on a branch gets that branch's vision, its notes and its goal's,
which is the whole of its working context and is bounded by construction.

**Standing orders** are how you want things done — the `CLAUDE.md` of the assistant. They
come from **R7, a requirement since day one and never built**: a comment tool next to
anything the AI produced, so you can say what was good or bad *and tune prompts later*. This
is the "later".

```
SO-4  Never call a branch "blocked" unless CI is red or a PR requests changes.
      Slow is not blocked.
      — 17 Sep, from feedback on claude/serene-hopper-4kd8xz
```

Marking one output wrong and saying why in a line makes a **candidate** order; you confirm or
discard it. The confirm step exists because one annoyed comment should not quietly become
permanent law — and because the list only keeps working while it stays short.

**Curation is the whole ballgame.** A new instance every time never gets better at the job;
what makes that work in a real organisation is that *the organisation* learns. If nothing is
ever removed from the orders and notes, it gets worse over time, not better. So every order
carries a reason and a date and gets struck when it stops earning its place — exactly how §3
of the decision log already works.

### 5.6 Orders — the packet

The answer to *"don't let it see everything all the time"*. Assembled deterministically,
budgeted, and **logged verbatim**:

```
1. System prompt          stable, cacheable, never varies
2. Standing orders        ~20 lines, global
3. The task               one item: kind, subject, doneWhen
4. Guidelines for kind    how this job is done here
5. The subject            ONE branch or goal, in full
6. Scoped notes           that object's notes, and its goal's
7. Tool catalogue         grouped by cost (agent-plan §3)
```

Not in it: other branches, other goals, the docket, prior runs, anything from another repo.
If an instance needs more it asks with a tool, and the ask is logged.

The log is the point: a bad output is only debuggable if you can see exactly what the
instance was shown, and *"the model is being dumb"* is almost always *"the model was shown
the wrong thing"*.

Budgets live in settings, per task kind (rule 7). Over budget, the subject is trimmed —
oldest commits first — and the trim is recorded.

## 6. Alternatives, weighed

### Memory

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **None** — better inputs only | Nothing to curate or go stale | Your feedback evaporates; it can never know what a goal is *for* | Rejected — kills §3 |
| B | **Object-scoped notes** | Retrieval solved by structure; bounded; already R6 | Holds nothing global | **Take** |
| C | **Global free-form scratchpad** | Maximally flexible; nothing to model up front | Unbounded; becomes the context problem it was built to solve | Take only as a curated ~20 lines |
| D | **Standing orders from feedback** | Compounds — ~15 tokens improves every future output; is R7 | Needs a confirm step or it fills with noise | **Take** |
| E | **Embeddings over everything** | Scales past anything you will have | Makes "why did it say that" undebuggable; not needed at this size | Rejected; revisit at 10× |

**Recommended: B + D, with a hard-capped C.**

### Work

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **Pure derived**, no storage | Never stale; no maintenance | Cannot remember "no"; nags forever | Half the answer |
| B | **Durable task table** | Holds your own items; real history | Stale within hours at your velocity | Not alone |
| C | **Derived + dispositions** | Never stale *and* remembers decisions | Two concepts rather than one | **Take** |

### How judgement reaches you

| | Approach | For | Against | Verdict |
|---|---|---|---|---|
| A | **Assistant decides silently** | Zero friction | A wrong "done" is the one thing you will never catch | Rejected |
| B | **Proposes; you accept** | You stay the authority; it still does the work | One click per goal, occasionally | **Take** |
| C | **Proposes, auto-accepts when overwhelming** | Removes the clicks that were never in doubt | Needs a definition of "overwhelming" | **Take, narrowly** — every branch merged and nothing open |

## 7. Build order

Each stage is useful alone, and the first three need no tool calling at all — which matters,
because the probe has still not run.

| | Stage | What lands | Needs |
|---|---|---|---|
| **A** ✅ | **Vision, assessment, brief** | Branch visions (drafted, confirmed, edited); vision-vs-reality assessment; goal judgement built on it; the brief | Nothing new — same single-turn shape as the advisor today (D60) |
| **B** | **The docket** | Derived work in two columns, dispositions, "what's waiting on you" | Stage A |
| **C** | **Learning** | Feedback → standing orders (R7); the assistant asking when it lacks context | Stage B |
| **D** | **Many hands** | Packets, one instance per task, run log | The probe |

**A is first** because it is the thing the assistant is *for*, and everything else needs it:
no point in a feedback loop before there are judgements worth correcting, and no point in a
docket before something can judge what belongs on it.

**Within A, vision comes before judgement.** A goal called done on the strength of branches
whose purpose was never stated is exactly the guesswork §3 warns about — the assistant would
be marking its own inference as your intent. Vision first, assessment second, roll-up third.

## 8. What it costs to run continuously

Not *whether* to run it continuously — that is settled by §1 — but what it costs, because a
cost you cannot see is a cost you cannot control (agent-plan §6).

**Judgement is cached on the same principle as summaries (D39).** The key is the sorted head
SHAs of a goal's branches, plus prompt version and model. A goal whose branches have not
moved is never re-judged. In practice, with a dozen goals of which two or three move on a
given day, that is **a handful of model calls a day, not per read** — the same economics that
already make ~100 branch summaries affordable.

**The brief** is one call, on the same cache key composed across goals, so an unchanged fleet
regenerates nothing.

**The docket** is free. It is a derivation over data already in memory, with no model in the
loop except for the items it dispatches.

Every judgement and brief carries its cost on screen, and the settings cap what a read may
spend — the same discipline `llmMaxPerRun` already applies to summaries.

## 9. What I would not build

- **A free-form scratchpad every instance appends to.** Named plainly because it is the most
  natural thing to reach for and the one that rots. What it would hold belongs either on an
  object (notes) or in the standing orders.
- **Silent goal completion.** §4.2.
- **Agent-set `done` with no predicate, for mechanical work.** Same section.
- **Cross-task memory between instances.** If two tasks need to share something, that
  something is a note on an object, not a whisper between runs.
- **A second data structure for agent state.** Judgements, dispositions and notes join the
  Snapshot at the edge, the way goals already do (D58). Rule 4 holds.
- **Embeddings.** Not at this size, and not at the cost of debuggability.

## 10. Open questions

**Q56 — How much feedback do you want to give?** One click (✓ / ✗) is frictionless and
low-signal; a click plus a sentence is what makes a standing order writable; a form will not
get used twice. Assumed: **click plus one optional line**, the line being what promotes it to
a candidate order.

**Q57 — Should standing orders need confirming?** Assumed yes, to keep the list short and
deliberate. Immediate application is less friction and risks a bad rule quietly degrading
everything.

**Q58 — Where does the docket live?** The register already groups by goal; "waiting on you"
could be one more grouping in that same dropdown, which is cheaper and more consistent — or
it could be a pane of its own, which gives the assistant's work somewhere to live. Leaning
toward its own pane in the right-hand column, under the register.

**Q59 — What may a read spend?** Sets the packet budget, the tool-call cap and the model
tier. Still the unanswered Q54 from the agent plan, and now blocking three things.

**Q60 — May an instance see a second branch?** Filing a branch under a goal (J3) arguably
needs the siblings to judge the fit. The first real crack in strict one-subject scoping, and
worth deciding deliberately rather than discovering.

**Q61 — Milestones now or later?** The brief answers "what goals are done". "What milestones
are done" is the same machinery one level up, and R2 already defines the level. Building both
at once is cheaper than retrofitting; building only goals gets something usable sooner.

**Q62 — How forward should it be?** *"Two branches both fit this goal, one is 11 behind —
cut it?"* is the assistant being genuinely useful. It is also the assistant having an opinion
about your work. Somewhere there is a line, and it is yours to draw rather than mine to
assume.

---

## What this does not change

The two-plane rule is untouched. Every store here is Plane B, no tool in this document writes
to a git repo, and the assistant's most destructive possible act remains mislabelling a goal
— which is why §4.2 makes it ask before doing so.
