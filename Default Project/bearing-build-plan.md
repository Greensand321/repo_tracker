# Bearing — Build Plan

**Working title:** Bearing · **Companion to:** `bearing-spec.html` (v0.1) · **Plan version:** v0.2 · **Date:** 13 Sep 2026

> Bearing reconstructs your working context across many branches and repos. This document is the *how*: architecture, the resolved agent model, the new generative feature, and an ordered build sequence with exit criteria.

**Decisions locked (13 Sep 2026):** stack **A — Python CLI now, web UI later (M5)** · v1 = **M0–M4** · topology = **multiple machines** (see §2.1) · advisor **on by default with strict caps**.

---

## 1. What changed since spec v0.1

The v0.1 spec left the LLM as a caption generator and left "agent autonomy" as an open risk (§3 Non-Goals even says it is *not* an autonomous agent). You resolved this in a way that is architecturally cleaner than a "trust ladder":

> **The vast majority of the program is deterministic. The LLM's job is to generate plans and one-off demos — not to operate the repo.**

This is the central design decision of v0.2. It splits the product in two:

| Half | Nature | Responsibility | Failure mode |
|---|---|---|---|
| **The Engine** | Deterministic | Collect, compute, flag, prioritize, reconstruct, render | Bugs are testable and reproducible |
| **The Advisor** | Probabilistic | Narrate, plan, envision/demo | Output is *wrong prose or a bad demo* — never a corrupted repo |

The advisor **never mutates the repository**. Everything it produces is an artifact (prose, a plan document, a disposable demo in a sandbox) that *you* choose to act on. That removes the entire "autonomous agent does something destructive" class of risk, and it means the engine stays local-first, offline-capable, cheap, and fast.

**This is effectively the "generate, don't operate" / proposer-verifier pattern:** generate cheaply at volume, put a verification gate in front of anything that leaves the proposal store, and keep the write path single-threaded and human-triggered.

---

## 2. Revised architecture

```
                          ┌───────────────────── deterministic ─────────────────────┐
  git ─┐                  │  collect → analyze → prioritize → render                │
 github ┼─── collect ─────▶│                                         │               │
 notes ─┘                  │                                         ▼               │
                           │                                     Brief JSON          │
                           └─────────────────────────────────────┬───────────────────┘
                                                                  │  (packets, on demand)
                                          ┌───────────────────────▼───────────────────┐
                                          │              ADVISOR (opt-in)             │
                                          │  Narrate · Plan · Heading                 │
                                          └───────────────┬───────────────────────────┘
                                                          │ proposals (never auto-applied)
                                          ┌───────────────▼───────────────┐
                                          │  Proposals store → Gallery     │
                                          │  Sandbox (worktree) for demos  │
                                          └───────────────────────────────┘
```

**Layers**

1. **Collectors** — read-only. Local git (reflog, refs, working tree, stash, log), GitHub (optional, token), notes/config files.
2. **Analyzer** — pure functions. Branch state, divergence, flags, session reconstruction, prioritization, hygiene, history graph.
3. **Advisor** — optional, network. `Narrate`, `Plan`, `Heading`. Structured outputs, validated, cached, budget-capped.
4. **Sandbox** — disposable `git worktree` where demo code is generated and (when possible) built/tested. Never touches the checked-out branch.
5. **Proposals** — durable store of advisor artifacts, with keep/discard and promote-to-branch.
6. **Renderers** — Markdown / JSON / HTML / TUI. The `Brief` JSON *is* the product; surfaces are interchangeable.

The **Advisor and Sandbox are optional**, exactly as the LLM was optional in v0.1. If disabled, every deterministic feature still works.

### 2.1 Multi-machine model *(decision: multiple machines)*

Local git facts are **machine-local**: `reflog`, uncommitted changes, and stashes never leave the machine that produced them. Commits on pushed branches, plus PRs/reviews/CI, are already shared via GitHub. So context splits into two tiers:

