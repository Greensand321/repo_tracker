# The workroom — the board, the workers, and a floor you can watch

**Drafted:** 17 Sep 2026 · **Status:** plan, for review · Supersedes nothing; extends
[`agent-memory-plan.md`](agent-memory-plan.md) §7 stage D and settles
[`../design/agent-shapes.html`](../design/agent-shapes.html) ② ③ ④.

---

## What this is for

**So the assistant shows you what you need to see, instead of what a fixed prompt happened
to ask for.**

Two mechanisms, doing two different jobs:

- **Tools per station** raise the *quality* of every answer. A station that can read the
  README, the files a commit touched, and what the branch looked like last week is
  answering from evidence. Today it is inferring from commit subjects. The verdicts that
  matter most — *drifted*, *overtaken* — are exactly the ones that need evidence, because
  they are claims about intent.
- **The board** raises the *throughput and the honesty*. Work is derived, claimed, and
  checked. Nothing is serialised behind the slowest thing, nothing finishes silently
  because a model said it did, and nothing vanishes when it fails.

One limit worth stating plainly, because it is the difference between this working and
this being another dashboard: **tools change what a station can see; they do not change
what it does with what it sees.** That second half is standing orders (R7,
[`agent-memory-plan.md`](agent-memory-plan.md) §5.5) — you mark an output wrong, say why in
a line, and it becomes a rule every future station reads. Tools plus orders is what "more
of what I want" actually means. Tools alone is a better guess.

## What you settled

| | Question | Your answer | What it means here |
|---|---|---|---|
| **Q68** | How many workers? | Configurable, **default 2**. Dispatched work must never queue behind background work — spin up another. | Two lanes, not one pool. §2 |
| **Q69** | Should you see the board? | **Yes** — how many are active, what they are doing. | The floor is a product surface. §5 |
| **Q70** | Cancel mid-flight? | You never would. But the program closing or the machine shutting down must not lose work — keep a log, reboot anything that never reported done. | Crash recovery, not cancellation. §6 |
| **Q71** | Tell you when work finishes? | **Yes for work you dispatched. No for routine background work.** | §7 |

Also settled, from the same message: the **foreman (④) is skipped** — it does the same job
as the board with an invisible reason attached. And the **desk (⑤) is wanted**, after this:
*"I could tell the advisor to reorganize the register into groups, or rank branches by
importance on criteria I give it."* That is the feature this plan exists to make possible,
and §8 puts it last for a reason — it needs somewhere to dispatch into.

---

## 1. The board

**Work is derived every read, never queued.** The board is a pure function of the snapshot
plus what is already on disk:

```
summarise      · 3 branches   no insight at this head SHA
draft vision   · 2 branches   active, has commits, nobody has said what it is for
assess         · 5 branches   has a vision, no assessment at this head + this text
the brief      · 1            the fleet moved since the last one
parked         · 2            failed twice — waiting on you
```

That is not a new idea bolted on: `assist()` already computes exactly this on every pass.
It is consumed by a `for` loop instead of by workers. **Swapping the loop for a dispatcher
is most of the change.**

A job:

```ts
type Job = {
  id: string;          // derived and stable: `${kind}:${repoKey}:${branch}:${headSha}`
  kind: JobKind;       // 'summarise' | 'draft-vision' | 'assess' | 'brief' | …
  subject: Subject;    // one branch, one goal, or the fleet
  title: string;       // plain English, because this is going on screen (rule 3)
  origin: 'routine' | 'dispatched';
  doneWhen: (snapshot: Snapshot) => boolean;   // §3
};
```

**The id is derived, not minted.** The same job derived on the next read is the same job,
so a read that lands while a worker is mid-flight finds it already claimed instead of
starting a second one. No queue to deduplicate, because there is no queue.

### The consequence that makes crash recovery free

Routine work needs no persistence at all. A summarise that died halfway leaves no summary
on disk, so the next read derives it again and a worker picks it up. **Nothing to restore,
nothing to reconcile, nothing to leak.**

