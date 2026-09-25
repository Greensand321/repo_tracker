# The command log — one door for every change, whoever makes it

**Drafted:** 25 Sep 2026 · **Status:** ✅ **architecture chosen by the owner, 25 Sep** (D97,
D98) · Nothing built yet · Extends [`agent-autonomy.md`](agent-autonomy.md): its action door,
record and undo become the kernel described here. Open questions Q82–Q85 at the end, each
with a working default.

---

## What this is for

The owner, 22–25 Sep: the assistant should feel like an agent, and the code for it should
be **extendable**: *"I could copy the code and paste it in another program and with basic
wiring it could work there as well."* The next program is the owner's project management
software. This one is where the idea gets proved. It is decided **once**, so the choice was
made between whole architectures rather than features (D97):

| Core | Why not |
|---|---|
| The reconciler: today's board, extended | Your requests have nothing in the state to derive them from, so each one needs a side path. `dispatched.json` is the first one |
| An agent loop at the centre | Cost, repeatability and safety all depend on the model behaving. Background work and your buttons fit badly |
| **A command log** | **Chosen.** Every action by every actor goes through one door and is recorded |
| An external agent over MCP | Needs an outside runtime; nothing happens when nothing is connected |
| A workflow engine | Too heavy for a personal tool; it takes over the whole codebase |

A command log does not throw the others away. Each becomes one part of it: the board is a
policy that reacts to state, the agent loop is an actor that issues commands, an MCP server
would be a thin adapter that lists them, and a multi-step errand would be an actor that waits
on the log.

**Half of this already exists.** `server/agent/actions.ts` is a door that checks, applies,
records and refreshes. `server/agent/record.ts` keeps before and after. `server/agent/undo.ts`
refuses to overwrite a later change. All three serve **one actor**: the agent. The owner's
buttons write the stores directly. The stations write their answers directly. Requests live
in a file of their own. The work below makes that door the only one, and moves it into a
folder that knows nothing about repos.

---

## 1. The shape

```
  owner (routes)   agent (tools)   stations (board)   system (startup)
        │                │                 │                  │
        └────────────────┴─────── execute(command, input, who) ┘
                                   │
                    check → apply → record → announce
                                   │
          ┌────────────────────────┼─────────────────────────┐
     state stores            the log (Plane B)          subscribers
  goals · visions · insights   every entry, with        the page · the feed ·
  notebook · settings …        before/after, cause      the agent's next turn
```

- **A command** is one kind of change: `goal.create`, `branch.file`, `vision.set`,
  `summary.write`, `work.request`, `settings.set`. It declares its input, **who may issue
  it**, how to check it, how to apply it, and how to undo it.
- **The door**, `execute`, is the only way anything in Plane B changes. It checks, applies
  through the store that owns the data, records one entry, and tells subscribers.
- **The log** is the history. It sits **beside** the state stores and does not replace
  them: state is still read from `goals.json`, `visions.json` and the rest, exactly as
  today. This is deliberately not event sourcing. Nothing is rebuilt by replaying the log,
  so there is no event-schema versioning to carry.
- **Actors**: `owner`, `agent`, `station`, `system`. Who may do what is declared on the
  command, not left to the caller: `settings.set` accepts only `owner`, so D95's "the agent
  never changes a setting" is enforced by the kernel as well as by the import test.

**What is not a command.** Reading GitHub is observing, not doing. A new head, a red CI run
or a merged PR is a fact in the Snapshot and in the dated history (D31), and the board
reacts to it. The log records what *the program* did. The history records what *GitHub*
did. They stay separate.

**Routine jobs are not logged; what they write is.** The board stays a pure derivation
(D68). Logging every job it derives would add a hundred entries a minute for nothing. A
station's *output* is a `summary.write` or `assessment.write` entry, with its cause.

---

## 2. The kernel: the part you copy

`server/kernel/`, which imports nothing but `node:*` and itself. A test fails if that
stops being true, the same way `test/readonly.test.ts` guards Plane A.

