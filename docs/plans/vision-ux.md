# Vision — what it looks like to use

**Drafted:** 17 Sep 2026 · **Status:** agreed and **built** (17 Sep). Decisions D61–D65.
Routes 1, 2 and 3 are in; route 4 (inherit from the goal) and §8's deferred items are not.

This is a walkthrough, not a spec. It describes what the owner sees and does, moment by
moment. Schema, storage and prompts are deliberately absent — get the experience agreed
first, then build to it.

Feeds into [`agent-memory-plan.md`](agent-memory-plan.md), which needs revising once this
settles. See §9.

---

## 1. Correcting the claim this replaces

The previous plan said a model *cannot* infer what a goal is for, "at any model quality".
That was overstated, and the owner is right to push back: a model reading a handful of PRs
and commits can absolutely work out what software is being built and what a branch is doing
to it. Bearing already proves this — `claude/ecstatic-hopper-bwbbdt` gets summarised as
*"the advisor engine, stuck on one provider gate"* from nothing but its commits.

The narrower claim is the true one, and it is the whole reason vision exists:

> **Inference gives you the *is*. Only the owner supplies the *ought*.**

A model can tell you, accurately, that a branch spent three days benchmarking mmap. It
cannot tell you whether that was a worthwhile detour or three wasted days, because
"worthwhile" is a function of what you were trying to do — and that lives in your head
until you say it.

So the assistant reads the work and describes it. **Vision is the one thing it cannot read,
and therefore the one thing worth asking for.** Once it has been said, once, every
assessment afterwards is a comparison rather than a guess.

## 2. What a vision is

**One or two sentences, per branch, saying what this branch is for.** In the owner's words,
or drafted by the assistant and confirmed.

```
claude/ecstatic-hopper-bwbbdt
   Vision — Get summaries working end to end against OpenCode Go, and make
   every failure mode visible rather than silent.
```

It is not a description of what the branch has done — that is the summary, which already
exists. It is the **yardstick**: the thing the work gets measured against.

**A vision must be falsifiable or it is worthless.** *"Improve the UI"* can never be
contradicted by anything, so it can never detect drift. *"Replace the native select with a
searchable picker"* can. This is a hard constraint on what the assistant is allowed to
draft, and it is a good filter on what the owner writes too.

### The four states, and why they are visible

| State | Means | Shown as |
|---|---|---|
| **Yours** | You wrote or edited it | Plain, no marker |
| **Confirmed** | Assistant drafted, you accepted | Plain, no marker |
| **Proposed** | Assistant drafted, you have not looked | Marked, and hedged in every assessment built on it |
| **None** | Nothing known | Said plainly, never invented |

The distinction between *proposed* and *confirmed* is load-bearing. The assistant may draft
a vision — that is the point of §1 — but if a draft is silently treated as your intent, every
assessment downstream inherits a guess you never saw, and the reasoning becomes invisible.
So a proposed vision is used, and *marked*, and never the basis for declaring something done.

## 3. Where visions come from — four routes

In roughly the order they will get used.

### Route 1 — The assistant proposes, you confirm *(the common path)*

The bubble. It appears on the branch it is about, in the leader column:

```
┌─ claude/ecstatic-hopper-bwbbdt ─────────────────────────┐
│  I think this branch is for:                            │
│                                                         │
│  Getting summaries working end to end against OpenCode  │
│  Go, and making every failure mode visible.             │
│                                                         │
│  from 41 commits, PR #7, and 5 provider fixes in a row  │
│                                                         │
│  [ that's right ]   [ edit ]   [ not quite — ]  [ later ]│
└─────────────────────────────────────────────────────────┘
```

- **On the branch, never a global modal.** You are looking at the thing being asked about.
- **Dismissible, never blocking.** "Later" is always there and costs nothing.
- **It shows its reasoning** — *"from 41 commits, PR #7…"* — so a wrong draft is obviously
  wrong rather than plausibly wrong.
- **"Not quite"** opens a one-line box, pre-filled with the draft so you are correcting
  rather than composing.

### Route 2 — You write it, unprompted

Click any branch → *"what's this for?"* → one line. The same box the bubble opens.

