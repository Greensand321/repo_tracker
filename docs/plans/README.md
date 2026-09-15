# Plans

| File | Scope | Status |
|---|---|---|
| `phase-0-plan.md` | Phase 0 / Milestone 0 — the Brief engine | **Current. Ready for implementation handoff.** |
| `build-plan-v0.2.md` | Whole-product architecture and milestones M0–M7 | Reference. Partly superseded — see below. |

## `phase-0-plan.md` — what to build now

Written for an implementer with no prior context, and deliberately explicit: exact git
commands (§5), exact schemas (§6), exact thresholds (§7), the module layout (§3), the test
strategy (§10), and the acceptance criteria that define done (§11). Where it leaves a
choice open, it says so and bounds it.

Two things in it are already out of date, and are corrected here rather than in the
document (it is a dated artifact):

- **§3 says to create a new repo at `C:\Users\alexa\Documents\github\bearing\`.** That is
  now this repo — source at the root, documents under `docs/`. The module layout in §3
  still applies, rooted at `bearing/`.
- **File references assume everything sits in one flat folder.** Current locations:
  `bearing-spec.html` → `../spec/bearing-spec-v0.3.html`;
  `bearing.css` / `bearing.js` / `bearing-prototype.html` → `../design/prototype/`.

## `build-plan-v0.2.md` — still the best source for architecture

Keep reading it for: the Engine/Advisor split and why it exists (§1–2), the multi-machine
journal design (§2.1), the Heading feature (§3), the module map and interfaces (§5), the
LLM contracts (§7), safety and sandboxing (§8), the testing strategy (§9), and the risk
table (§10).

**One part of it is overturned.** §11 and §12 define v1 as M0–M4 with the advisor on by
default. Spec v0.3 reversed that the same day: the advisor is **Phase 4, built last**, and
v1 is fully deterministic. Its milestone numbering also predates the spec's phase
numbering — see the mapping table in [`../ROADMAP.md`](../ROADMAP.md).

## Adding a plan

One file per phase, named `phase-N-plan.md`, written to the standard `phase-0-plan.md`
sets: explicit enough that someone with no context can execute it, with acceptance
criteria concrete enough to be checked off. Write it when that phase starts, not before —
plans written too far ahead get overturned, as §11 above demonstrates.