| Tier | Examples | Cross-machine source |
|---|---|---|
| **Shared** | commits on pushed branches, branch list, PRs, reviews, CI | GitHub |
| **Machine-local** | reflog sessions, working tree, stashes, parking notes, advisor cache | Bearing journal (synced) |

**Design: one sync root, one append-only journal file per machine, merged in memory.**

- On install, generate a stable `machineId`.
- Each machine appends compact events to `<syncRoot>/machines/<machineId>.jsonl` — branch touched, head SHA, timestamp, action, notes, and (optionally) a content-addressed WIP patch.
- The sync root is a plain folder replicated by whatever you already use (Syncthing / Dropbox / OneDrive / iCloud / a private git repo). **Bearing does no networking itself.**
- Because each machine writes only its own file, **there are no write conflicts.** The reader merges all journals in memory: per `(repo, branch)` take the latest activity, union notes, and attribute origin ("seen on `laptop-2`").
- GitHub (when enabled) reconciles pushed work, so a fresh clone on a new machine reconstructs shared state even with an empty journal.

**Scope control (privacy).**

- Default `metadata-only`: branch names, SHAs, timestamps, notes. No source content.
- Optional `include-wip-patches`: content-addressed WIP snapshots so unfinished work is genuinely recoverable on another machine — sensitive, **off by default**.

**Staleness honesty.** The brief labels machine-local facts with origin and age ("last activity on `laptop-2`, 3d ago") so a synced snapshot is never mistaken for current local state.

This also unlocks **WIP recovery**: the journal captures a patch, it syncs, and the other machine applies it into a sandbox — reusing Heading's sandbox machinery.

---

## 3. New feature — **Heading** (Idea & Demo Generator)

> Bearing tells you where you *are*. **Heading** suggests where you could *go* — by reading the direction of a project and proposing features that fit its grain, then building a disposable demo of one.

This is the "cool feature" you described, and it is the natural home for the generative capability. It is safe because its output is disposable and sandboxed.

### 3.1 Flow

1. **Direction packet (deterministic).** Assemble a token-budgeted context packet:
   - README / docs / ADRs excerpts
   - manifest & dependency files (language, framework, versions)
   - shallow directory tree + module names
   - last ~50 commit subjects + churn counts
   - open `TODO` / `FIXME` / `HACK` markers
   - public surface: exported symbols / routes / CLI commands
   - any direction note you supply (`bearing heading --intent "..."`)
2. **Direction inference (LLM).** 3–5 bullets: *"this project is becoming…"* — with evidence citations into the packet.
3. **Opportunity scan (LLM).** 3–6 candidate features. Each carries: name, one-line pitch, **why it fits** (cited), rough size (S/M/L), risk, likely files touched.
4. **Pick one** (you).
5. **Plan (LLM).** Objective, ordered steps, files, interfaces/pseudocode, risks, and a verification checklist. This is the same `Plan` artifact used by `bearing plan <branch>`.
6. **Demo (LLM → sandbox).** Generate a runnable, disposable prototype in one of two modes:
   - **Mode A — standalone:** a self-contained new module / HTML mock / storybook page. Lowest risk.
   - **Mode B — in-place patch:** a diff against the current base SHA, applied **only** in a sandbox worktree.
7. **Verify (deterministic gate).** Detect the project's build/lint/test harness and run it *if present*; otherwise static checks (parse, imports resolve, typecheck if cheap). Result is tagged `verified` / `unverified` — never overstated.
8. **Gallery.** Proposals are listed with metadata (repo, base SHA, model, prompt version, cost, verdict). Actions: **keep**, **discard**, **promote**.
9. **Promote (human-triggered, the only write path).** Creates a *real* branch and applies the demo. Never auto-committed, never pushed.

### 3.2 Why this is low-risk

- Demos are generated in `git worktree` sandboxes under the app's cache dir — the working tree is untouchable.
- Advisor outputs land in a **Proposals store**, not the repo. Nothing is applied without you invoking `promote`.
- Caps on tokens, wall-clock, disk, and network per run.
- `bearing sandbox clean` removes all sandboxes.