### Route 3 — You dump a paragraph; the assistant distributes it *(the one you asked for)*

You should never have to fill in a form per branch. You talk the way you would to a person:

> *"I'm rebuilding the interface — kind-meitner is the broadsheet itself, lucid-noether was
> the typography research that fed into it, and gui-updates is dead now that the picker got
> rebuilt elsewhere."*

The assistant splits that into three visions and shows you what it is about to attach,
before attaching anything:

```
From what you said, I'd set:

  claude/kind-meitner-cpis9v    Build the broadsheet interface itself.
  claude/lucid-noether-77gqla   Typography research feeding the broadsheet.   ✓ done
  gui-updates                   Superseded — the picker was rebuilt elsewhere. ✓ close

  [ apply all ]    [ apply some… ]    [ no, let me redo that ]
```

Note it did two extra things: recognised that one is finished and one is dead. Both are
proposals, both visible, neither applied until you say so.

**This is the highest-leverage route**, because you already think in paragraphs about
several branches at once, and it is the only route whose cost does not scale with the number
of branches.

### Route 4 — Inherited from the goal

A branch filed under a goal that has its own vision starts with a provisional one derived
from it. Marked *proposed*, like any other draft.

## 4. What the assistant does with it — the assessment

This is the payoff, and none of it is possible without a vision to compare against.

Each branch gets one of:

| Verdict | Means | Example |
|---|---|---|
| **On track** | The work matches the vision | — |
| **Drifted** | Doing something real, but not this | *"Vision says the searchable picker. The last 4 commits are keyboard shortcuts in the settings sheet."* |
| **Done against its vision** | The vision is satisfied | Distinct from *merged*. A branch can be done and unmerged. |
| **Overtaken** | Satisfied somewhere else | *"gui-updates is for the searchable picker. That shipped on kind-meitner six days ago."* |
| **Unclear** | Cannot tell | Said plainly. Usually means the vision is too vague to test. |

**Overtaken is the one that pays for the whole mechanism.** Nothing in git can tell you a
branch has been made pointless by another branch. Only a stated intent, compared across the
fleet, can.

### Drift has two causes, and only you know which

This matters more than anything else in this document. When the assistant reports drift, it
is either:

1. **The branch wandered** — the agent went off and did something else.
2. **You changed your mind** — the work is right, the vision is stale.

The assistant cannot distinguish these, and guessing would be worse than asking. So drift
always offers both:

```
claude/kind-meitner-cpis9v has drifted

  Vision:  Build the broadsheet interface itself.
  Doing:   The last 3 commits are goal storage, an API and tests —
           backend work, not the interface.

  [ that's the new plan — update the vision ]
  [ no, it's wandered — flag it ]
  [ both, actually ]           [ ignore for now ]
```

**"That's the new plan"** is one click and it rewrites the vision to match reality. This is
how a vision stays current without ceremony, and without it the whole mechanism rots within
a month: you would write visions once, the work would legitimately evolve, and everything
would show as drifted forever.

## 5. When the shape itself is unclear — where you come in

The owner named this case exactly: *"maybe there is a point where many things are happening
and there is no clear direction, that is where I come in."*

The assistant should **not** invent a vision to paper over this. It escalates one level, and
asks about the shape rather than the branch:

```
Three branches in repo_tracker moved this week and I can't see a common
thread between them:

  claude/kind-meitner-cpis9v   interface, then goal storage
  claude/ecstatic-hopper-bwbbdt   the advisor engine
  gui-updates                  a dropdown, stalled

Is this one push, or three separate things?

  [ one push — call it… ]   [ three things ]   [ I'll sort it later ]
```

That is the honest version of "I don't know", and answering it once produces either a goal
with a vision or three visions — after which it never has to ask again.

## 6. Where all of this lives on screen

No new pane. Everything below fits the broadsheet that exists today.

**Leader column, on a branch item** — the vision sits under the headline, above the summary,
in the same serif italic that marks human reflection. Proposed visions are marked; missing
ones show a quiet *"what's this for?"* rather than an empty space.

