# Bearing — Roadmap

**Last updated:** 15 Sep 2026 · **Current phase:** Phase 0, not started (planning complete)

Sources: spec v0.3 §6 (phase definitions), build plan v0.2 §4 (milestone deliverables and
exit criteria), phase-0 plan (Phase 0 detail). Where they disagree, the spec wins.

---

## A note on numbering — "phase", "milestone", "tier"

Three numbering schemes appear across the documents. They describe the same work.

| Spec v0.3 calls it | Build plan v0.2 calls it | Informally |
|---|---|---|
| Phase 0 | M0 | tier 0 / "the start" |
| Phase 1 | M1 + M2 | tier 1 |
| Phase 2 | M5 (+ hygiene from M6) | tier 2 |
| Phase 3 | M6 | tier 3 |
| Phase 4 | M3 + M4 + M7 | tier 4 |

**Use "Phase N" from here on.** The milestone numbers survive only as references into
`plans/build-plan-v0.2.md`, which is still the best description of *how* several of these
are built.

The one real conflict between the two documents: build plan v0.2 §12 defines v1 as
"M0–M4, including the advisor and Heading, advisor on by default." Spec v0.3 overturned
that — **the advisor is Phase 4, built last, on a complete data layer; v1 is fully
deterministic.** Everything else in the build plan stands.

---

## Phase 0 — The Brief engine `← WE ARE HERE`

**Status:** not started · **Plan:** [`plans/phase-0-plan.md`](plans/phase-0-plan.md) (ready for handoff)

Build the engine. Read git, compute per-branch state, produce a prioritized **Brief**.
The Brief JSON is the product; every later surface renders it.

**Deliverables**
- [ ] Repo discovery from `bearing.toml`; branch enumeration per repo
- [ ] `BranchState`: ahead/behind, last activity, diffstat, merged-ness, conflict-risk, working tree, stashes
- [ ] Flag derivation + prioritization (deterministic, no network)
- [ ] Renderers: Markdown, JSON, and a self-contained **HTML "Bridge" snapshot**
- [ ] CLI: `bearing brief [--repo PATH] [--json] [--html] [--out FILE] [--open]`
- [ ] Test suite including a deterministic fixture-repo generator

**Explicitly not in Phase 0** — do not build, do not stub: session reconstruction, `park`
notes, any GitHub/PR/CI data, the interactive dashboard, anything LLM, and the `scan` /
`config` / `sessions` / `open` / `prune` / `add` commands.

**Exit:** a real-repo run where the resume card names the branch the owner actually last
touched, in < 5 s across 4 repos, with a test proving nothing in the repos changed.
Full criteria: phase-0 plan §11.

**Owner constraint that shapes this phase:** the owner does not work in the terminal. The
Markdown brief is plumbing for tests and logs; **the HTML snapshot is the day-one
deliverable.** Every Phase 0 result must be verifiable without reading terminal output.

---

## Phase 1 — Context

**Status:** planned · **Detail:** build plan v0.2 §4 (M1, M2) and §2.1 (multi-machine)

Memory across sessions and across machines, plus GitHub facts.

- [ ] Reflog **session reconstruction** with gap detection (`bearing sessions`)
- [ ] `bearing park "…"` scratchpad notes, resurfaced per branch (one-liners, not a journal)
- [ ] Scan snapshot cache; `bearing config`
- [ ] **Multi-machine journal**: stable `machineId`, one append-only `.jsonl` per machine in
      a synced folder, merged in memory — no write conflicts by construction.
      Metadata-only by default; WIP patches opt-in.
- [ ] GitHub PR/CI/review enrichment via `gh` passthrough — no token management
- [ ] Staleness honesty: machine-local facts labeled with origin and age

**Exit:** notes survive restarts; a branch touched on machine A shows up on machine B
labeled with origin and age; the brief shows PR/CI state and degrades cleanly offline.

---

## Phase 2 — Surfaces & Hygiene

**Status:** planned · **Design:** [`design/`](design/README.md) · **Detail:** spec §14.2, build plan §4 (M5)

The owner's daily surface. All three views are renderers over the same Brief JSON — no
engine changes.

- [ ] Fleet dashboard (`bearing open`) in three switchable views:
      **The Bridge** (resume-first, default) · **The Map** (spatial) · **The Logbook** (timeline)
- [ ] Shell-startup one-liner (`bearing shell-init`) — opt-in, non-blocking
- [ ] Hygiene & risk radar: stale, old-base, merge-ready, conflict-prone, safe-to-delete

**Exit:** the dashboard renders the Brief JSON with zero engine changes.

---

## Phase 3 — Insight *(optional)*

**Status:** speculative · **Detail:** build plan §4 (M6)

- [ ] Velocity & churn analytics; **hotspot** files (frequent change × size)
- [ ] **File coupling** (files that change together)
- [ ] "Almost done" detection (needs PR data from Phase 1)
- [ ] "Decision debt" — branches that represent an unmade decision

**Exit:** the flags measurably drive branch-count reduction.

---

## Phase 4 — Advisor & LLM *(built last, on purpose)*

**Status:** deferred by decision · **Detail:** build plan §3 (Heading), §7 (LLM contracts), §8 (safety)

The advisor is probabilistic; the engine is deterministic. The advisor **never mutates a
repo** — everything it produces is an artifact you choose to act on.

- [ ] **Narrate** — WIP summary + next step, cached by `{repo, branch, headSha, configHash}`
- [ ] **Plan** — `bearing plan <branch>`, PR descriptions, changelog drafts
- [ ] **Heading** — read a project's direction, propose features that fit its grain, build a
      *disposable* demo in a `git worktree` sandbox, verify it, then keep / discard / promote
- [ ] Proposals store + gallery; `promote` is the only write path, and it is human-triggered
- [ ] Conversational advisor over the complete data layer
- [ ] Budget caps, model tiering, prompt versioning

**Exit:** an automated test proves the working tree is byte-for-byte unchanged after a demo.

---

## The shape of the thing

```
Phase 0 ──────────► Brief JSON  ◄── the product
   │                    │
   │                    ├──► Markdown brief        (plumbing)
   │                    ├──► HTML Bridge snapshot  (the owner's day-one GUI)
   │                    │
Phase 1 ── context ─────┤ (sessions, notes, journal, GitHub)
Phase 2 ── surfaces ────┤ (dashboard: Bridge / Map / Logbook)
Phase 3 ── insight ─────┤ (analytics, hotspots, coupling)
Phase 4 ── advisor ─────┘ (narrate, plan, Heading — proposals only, never writes)
```

Each phase is independently shippable, and every phase after 0 is optional to the one
before it. If the advisor never gets built, Bearing still works.
