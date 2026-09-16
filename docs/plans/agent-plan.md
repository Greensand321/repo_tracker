# Making Bearing agent-native — a plan to argue with

**Drafted:** 16 Sep 2026 · **Status:** draft, not agreed. Open questions at the end.

Today the LLM is a **summariser**: one fixed prompt, context we assemble for it, one reply,
no ability to ask for anything. Agent-native means inverting that — the model decides what
it needs and fetches it, and the answer is the end of a short investigation rather than a
single guess.

This is a design conversation, not a build order. Nothing here is committed.

---

## 1. What the agent is actually *for*

Worth pinning down before any tooling, because the tools fall out of the jobs. Candidates,
in what I think is priority order:

| # | Job | Why it needs an agent rather than a prompt |
|---|---|---|
| J1 | **Answer questions about the fleet** — "what's happening with the parser rewrite?", "which branches touch auth?", "what did I actually ship last week?" | The right context depends on the question. No fixed prompt can pre-load the answer to all of them. |
| J2 | **"What moved since I last looked"** | Needs to compare two points in time, then decide what is worth mentioning. Editorial judgement, not a diff. |
| J3 | **File branches into goals and milestones** (Stage 3, R4) | Needs to read a branch, read the goals, and decide. This is the upkeep you explicitly do not want to do by hand. |
| J4 | **Judge progress and roll it up** to goal and milestone level | Same. |
| J5 | **Spot drift and overlap** — two branches solving the same thing, a branch quietly abandoned, work that conflicts with `main` | Needs to compare branches against each other, which is inherently multi-step. |

**J1 and J2 need nothing that does not already exist.** J3–J5 need the Stage 3 data model.
That is an argument for building the agent *before* the organising layer, not after — a
conversational agent over what we have today is useful on its own, and it is the thing
that makes the organising layer cheap to maintain once it exists.

## 2. The thing that makes this tractable

**The Snapshot is already the agent's world.** One canonical structure, already fetched,
already cached, already covering every branch in every repo. Most tools are *views over
local data* — no network, no latency, no cost. That is unusual and it is worth protecting:
it means an agent turn can make a dozen tool calls and still feel instant.

The rule from CLAUDE.md holds without change: **if a tool needs a fact, the fact goes in
the Snapshot.** Tools must not become a second, divergent way of reading GitHub.

## 3. Tool catalogue

Grouped by what they cost, because that is what the agent should be steered by.

### Free — served from the Snapshot already in memory

| Tool | Returns |
|---|---|
| `list_branches({ repo?, relevance?, needs_attention?, limit })` | Compact rows: repo, branch, age, ahead/behind, CI, PR, generated title, progress. **Not** commit lists. |
| `get_branch({ repo, branch })` | Everything for one branch, including its commits |
| `search({ query })` | Matches across branch names, commit messages, PR titles |
| `list_repos()` | Repos and branch counts |

### Cheap — reads the on-disk history we have been writing since day one (D31)

| Tool | Returns |
|---|---|
| `branch_history({ repo, branch, since })` | How that branch moved over time |
| `what_changed({ since })` | Diff between two dated snapshots across the whole fleet — **this is J2** |

That history file has been accumulating for a day and nothing reads it yet. J2 is the
feature it was written for.

### Costly — a GitHub call, so the agent should be told these are expensive

| Tool | Returns |
|---|---|
| `get_commit({ repo, sha })` | Message, files changed, truncated patch. **We do not fetch patches today** — this is new collection. |
| `pr_reviews({ repo, number })` | Review comments and state |
| `compare({ repo, base, head })` | Overlap between two branches — the basis of J5 |

### Writes — Plane B only, never Plane A

| Tool | Effect |
|---|---|
| `set_note` · `add_tag` · `remove_tag` | Your annotations |
| `create_goal` · `assign_branch_to_goal` | The organising layer (Stage 3) |

**The two-plane rule is not negotiable here.** There is no tool that writes to a git repo,
and there never will be. The agent's most destructive possible act is mislabelling a goal.

## 4. Where the agent runs

**Server-side, with the browser as its surface.** Not in the page.

The program already holds the GitHub token, the provider key, the cache and the history.
Running the agent there means tools are local function calls over data already in memory,
and no secret ever reaches the browser. The page sends a question and renders a stream.