```
IN PROGRESS
The advisor engine, stuck on one provider gate
greensand321/repo_tracker · claude/ecstatic-hopper-bwbbdt · 41 ahead · 5h ago

  For — Summaries working end to end against OpenCode Go, every failure visible.
  Now — CI red two days on the provider test. On track otherwise.
```

**For / Now.** Two lines, the yardstick and the reality, and the comparison is right there
without a word of explanation.

**Right column, under the register** — pending questions, capped. Never more than a few at
once (a setting), ordered by what matters: active branches with no vision first, then drift,
then quiet branches — which mostly never get asked about at all, and should not.

**The brief** gains a line when anything is off: *"Two branches have drifted from what you
said they were for."*

## 7. What could go wrong

Named now, because each one has a design answer and they are cheaper to answer than to
discover.

**Vision rot.** You write it, the work legitimately moves on, everything reads as drifted
forever. → §4's *"that's the new plan"*, plus a vision showing its age when it is old
relative to the branch's activity.

**Yes-clicking.** If the bubble is easy to accept, you will accept everything and the visions
become the assistant's guesses laundered as your intent. → Drafts must be **specific enough
to be obviously wrong**. A vague draft that can never be contradicted is worse than no draft,
so the assistant should decline to draft rather than write *"improve the UI"*.

**Question fatigue.** A hundred branches is a hundred possible questions. → Hard cap on
pending questions, priority order in §6, and quiet branches simply never asked about. An
unasked question is not a failure.

**One branch, two jobs.** Agent sessions run a week and wander — R2 already allows sub-tasks
to diverge. → Drift is **reported, not punished**. The assistant should be comfortable saying
*"did its vision, and also did X"* rather than treating every divergence as a fault.

**A confidently wrong draft.** The assistant reads five provider fixes and concludes the
branch is about providers, when it was about making failures visible and providers were just
where that showed up. → The draft always shows what it was drawn from, so you can see the
reasoning was thin before you accept it.

## 8. What is deliberately *not* here

- **Vision on goals** — probably right, but it is the same mechanism one level up and the
  branch level is where the evidence is. Decide after branch visions are real (Q65).
- **History of visions** — how intent changed over time is interesting and is a Stage 4
  question, not a Stage 2 one. The dated snapshots (D31) will already have captured it.
- **Any schema.** On purpose. This document is for arguing with, not building from.

## 9. How this changes the existing plan

[`agent-memory-plan.md`](agent-memory-plan.md) needs revising in four places:

1. **§3 is wrong** and gets replaced by §1 above — inference gives the *is*, the owner gives
   the *ought*.
2. **Vision becomes a first-class thing**, not a kind of note. Notes stay for everything
   else — observations, reminders, context. A vision is a yardstick and gets compared
   against; a note is not.
3. **Stage A grows** from "goal judgement + brief" to **"vision, assessment, brief"** —
   because a goal judgement built on branches with no stated intent is exactly the guesswork
   §1 says to avoid. Vision comes first; judgement is downstream of it.
4. **The docket's "waiting on you" column** is now mostly vision questions, which is a better
   answer than the one it had: the assistant's questions are concrete and answerable in a
   click, not open-ended asks for context.

## 10. Open questions

**Q63 — Should the assistant draft a vision on its own, or only when asked?** Drafting for
every new branch is the hands-off version and risks yes-clicking. Drafting only on request
is safer and means most branches stay without one. Leaning: **draft automatically, but only
when it can be specific**, and never count a proposed vision as confirmed.

**Q64 — How many pending questions at once?** Assumed a small cap in settings. Three feels
right; ten would feel like a chore list.

**Q65 — Do goals get visions too?** Same mechanism one level up. Probably yes, eventually.
Not in the first build.

**Q66 — When a branch merges, what happens to its vision?** Kept as the record of what it was
for — which is how "overtaken" gets detected for *other* branches later. Never deleted
(rule 10 in spirit).

**Q67 — Can a vision be wrong on purpose?** An experiment's vision might be *"find out
whether mmap is faster"*, where the honest outcome is "no" and the branch is **done, having
proved a negative**. The assessment should understand that succeeding at a question is not
the same as succeeding at a plan. Worth handling deliberately — it is a whole category of
branch.
