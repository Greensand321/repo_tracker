# Design explorations — the ledger language

> **Chosen: D4, The Broadsheet** (17 Sep 2026). The owner picked it over the D6 recommended
> below, for the standing column on the right, "happening now" at the top, and the placement
> of the ask box. It is built and running in `web/`, with the register grouped by **goal**
> and D6's grouping control carried across. See **D57** in the decision log.
> Everything below is the exploration as it stood before that call, kept as reasoning.

Six full interfaces for Bearing, all built from the design language of the prototype's
**variant C, "The Logbook"** (`../prototype/bearing-prototype.html?variant=C`).

Open [`index.html`](index.html). Use <kbd>←</kbd> <kbd>→</kbd> to flip between them.
No server and no build — they open from disk, and the fonts are self-hosted in `fonts/`
so they render identically with no network.

## The approach

The language was extracted **once**, into [`base.css`](base.css), and never varies between
designs. What varies is the structure built on top of it. That is the mix of the two
approaches: copy the language exactly, build the architecture fresh each time.

Five things make the language work, and the header comment in `base.css` says so in case a
later revision is tempted to lose one:

1. **No cards. Rows on a rule.** Density reads as competence; boxes read as toys.
2. **A fixed-width time column**, so every row starts at the same x. That one constraint is
   most of the rhythm.
3. **A glyph gutter** — ✦ ✗ ⚓ ⚑ ↩ — giving texture without a single border.
4. **Mono for machine facts, serif italic for human reflection.** One typographic hierarchy
   carries the whole meaning: if it is in italics, a person or the advisor thought it.
5. **Teal appears once**, on whatever is happening now. Everything else is grey.

## What had to change from the prototype

The prototype is a picture of a **human at a keyboard**: uncommitted files, a stash, "left
for lunch at 11:42", a red test on disk. None of that exists here. Bearing's branches are
pushed by agents and never checked out, so the only evidence is commits, PRs and CI
(`CLAUDE.md`, "the one thing to understand"). Every design below reads that instead — the
*language* transplanted, the *content model* rebuilt.

They all render the same sample `Snapshot` from [`data.js`](data.js), shaped exactly like
`shared/types.ts`, and compute nothing of their own (rule 4). Where a design wanted a fact
the Snapshot does not carry, that is noted below rather than faked.

## The six

| | Design | In one line | Verdict |
|---|---|---|---|
| D6 | [The Ledger](d6.html) | One ledger, two spines — the same rows read **by thread** or **by day** — with the command line always visible and answers filed into the ledger as dated entries. | Recommended at the time; not chosen. |
| D1 | [The Register](d1.html) | One continuous table of every branch, rows opening in place. | Purest ledger; fastest scan. No sense of time. |
| D2 | [The Day Book](d2.html) | Days descending, every repo interleaved. | Closest to the prototype. Answers "what moved while I was away" perfectly, "what is this branch doing" badly. |
| D3 | [The Split Ledger](d3.html) | Repos ǀ register ǀ dossier. | Deepest per branch, keeps your place — but three panes is the shape that felt over-used. |
| D4 | [The Broadsheet](d4.html) | A masthead, a leader column, a standing register. | The most beautiful, and the only one another person could read. Three branches fill a screen; at ~100 that hurts. |
| D5 | [The Console](d5.html) | One command line; the ledger answers below it. | The clearest model of what the agent is and what it costs. A blank prompt is a bad first screen. |

## Why D6

It is the synthesis, and each borrowed part earns its place:

- **D1's continuous register** is the spine — highest density, nothing to learn.
- **D2's day grouping** is the second spine. "What is each branch doing" and "what moved
  while I was away" are the only two questions the tool has to answer, and they are the
  same rows grouped two ways. One canonical structure, two readings — rule 4, visibly.
- **D3's dossier** — summary, commit stream, note box, provenance — happens *in place*
  when a row opens, instead of costing a third pane.
- **D4's typographic authority** in the masthead and the now band, with the band flattened
  from a card to a ruled, flush block.
- **D5's command line**, promoted from a ⌘K modal to a permanent line under the masthead,
  because the advisor is not an accessory. Its answers are **filed into the ledger** with a
  timestamp, their tool calls, and their cost — an answer is a logbook entry, not a chat
  bubble that scrolls away.

One addition that is not from any of them: a **seven-day activity strip** per row. It is
four pixels of chart that tells you whether a branch is being worked or was touched once,
which no chip can.

## Known gaps

- **Filed answers need an ageing rule.** They accumulate at the top of the ledger forever.
  Probably: keep the last few, fold the rest under the quiet rule.
- The Snapshot has no **per-commit file list**, no **which CI job failed**, no **reviewer
  state**. D3 and D6 both have places those would go. All additive to `collect.ts`.
- **Plane B is drawn but not stored.** The note box in D3 and D6 is a real affordance with
  no backing yet.
- The command line is a mock. Typing in D5 shows a thinking state and stops there.
