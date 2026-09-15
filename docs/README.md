# Documentation map

Everything written about Bearing lives here. Source code lives at the repo root.

## What is authoritative

When two documents disagree, this is the order of precedence:

1. **`spec/bearing-spec-v0.3.html`** — the product spec. The spec always wins.
2. **`plans/phase-0-plan.md`** — the implementation plan for the current milestone.
3. **`decisions/decision-log.md`** — locked decisions, with the document each came from.
4. **`plans/build-plan-v0.2.md`** — architecture and milestones. Still the best source
   for architecture (§2, §5), safety (§8), and testing (§9) — but its *ordering* of the
   advisor was overturned by spec v0.3. See the note in `plans/README.md`.
5. **`archive/`** — superseded. Read for reasoning, never for instructions.

## Contents

### `STATUS.md`
Where the project stands and what the next concrete action is. **Update this at the end
of every working session** — it is the file that makes this repo pick-up-able, which is
the same job Bearing itself does for branches.

### `ROADMAP.md`
Phases 0–4: what is in each, what is explicitly *not*, exit criteria, current status.
Also reconciles the two numbering schemes floating around ("Phase 0" vs "Milestone 0"
vs "tier 0" — all the same thing).

### `spec/`
| File | What it is |
|---|---|
| `bearing-spec-v0.3.html` | **Canonical product spec.** Open in a browser. Sections: concepts (§4), data sources (§5), phases (§6), data model (§7), architecture (§8), privacy (§10), config (§11), CLI (§12), mockups (§14), heuristics (§18). |

### `plans/`
| File | What it is |
|---|---|
| `phase-0-plan.md` | **The build instructions for right now.** Exact git commands, schemas, thresholds, module layout, acceptance criteria. Written for an implementer with zero prior context. |
| `build-plan-v0.2.md` | Architecture + milestone plan. Engine/Advisor split, multi-machine journal design, the Heading feature, module map, risk table. Partly superseded — see `plans/README.md`. |

### `design/`
The visual target. `design/README.md` says which file is the source of truth for what.
Short version: `prototype/` variant A ("The Bridge") is the reference for the Phase 0
HTML snapshot; `dashboard-concept.html` is the fullest expression of the eventual
dashboard.

### `decisions/`
`decision-log.md` — every locked decision in one table, with its source and date, plus
the questions still open. Check here before reopening an argument.

### `archive/`
Superseded documents kept because the reasoning in them is still good: spec v0.1, and
the three workflow-paradigm mockups that led to choosing dashboard-first.

## Conventions

- Markdown for anything meant to be edited; HTML for anything meant to be *looked at*.
- Filenames carry the version when a document is versioned (`bearing-spec-v0.3.html`).
- When a document is superseded, move it to `archive/` and add a line to
  `archive/README.md` saying what replaced it and why. Do not delete it.
- Dates in documents are written as `13 Sep 2026`, timestamps in data as ISO-8601 UTC.