Dispatched work is the opposite and needs the log you asked for — see §6.

### The bug this design found before a line was written

`draft-vision` is derived as *"active, has commits, `vision === null`"*. When the model
correctly **declines** to draft one — which it is instructed to do rather than write
something unfalsifiable — nothing is recorded. So `vision` stays null, the job is derived
again on the very next read, and it is paid for again. Every minute. Forever, for every
branch it ever declined.

The rule that catches it: **a job whose predicate can never become true is a job that runs
forever.** A decline has to be written down — keyed on the head SHA, so the branch moving
is what makes it ask again. That is a real recurring cost fixed in step 1.

---

## 2. The workers

Fresh instance per job, no memory of any other job, a packet assembled deterministically
([`agent-memory-plan.md`](agent-memory-plan.md) §5.6).

**Two lanes, because you asked for the thing one pool cannot do.**

| Lane | Default | Who fills it | Rule |
|---|---|---|---|
| **Routine** | `workers: 2` | The board | Capped. Slow is fine — the fleet moves every few minutes and this has all night. |
| **Dispatched** | `dispatchWorkers: 2` | You, or the advisor on your behalf | Starts immediately, in addition to the routine lane. Never waits behind background work. |

Your reasoning stands on its own and is worth keeping in the file: the only real burst is
the first import; after that branches move every few minutes, which is plenty of time, and
a machine left running overnight finishes everything regardless. So the number is small on
purpose, and the cap exists because **more workers make a runaway bill arrive faster, not
later.** Both numbers are settings (rule 7).

The dispatched lane is capped too. "Spin up another rather than block" is right; "spin up
another every time" is how you wake up to forty concurrent calls.

---

## 3. How it knows a job is done

Three conditions, all three needed, in this order:

1. **The worker says so.** It stops asking for tools. Can stop too early, and can not stop.
2. **The predicate agrees.** `doneWhen(snapshot)` — the summary really does exist at this
   head SHA. Free to check, reads the same store the cache already reads, **cannot be
   faked.**
3. **The budget runs out.** N tool calls, N tokens, N seconds. The backstop that always
   holds.

What makes this work here and not in most agent systems: **almost every job Bearing has
carries a real predicate.** The exception is judgement — *is this goal done?* — which has
none, which is exactly why it stays a proposal you accept (D64).

**Log the disagreement.** Every time a worker claims done and the predicate says otherwise,
count it. If that number climbs, the tools are wrong or the job is too big, and there is no
other way you would ever notice.

Failure: retry once, then **park** the job as something waiting on you, with what it
tried and what it got. Parked work is visible work. Today a failed assist appends a string
to an error array and is replaced by the next read (which is how the 400 went unseen for a
day — D67).

---

## 4. Tools per station

The linchpin. Each station gets the smallest set that changes its answer, and no more.

| Station | Tools | What stops being a guess |
|---|---|---|
| **summarise** | `commit_files` | "What is this branch doing" from *which files changed*, not from commit subjects an agent wrote about itself. |
| **draft vision** | `repo_readme`, `commit_files`, `sibling_branches` | A vision grounded in what the software *is*. This is the single cheapest quality win here — one GitHub call per repo, cached forever. |
| **assess** | `commit_files`, `what_changed`, `sibling_branches` | *Drifted* stops being a hunch. And `what_changed` finally reads the dated history that has been accumulating since Stage 1 and that **nothing has ever read** (D31). |
| **the brief** | `what_changed`, `sibling_branches`, `pr_reviews` | "Blocked" currently means red CI. A reviewer asking for changes is just as blocking and is invisible today. |
| **the desk** (§8 step 6) | every read tool, plus `dispatch` | Your idea: reorganise the register, rank by your criteria. It queues; it does not do. |

### The contract

```ts
type Tool = {
  name: string;
  description: string;      // says what it costs — models respect that if you tell them
  cost: 'free' | 'disk' | 'github';
  run(args, ctx): Promise<unknown>;
};
```

