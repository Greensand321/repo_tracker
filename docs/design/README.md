# Design

The visual target for Bearing. These are the mockups we are building toward — the
"real ones", as distinct from the paradigm explorations now in [`../archive/workflow-mockups/`](../archive/workflow-mockups/).

All of them open directly from disk — double-click, no server, no build. (They pull fonts
from Google Fonts, so text falls back to system faces offline; layout is unaffected.)

## What's here

| File | What it is | Status |
|---|---|---|
| `prototype/bearing-prototype.html` + `bearing.css` + `bearing.js` | Three structurally different dashboards in one page, switchable with ← → or `?variant=A\|B\|C`: **A — The Bridge** (resume-first), **B — The Map** (spatial), **C — The Logbook** (timeline). | **Visual source of truth.** Spec §14.2 names all three as the Phase 2 dashboard views. |
| `dashboard-concept.html` | Self-contained later concept — "you are here". Board / Timeline / Notes / Needs views, per-branch step checklists, recall + blocker + next-step, command palette. Denser and further along than the prototype variants. | Reference for where the dashboard is eventually going. |
| `mockup-prompt.md` | The brief these were generated from. Worth reading before making new ones — it states the pain in the owner's words. | Historical, still useful |

## Which file governs what

- **Phase 0 HTML snapshot** (`bearing brief --html`) → **variant A, "The Bridge"**, in
  `prototype/bearing.css` sections `vA` (`.hero`, `.flag`, `.bcard`, `.proj`). Lift the
  palette, the typography, and the card structure. Static output only: no JS required,
  one optional `<details>` expand per card for the diffstat. Detail: phase-0 plan §8.3.
- **Phase 2 dashboard** → all three variants, as switchable views over the same Brief JSON.
- **Anything richer** → `dashboard-concept.html`, as direction rather than as a target.

## Read these as exploratory — two things in them are not the product

Both were generated before spec v0.2 settled these, and both are contradicted by locked
decisions (see `../decisions/decision-log.md`):

1. **Invented branch names.** The mockups show things like *"the signup flow"* and
   *"The token refresh thing"*. The product renders **literal git branch names only**,
   always as `repo / branch-name` (decision #7). Notes are the place for prose — and they
   are one-liners, not paragraphs (decision #8).
2. **The advisor panel.** The prototype's advisor rail is **Phase 4**. In the Phase 0
   snapshot that space is a static "next actions" list; there is no chat, no LLM, nothing
   that implies one.

What carries over is **layout, palette, typography, and card structure** — brass on dark
navy, serif display face, mono for git facts. Not the invented content.