We already have the streaming channel — server-sent events, built in Stage 1 for live
refresh. An agent turn streams over the same pipe: text as it arrives, plus a line per tool
call so you can see it working rather than watching a spinner.

## 5. Context — and why "fresh" is right here

You said you deliberately *avoid* rotating context in your coding sessions, to keep the
cache warm. **The opposite is correct for this agent**, and the difference is worth naming:
a coding session accumulates understanding that stays valid, while Bearing's underlying
data changes every minute. A conversation that remembers a branch's state from twenty
minutes ago is remembering something false.

So: **every turn starts from the current Snapshot.**

- **System prompt** — stable, never varies. This is the cacheable prefix, and it is why
  the `x-opencode-session` header matters: same session, same provider, prefix stays warm.
- **Opening context** — the compact fleet overview from `list_branches`. About 20 tokens a
  branch, so ~2k for a hundred branches. Cheap enough to always include, and it gives the
  agent a map so its first tool call is informed rather than exploratory.
- **Then it drills in** with tools.
- **Conversation history** is kept within a turn, but branch *facts* are re-read rather
  than remembered.

## 6. Efficiency

The failure mode of tool-using agents is looping: twelve calls to answer something that
needed two.

- Hard cap on tool calls per turn (start at 12) and on total tokens.
- **Steer with the catalogue itself** — tool descriptions say what is free and what costs a
  GitHub call. Models respect that if you tell them.
- **Prefer the summary layer.** Every branch already has a generated title and summary.
  Most questions are answerable from those without touching a commit.
- Tool results are memoised within a turn.
- Every turn reports what it cost, in tool calls and tokens, on screen. A cost you cannot
  see is a cost you cannot control.

## 7. The risk that could sink this

**Does OpenCode Go support reliable tool calling?**

Zen fronts a hundred-plus models of wildly varying capability, and Go is a curated
budget subset aimed at coding agents. Some of those models do native function calling
well; some do it badly; some not at all. We already learned this lesson once — we do not
send `response_format: json_object` because models that reject it fail the whole request.

**So do not couple to native function calling.** Define a small JSON protocol — the model
replies with `{"tool": "...", "args": {...}}` or a final answer, and we loop. Use native
tool calling when the model supports it, fall back to the protocol when it does not. Same
tool catalogue either way.

This must be tested against an actual Go model before anything else is built. If tool
calling is unreliable there, the answer is a stronger model for this one job — the volume
is low, a handful of calls per question — not a worse agent.

## 8. What I would build, in order

1. **Verify tool calling works on a Go model.** A day's worth of doubt resolved in an hour.
2. **The tool layer** — the free tools first, as plain functions over the Snapshot, fully
   testable with no model involved. This is engine work and is design-independent, so it
   is the right thing to build while the interface is still unsettled.
3. **The agent loop** — protocol, caps, streaming, cost reporting. Still no UI: drive it
   from the debug CLI.
4. **`what_changed`** (J2), because the data is already on disk and it is the highest
   value per line in the whole plan.
5. **The chat surface** — last, once the design lands, because it is a surface.

Steps 1–4 are all engine. Only step 5 waits on the design files.

---

## Open questions

**Q50 — "Natively within the browser": what do you mean?** My reading is that the work
happens in the app rather than a terminal, with the agent running server-side and the
browser as its surface. The alternatives — the agent running *in* the page, or the agent
driving a real browser to click things — are very different products.

**Q51 — Which jobs matter most?** J1–J5 above, ranked. I have guessed at the order.

**Q52 — Should the agent write on its own, or propose?** Filing a hundred branches into
goals is only a saving if you are not confirming each one. But an agent quietly
mislabelling things is worse than no labels. My instinct: it writes freely, every write is
visible and reversible, and there is a log of what it did.

**Q53 — One question at a time, or a continuing conversation?** Fresh context per question
is simpler and always correct. A thread is nicer to use and risks staleness.

**Q54 — Budget.** What is an acceptable cost and wait for one question? The answer sets
the tool-call cap and the model tier.

**Q55 — Should it act across all repos at once, or be scoped to what you are looking at?**
The fleet view says all; the cost says the current scope.
