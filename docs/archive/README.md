# Archive

Superseded material. **Read it for the reasoning, never for instructions** — where any of
it contradicts `../spec/bearing-spec-v0.3.html`, the spec wins.

Nothing here gets deleted. The arguments in these files are why the current decisions
look the way they do.

| Item | What it is | Superseded by | Why |
|---|---|---|---|
| `bearing-spec-v0.1.html` | The original product spec. | `../spec/bearing-spec-v0.3.html` | v0.2 resolved the LLM/agent-autonomy question and cut scope; v0.3 committed to the dashboard. v0.1 still has the clearest statement of the original problem. |
| `workflow-mockups/` | Three interactive workflow paradigms — `terminal.html` (01, terminal-first), `dashboard.html` (02, dashboard-first), `advisor.html` (03, Heading) — plus `ideas.html` (eight organizing ideas), `prototype.html` (a main-interface prototype), and `index.html`, which frames the comparison. | `../design/` | These existed to answer one question: *pulled on demand, or pushed at you? terminal, or visual board?* The answer was **dashboard-first** (decision #9), so they have done their job. `ideas.html` is still worth a browse when Phase 2 starts. |

## The one argument worth re-reading

`workflow-mockups/index.html` puts it well: these were never about visual polish, they
were about feeling out *how you want to work* so the build has a concrete target. All
three run on the same engine and the same brief — they differ only in how you reach it.
That is still the architecture (decision #4), and it is why picking a surface was cheap.