```ts
type Actor = 'owner' | 'agent' | 'station' | 'system';

type Command<Host> = {
  name: string;                       // 'goal.create'
  summary: string;                    // one line: the tool description and the feed's verb
  input: Arg[];                       // today's ToolArg shape, validated before anything runs
  actors: Actor[];                    // who may issue it
  undoable: boolean;
  check(input, host): string | null;  // why not, or null (today's cannotAsk, generalised)
  apply(input, host): Applied;        // writes through the host's stores
  invert?(change: Change, host): string | null;   // undo it, or say why not
};

type Change = { subject: string; before: unknown; after: unknown; text: string };

type Entry = {
  id: string; at: string; actor: Actor; command: string; input: unknown;
  cause: string | null;               // the entry that led to this one
  turn: string | null; words: string | null;       // the agent's answer, and what was asked
  changes: Change[]; undone: string | null; seen: boolean; flag: string | null;
};

const kernel = createKernel({ host, commands, log });
kernel.execute(name, input, { actor, cause?, turn?, words? });   // → { entry, output } or refusal
kernel.undo(entryId, actor);  kernel.undoTurn(turn, actor);
kernel.subscribe(filter, fn);
kernel.commandsFor(actor);    // the agent's tool menu, and one day an MCP listing
```

**What the other program supplies** is the host: its stores, a `LogStore` (read, append,
compact), and a `refresh` callback. Here the `LogStore` is written with `jsonfile.ts`
(D85). In the project management software it can be a Postgres table. The kernel does not
care which.

**Undo moves into the kernel unchanged in spirit.** It uses D96's rule: an undo is blocked
while a later, standing entry touched the same subject in the same family. Each command's
`invert` does its own value check ("the goal still says what the change made it say").
The two checks that live in `undo.ts` today are split along that line.

---

## 3. Outputs are kept (D98)

The owner, 25 Sep: summaries should *"save across sessions and not get regenerated
automatically. If I tell my agent to refresh that branch then I expect them to do it, the
obvious exception is when a branch is recently updated."*

So an AI output is **replaced only when:**

1. **the branch moved** (a new head), picked up by the routine board, as today; or
2. **someone asked** — the owner's button, or the agent because the owner asked it to.

**Nothing else replaces it.** Today five things throw a summary away
(`server/advise/store.ts`, `enrich.ts:31`). This is what happens to each:

| Today it regenerates on | After D98 |
|---|---|
| a new head | **still regenerates.** It is the one automatic case |
| `PROMPT_VERSION` bumped | kept, and shown small as *written with an older prompt* |
| the model switched | kept, and labelled with its model |
| `nowLineWords` changed | kept at its old length and labelled. This reverses D91's "shortening the line rewrites the summaries" |
| the station's tools changed (D74) | kept and labelled |

The prompt version, model and tool set become **labels on the output**, not parts of its
key. A new command, `outputs.refresh-older`, re-reads everything written by an older prompt
or model when the owner asks for it: one button, or one sentence to the agent. Assessments
still move when the purpose's text moves, because that is a cause somebody issued. The
brief keeps its interval (D87).

**"Refresh it" becomes exact.** `work.request` is logged. The station's write is logged
with `cause` set to that request. The request is done when an entry exists whose cause is
the request. That replaces D81's timestamp comparison, which could be fooled by a clock
with one-second corners.

---

## 4. Where today's code goes

| Today | After |
|---|---|
| `server/agent/actions.ts`, the agent's door | commands in `server/commands/*.ts`, registered once. `actionsFor` becomes a thin wrapper that binds `actor: 'agent'` and the turn |
| `server/agent/record.ts`, `data/actions.json` | the kernel's log. `actions.json` is imported once and then set aside, never deleted |
| `server/agent/undo.ts` | the kernel's undo, plus each command's `invert` |
| `server/routes.ts` writes goals, visions and notes directly | every write is `kernel.execute(…, { actor: 'owner' })` |
| `server/work/dispatched.ts`, `data/dispatched.json` | outstanding `work.request` entries **are** the persisted requests (D72). Reboot counting is kept, as a `system` entry |
| `server/work/asks.ts`, `cannotAsk` | the `check` of `work.request` |
| stations call `putInsight`, `putAssessment`, `setVision` | stations call `execute` with `actor: 'station'` and a cause |
| `server/tools/agent.ts`, hand-built tools | generated from `commandsFor('agent')`; today's descriptions become the commands' summaries |
| `saveSettings` from the settings route | `settings.set`, owner only |
| `server/work/board.ts`, `run.ts` | **unchanged.** The board is a policy that reads state |
| `server/history.ts` | **unchanged.** Observations of GitHub, not commands |
| `server/advise/converse.ts`, `client.ts` | unchanged in behaviour. Later they can take a narrow config instead of `Settings` so they can join the kit; not required here |