### 3.3 Model tiering (from the loops discussion)

- **Narrate** (summaries): cheap/fast model, aggressive caching — high volume, low judgment.
- **Plan**: mid/strong — structured reasoning.
- **Heading opportunities + demo**: strongest available — this is the one genuinely creative, low-volume task.

This mirrors the durable rule: *generate cheaply, verify with a gate, keep writes single-threaded.*

---

## 4. Milestones

Ordered so the deterministic core ships first and every later phase is optional. Each milestone states **entry → deliverables → exit (definition of done)**.

### M0 — Deterministic Engine + Markdown Brief *(the heart)*
- **Entry:** stack chosen; repo config format agreed.
- **Deliverables**
  - `bearing.toml` config + repo discovery
  - `collect/git`: refs, working tree, stash, log, reflog
  - `analyze/branch`: ahead/behind, diffstat, flags
  - `analyze/session`: reflog → sessions (gap detection)
  - `analyze/prioritize`: brief ordering
  - `render/markdown` + `brief` JSON
  - CLI: `scan`, `brief`, `sessions`
- **Exit:** `bearing brief` on a real multi-repo config produces a useful brief, fully offline, no LLM. Analyzer has unit tests over crafted git fixtures. `< 5s` generation.
- **Risk:** reflog parsing edge cases (packed-refs, worktrees, bare repos).

### M1 — Persistence & Memory *(incl. multi-machine journal)*
- **Entry:** M0 merged.
- **Deliverables:** notes store + `bearing park`; scan snapshot cache; `bearing config`; **machine-id + append-only journal (§2.1)**; in-memory merge across machine journals; sync-root config + `metadata-only` scope.
- **Exit:** parking notes survive restarts and resurface per repo/branch; second run reuses cache; a branch touched on machine A is visible (labeled with origin/age) on machine B with no write conflicts.

### M2 — GitHub Enrichment
- **Entry:** M1 stable.
- **Deliverables:** `collect/github` (PR, reviews, CI, compare); merge-ready / CI-failing flags; token via env or `gh` passthrough.
- **Exit:** brief shows PR/CI state; degrades gracefully offline or without a token; token never written in plaintext.

### M3 — Advisor: **Narrate** & **Plan**
- **Entry:** M2 stable; LLM provider confirmed (Zen).
- **Deliverables:** Advisor client (structured output + schema validation); `Narrate` (WIP + next step, cached by `{headSha, configHash}`); `Plan` (`bearing plan <branch>`, PR-description and changelog drafts); budget caps; prompt versioning; `Proposals` store.
- **Exit:** summaries cached — repeat runs are free/offline; per-run cost bounded; **nothing is written to the repo**; advisor failure degrades cleanly to the deterministic brief.

### M4 — **Heading** (Idea & Demo Generator)
- **Entry:** M3 stable; sandbox proven in tests.
- **Deliverables:** direction-packet assembler; opportunity scan; sandbox worktree manager; demo modes A/B; verification harness; proposals gallery; `bearing heading`, `bearing sandbox clean`, `bearing promote`.
- **Exit:** you can scan ideas, generate a demo, verify it, discard it, and promote one to a real branch — with an automated test proving the working tree is byte-for-byte untouched after a demo.
- **Risk:** demo quality variance; verification coverage; disk cleanup.

### M5 — Surfaces
- **Entry:** M4 (or M2, if scoping v1 smaller).
- **Deliverables:** local web dashboard (fleet + brief + proposals gallery); shell-startup one-liner; scheduled digest.
- **Exit:** dashboard renders the same `Brief` JSON with no engine changes; startup hook is opt-in and non-blocking.

### M6 — Insight & Hygiene
- **Entry:** M5.
- **Deliverables:** hotspot (churn × size) and file-coupling; velocity; almost-done; decision debt; `prune --dry-run`; hygiene radar.
- **Exit:** flags measurably drive branch reduction.

### M7 *(optional)* — Conversational Agent
- Natural-language Q&A over the same data layer, read-only.