Free tools read the snapshot already in memory. Disk tools read the history. Only three
touch GitHub, and all three are cached. **No tool writes to a git repo, and none ever
will** (rule 1). The most destructive act available to any worker remains mislabelling a
goal.

### Two mechanisms, one catalogue

Native tool calling where the model supports it; a plain JSON protocol — `{"tool": "...",
"args": {…}}` or a final answer, and we loop — where it does not. Same catalogue, same
tests, same code path either way. `npm run probe` decides **which**, not **whether**.

You are right that this is not exotic for a modern model, and the caution in `ai-map.html`
is over-calibrated to one real burn (`response_format` failing whole requests on some Zen
models). The floor exists because the provider is swappable by design, not because the
models are suspect.

### The cache rule, which is easy to miss

**A station's tool list is part of its prompt version.** Adding a tool changes what the
station sees and therefore what it writes, so it must invalidate the cache exactly as
editing the prompt text does. Otherwise you get a silent mix of answers drawn from
different evidence and no way to tell which is which — the same trap `PROMPT_VERSION`
already exists to close (D39).

---

## 5. The floor — seeing the room work

You asked to see how many workers are active and what they are doing. Two places, because
they answer two different questions.

**In the dateline** — the one line always in view, beside the failure count added in D67:

```
17 Sep 2026 · 41 branches · 12 goals · 2 at work · 1 waiting on you
```

**The floor panel**, in the standing column under the advisor, in the Broadsheet's own
language — rows on a rule, a glyph gutter, mono for facts, teal used once:

```
THE FLOOR                                        2 at work

 ◆  Reading what claude/kind-meitner is doing          0:04
    summarise · 2 tools · dispatched by you
 ◆  Working out what claude/plum-fermi is for          0:11
    draft vision · 1 tool
 ·  5 waiting                                    assess · 4
 ⚑  Could not assess claude/bold-wu — 400            parked
```

Rules it follows:

- **Plain English first** (rule 3). "Reading what X is doing", not `summarise(repo, branch)`.
  The job kind is the small grey supporting metadata, not the headline.
- **Dispatched work is marked as yours.** That is the difference between "it is busy" and
  "it is busy with the thing I asked for".
- **Empty is a real state and says so** — "nothing to do" is the correct and most common
  reading, and an empty panel that looks broken is worse than no panel.
- **Parked jobs are questions.** They join the existing *Waiting on you* panel rather than
  starting a second list of problems.

The whole panel is derived from the board (rule 4: one structure, every surface renders it).

---

## 6. When the program closes

Your case exactly: you would never cancel a job mid-flight, but you do close the program
and shut the machine down.

| | What happens |
|---|---|
| **Routine work** | Nothing needed. It was derived from state; the state has not changed; the next read derives it again. |
| **Dispatched work** | Written to `data/dispatched.json` the moment it is accepted, cleared when the predicate passes. On start, anything still there goes back on the board. |

Dispatched work is the only kind that needs this, because nothing in the fleet implies it —
it exists only because you asked. A log of routine work would be a second source of truth
for something already derivable, which is how two sources of truth start disagreeing.

**Rebooted twice and still not done → parked**, not rebooted a third time. Otherwise one
poison job re-runs on every startup for the rest of the program's life.

The run log (`data/runs.jsonl`, append-only) is separate and is for *you*: what ran, how
long it took, what it cost, whether the predicate agreed. It is also the only way the
disagreement counter in §3 exists.

## 7. Being told

