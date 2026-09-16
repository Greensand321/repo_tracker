# Spec

`bearing-spec-v0.3.html` — **the canonical product spec.** Open it in a browser.

It is the top of the precedence order: where any other document disagrees with it, the
spec wins. Earlier revisions live in [`../archive/`](../archive/README.md).

Quick index: overview (§1) · problem (§2) · goals and non-goals (§3) · core concepts,
branch state, the Brief, parking notes, naming (§4) · data sources (§5) · **phases (§6)**
· data model (§7) · architecture (§8) · LLM usage and cost (§9) · privacy (§10) ·
configuration (§11) · CLI surface (§12) · delivery and stack (§13) · **mockups, including
the three dashboard views (§14)** · success metrics (§15) · rollout (§16) · open
questions (§17) · **heuristics and default thresholds (§18)**.

§18 is the one to keep open while implementing flags — it is the source for every
threshold, and it records which heuristics were *removed* and why.
