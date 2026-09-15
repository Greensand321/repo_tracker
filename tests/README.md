# Tests

Empty until Phase 0 starts. The plan (`docs/plans/phase-0-plan.md` §10) fixes the shape:

| File | Covers |
|---|---|
| `fixture_builder.py` | Deterministic scratch repos with commit dates pinned via `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`. **Write this first** — everything else tests against it. |
| `test_analyze_branch.py` | Flag rules at their exact boundaries (6.99 vs 7.01 days), the activity model, conflict-risk intersect, timezone mixing |
| `test_prioritize.py` | Ordering and tie-breaking |
| `test_nextstep.py` | Rule order — first match wins |
| `test_render_markdown.py` | Golden files; regenerating requires an explicit flag |
| `test_integration.py` | CLI as a subprocess against a fixture repo → parse JSON → assert section assignment |
| `test_perf.py` | 4 repos × 12 branches × 30 commits in < 5 s. Marked slow. |

The fixture builder must produce, deliberately: a dirty working tree, a stash, a merged
branch, a branch 21 commits behind (diverged), two branches touching the same files
(conflict-risk), a `dependabot/x` branch (to prove exclusion), a branch whose tip commit is
old but whose *checkout* is recent, and commits at mixed UTC offsets (`+02:00`, `−07:00`).

Two tests are load-bearing — they encode the invariants the whole product rests on:

- **Read-only.** Run the full pipeline, then assert `git status --porcelain` is unchanged
  and no new refs or stashes exist in the fixture repos.
- **Activity model.** A branch with an old tip commit but a recent checkout ranks by the
  checkout time. Checkouts land in *HEAD's* reflog, not the branch's — this is the subtlety
  most likely to be got wrong.