---

## 5. Module map & interfaces

```
bearing/
  collect/    git.py      readRepo(path, opts) -> RawRepoState        # I/O
              github.py   fetch(repo, token, opts) -> GithubMeta      # I/O
  analyze/    branch.py   analyze(RawRepoState, cfg) -> BranchState[] # pure
              session.py  sessions(ReflogEntry[], gap) -> Session[]   # pure
              prioritize.py order(BranchState[], cfg) -> BranchState[]# pure
              hygiene.py  flags(BranchState[], cfg) -> Flag[]         # pure
  advise/     client.py   complete(schema, prompt, model) -> T        # I/O
              narrate.py  narrate(BranchState) -> Summary             # I/O
              plan.py     plan(Packet) -> Plan                        # I/O
              heading.py  opportunities(Packet) -> Opportunity[]      # I/O
              cache.py / budget.py                                    # I/O
  sandbox/    worktree.py withSandbox(repo, fn) -> Result             # I/O
              verify.py   detectAndRun(path) -> VerifyResult          # I/O
  proposals/  store.py    save/list/promote(P *Proposal)              # I/O
  render/     markdown.py json.py html.py                             # pure
  store/      notes.py config.py                                      # I/O
  cli/        main.py
```

**Design rule:** `analyze/*` and `render/*` are pure and must stay pure — they are where tests live and where correctness is guaranteed. I/O is pushed to the edges. The engine must be usable as a library independent of the CLI.

---

## 6. Data artifacts added in v0.2

```jsonc
// DirectionPacket — deterministic assembly, token-budgeted
{ "repo": "api-service", "baseSha": "a1b2c3d",
  "readme": "...", "manifest": {...}, "tree": ["src/...","tests/..."],
  "recentCommits": [{"subject": "...", "files": 7}],
  "todos": [{"file": "src/x.ts", "text": "FIXME: retry"}],
  "publicSurface": ["POST /webhooks"], "intent": "user-supplied, optional" }

// Opportunity — LLM
{ "id": "opp_1", "name": "Webhook replay console", "pitch": "...",
  "fitsBecause": [{"claim": "...", "evidence": "src/webhooks.ts:42"}],
  "size": "M", "risk": "low", "filesLikely": ["src/webhooks.ts"] }

// Plan — LLM
{ "objective": "...", "steps": [{"id": 1, "title": "...", "detail": "...",
  "files": ["..."], "est": "S"}], "risks": [...], "verification": [...] }

// Proposal — durable
{ "id": "prp_1", "kind": "demo|plan|summary", "repo": "...", "baseSha": "...",
  "model": "...", "promptVersion": "v1", "costUsd": 0.013, "createdAt": "...",
  "sandboxPath": "...", "verify": {"status": "verified|unverified", "detail": "..."},
  "state": "new|kept|discarded|promoted" }

// DemoRun — sandbox record
{ "proposalId": "prp_1", "mode": "A|B", "worktree": "...",
  "appliedFiles": ["..."], "verify": {...}, "durationMs": 8421 }
```

---

## 7. LLM contracts

- **Structured output only.** Every advisor call returns JSON validated against a schema; on failure, retry once, then degrade to the deterministic result.
- **Model tiering.** Narrate = cheap; Plan = mid/strong; Heading = strongest. Configurable per task.
- **Caching.** Narration keyed by `{repo, branch, headSha, configHash}`. Heading keyed by `{repo, baseSha, promptVersion, intent}`.
- **Budgets.** `max_requests_per_run`, `max_tokens_per_request`, diff-size skip threshold, per-proposal dollar cap, wall-clock cap.
- **Prompt versioning.** Every proposal records `promptVersion` so results are reproducible and comparable.
- **No repo writes.** The Advisor interface has no write access. Only `sandbox` and `promote` (human-invoked) can change files.
- **Provider.** OpenCode **Zen** (pay-as-you-go, OpenAI-compatible). *Not* the Go subscription — Go targets coding-agent traffic and monitors for abuse.