---

## 5. Build order

Each phase leaves the program working, moves **one writer completely**, and never leaves two
paths for the same write.

| | Phase | What lands | Done when |
|---|---|---|---|
| **1** | **The kernel, with the agent on it**; no behaviour change | `server/kernel/`: registry, `execute`, log, undo, subscribe · today's agent actions rewritten as commands · `actions.json` imported | every existing test passes unchanged · the import-boundary test passes · the changes feed reads the same as before |
| **2** | **The owner through the door** | every route that writes Plane B calls `execute` as `owner` · the feed shows the agent's changes by default, with "everything" one click away | a test fails if `routes.ts` imports a store's write function · your own edits appear in the log |
| **3** | **Kept outputs** (D98) | stations write through the door with a cause · prompt, model, words and tools become labels · *written with an older prompt* on screen · `outputs.refresh-older` · a refresh is done by cause | a test: bumping `PROMPT_VERSION`, switching model or changing `nowLineWords` regenerates **nothing**; a new head does; "refresh this branch" does, exactly once · `docs/design/ai-map.html` says what a version bump now means |
| **4** | **Requests in the log** | `work.request` replaces `dispatched.json`, which is imported and set aside | close the program mid-request, reopen, and it finishes; two restarts without finishing still parks it, visibly |
| **5** | **Subscriptions** | the page's live updates, the feed and the agent's "it landed" all read `subscribe` | ask the agent to re-read a branch, stay in the conversation, and the next turn knows it landed without being told by the page |

**Not in this plan**, each waiting on a decision of the owner's own:

- **Sync (Stage 4)** ships the log's Plane B entries to Supabase. The log makes it
  mechanical, but it is Stage 4's to plan.
- **An MCP adapter** over `commandsFor`, so an outside agent could drive the program.
- **Errands and triggers.** A subscription that *issues* commands is the program acting on
  its own, which Q77 rules out. In this plan subscriptions only update views.

---

## 6. What does not change

- **Plane A is read-only forever** (D94). There is no command that writes to GitHub, and
  `test/readonly.test.ts` stays as it is.
- **The agent never acts unprompted** (Q77) and **never changes a setting** (Q79). The
  second now holds twice, in the import test and in `settings.set`'s actor list.
- **The board derives; it does not queue** (D68). Crash recovery for routine work is still
  free.
- **Every file goes through `jsonfile.ts`** (D85). Pruning stays scoped to repos a read
  reached (D86).
- **The undo window** stays `agentHistory` (500 by default, Q80). Older entries are history
  only.

---

## 7. What it costs

- **Disk.** One log file per day, `data/log/YYYY-MM-DD.json`, so only today's file is
  rewritten on each entry. Kept for `logKeepDays` (a new setting in `shared/settings.ts`,
  default 30). A station entry holds the output it replaced, so "put the old summary back"
  is an undo like any other.
- **Money.** Less, not more. Outputs stop being re-bought after prompt edits, model
  switches and settings changes. Each prompt bump so far (v2, v3) sent the whole fleet back
  to be paid for again.
- **Speed.** `execute` is a local, synchronous write. Workers run on one Node thread, so
  there is nothing to interleave.

---

## 8. Open questions, each with a working default

| # | Question | Default until answered |
|---|---|---|
| **Q82** | Should your own edits be undoable from the feed? | **Yes**, under "everything"; they do not count as unseen |
| **Q83** | How long is the log kept? | **30 days** (`logKeepDays`), undo limited to the newest 500 either way |
| **Q84** | On a new head, re-read at once or wait for the push burst to settle? | **At once**, as today; a settle time can be a setting later |
| **Q85** | When a prompt improves, should anything refresh on its own? | **No.** Older outputs are labelled; one button or one sentence refreshes them |