**Work you dispatched:** you are told when it lands. It appears where you asked for it
(the answer in the advisor panel, the branch's row, the register) *and* the dateline says
so briefly, because the whole point of dispatching is that you stopped watching.

**Routine work:** it simply appears. A notification for every summary would be forty
notifications on the first run and a reason to stop reading them.

One-way, as in shape ⑤: the advisor can tell you something finished. It does not start a
conversation about it. That door stays closed until you ask to open it.

---

## 8. Build order

Each step is useful alone and leaves the program working.

| | Step | What lands | Needs |
|---|---|---|---|
| **1** ✅ | **The board and the dispatcher** | Jobs derived with stable ids and predicates; the two loops in `enrich`/`assist` become one dispatcher; done is *checked*; failures park; the declined-vision cost bug fixed | Nothing |
| **2** ✅ | **The floor** | Jobs on the Snapshot; the count in the dateline; the floor panel; parked work joins *Waiting on you* | 1 |
| **3** ✅ | **The tool layer** | `Tool` contract, the JSON-protocol loop, the free tools (`sibling_branches`, `what_changed`), a per-job lookup budget, the disagreement counter — and `assess` wired to use them | 1 |
| **4** | **Tools at the stations** | `repo_readme` + `commit_files` (new GitHub collection, cached); wired into draft-vision first, then assess, then summarise; tool list folded into each prompt version | 3, and `npm run probe` to pick native vs protocol |
| **5** | **Dispatch** | `dispatch()` as an internal call, the dispatched lane, `data/dispatched.json`, reboot-on-start, "you asked for this" in the floor, the finished notice | 1, 2 |
| **6** | **The desk** | The advisor may dispatch: reorganise the register, rank by your criteria, go and check something and come back with it on the page | 3, 4, 5 |

Steps 1 and 2 need no tool calling and no probe, and they are what makes everything after
them safe to let loose: **tools without a predicate is just a longer guess.**

## 9. What it costs

The board changes the *shape* of the work, not the volume. Everything stays cached on the
same keys (D39), so an unmoved fleet still spends nothing.

Three things do change:

- **Tools add calls within a job** — an assessment that was one call becomes one call plus a
  lookup or two and a second turn.
- **The declined-vision fix removes a recurring cost** that has been running on every read.
  Probably a net saving on day one.
- **`repo_readme` and `commit_files` are new GitHub calls**, both cached: the README once
  per repo forever, the file list once per SHA.

**`llmMaxPerRun` now counts provider calls rather than jobs** (D75), because with lookups
the two stopped being the same number and only one of them is what a bill is made of. A
job is claimed only when the read can pay for it in full, so a small budget finishes half
the work rather than starting all of it and finishing none.

Measured on a four-branch fleet with a stub provider: **cold read** 15 calls (4 summaries,
4 drafts, 3 assessments at 2 calls each, 1 brief); **unchanged fleet** 0; **one branch
moved** 4. The economics of D39 survive tools intact.

## 10. What I would not build

- **The foreman.** The board's ordering is a sort, and a sort is code. Revisit if the board
  is ever genuinely long and mixed.
- **A queue.** The board is derived; a queue would be a second, stale copy of it.
- **A worker that writes to a git repo.** Rule 1, permanently.
- **Cancellation UI.** You said you would not use it, and "stop" versus "undo" is real
  design work. Closing the program already works, and after §6 it is safe.
- **Cross-worker chat.** If two jobs need to share something, that something is a note on
  an object, not a whisper between runs.
- **A second data structure for job state.** Jobs join the Snapshot at the edge, the way
  goals and visions already do (D58). Rule 4 holds.

## 11. Open questions

**Q72 — Does a dispatched job outrank a routine one for the same subject?** If you ask for
a branch to be re-assessed while a routine assessment of it is in flight, the predicate is
satisfied by the routine one and yours never runs. Assumed: a dispatched job **supersedes**
the routine job for the same subject, because you asked for the fresher answer.

**Q73 — What may one job spend?** ✅ Built as **8 lookups and 60s**, both settings, on top of
the read's own call budget which is the real ceiling (D75). Still worth your eye on the
numbers: 8 is a ceiling rather than an expectation — with two tools available a job makes
one or two.

**Q74 — Does the floor show finished work, or only live work?** A rolling "last five things
done" makes the room feel alive and gives the run log somewhere to be seen. It is also five
more lines you did not ask for. Assumed: **live only**, with the log behind a click later.

**Q75 — Should `repo_readme` read anything else?** A README is the obvious grounding. A
`docs/` index or a `CLAUDE.md` is often better and is one more call. Assumed: README only,
until a vision comes out thin and it is obvious why.