---

## 8. Safety & sandboxing

- Demo generation happens in a `git worktree add` sandbox; the live checkout is never touched.
- No `push`, no `merge`, no history rewrite anywhere in the codebase. `promote` only creates a new local branch.
- Sandbox runs under caps (time, disk, tokens, network). `bearing sandbox clean` reclaims everything.
- GitHub token from env / OS keychain, never plaintext config.
- Advisor payloads are minimal excerpts, never full history. Local-first by default; the advisor is **on by default with strict caps**, and fully disableable via config or `--no-llm`.
- Journal sync is **metadata-only by default**; WIP patches are opt-in and never synced without explicit config.

---

## 9. Testing strategy

- **Pure analyzer:** unit tests + golden fixtures (hand-crafted reflog/log/ref outputs), including hostile cases (packed-refs, detached HEAD, worktrees, rebases, resets).
- **Integration:** create throwaway git repos in-test and assert `Brief` output.
- **Sandbox invariant test:** after a demo, the source worktree is byte-for-byte unchanged (this is the safety guarantee — test it explicitly).
- **Advisor:** fake client + recorded fixtures; **no network in CI**. Schema-validation and degradation paths covered.
- **GitHub:** recorded responses; offline/no-token degradation covered.
- **Renderer:** snapshot tests of Markdown/JSON.

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `reflog` is local and can expire (`gc.reflogExpire`) | Lose session history | Conservative default window; optionally append to own activity log; document limitation |
| Repos on multiple machines | Local reflog/working-tree state doesn't cross machines | Append-only per-machine journal in a synced folder (§2.1), merged in memory; GitHub reconciles pushed work |
| Demo quality variance / over-trust | Wasted time | Verification gate, explicit `verified/unverified`, disposable by default |
| LLM cost creep | Budget surprise | Tiered models, caching, hard caps, cost shown per proposal |
| Scope creep (generative features are seductive) | Never ships | M0 deterministic core first; each phase independently shippable |
| Name collision ("Bearing") | Discoverability / trademark | Quick availability check before publishing |

---

## 11. Decisions

**Locked**
1. **Stack** — **A: Python CLI now**, engine kept surface-independent; **web UI (C) in M5**.
2. **Machine topology** — **multiple machines**; journal sync per §2.1.
3. **v1 boundary** — **M0–M4**, including Heading.
4. **LLM default** — **on by default with strict caps**; disableable via config or `--no-llm`.

**Remaining (non-blocking)**
5. LLM models — Zen confirmed as provider; pick cheap / mid / strong model names.
6. Sync root location + scope (`metadata-only` default; WIP patches opt-in).
7. Sandbox location + auto-clean policy.
8. Brief cadence (on-demand / terminal-open / scheduled).
9. Repo & branch include/exclude patterns.
10. `safe-to-delete`: list-only or actionable?
11. GitHub auth: PAT vs `gh` passthrough.

---

## 12. Definition of "v1 done"

v1 = **M0–M4**, built as a **Python CLI** with the engine usable as a library, and **multi-machine context** via the journal:

- A deterministic, offline `bearing brief` you actually use daily.
- Persistent parking notes, cached scans, and a synced machine-local journal (origin + age labeled).
- GitHub PR/CI enrichment.
- **Narrate** + **Plan** artifacts, on by default, cached and budget-capped.
- **Heading**: idea scan → sandboxed demo → verify → promote, with the working-tree invariant test green.

M5–M7 (web UI, analytics, chat agent) follow as separate releases.

---

## 13. Immediate next steps

1. Break **M0** into tracer-bullet tickets (natural use of `to-tickets`).
2. Scaffold the Python project and build the analyzer test-first (`tdd`): git collector → branch analyzer → session reconstruction → Markdown brief.
3. Wire the M1 journal + sync-root config early, so multi-machine is designed in rather than retrofitted.
4. Fold §2.1 (multi-machine), §3 (Heading), and §6–§8 into `bearing-spec.html` as its v0.2.
