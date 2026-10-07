# Impact Metrics

Definitions of everything Acrevia is allowed to claim numerically during the
hackathon, how each number is produced, and which evidence-log fields back it.
**Every number has a current value of NOT MEASURED until a logged session
produces it.** Vague "AI saves time" claims are banned.

Naming rule (maintainer review, PR #27): the product today has no solver-backed
feasibility — compiled law, typed constraints, and scenario reasoning belong to
issues #5 and #7 — so the timing metric below is named **address → accepted
property snapshot** and nothing in this kit calls today's output feasibility.
When #5/#7 land, a **new, versioned** metric for address → preliminary
feasibility snapshot is added here; IM-1 is never redefined or silently reused,
and numbers across metric versions are never compared.

## The metrics

| ID | Metric | Definition | Instrument | Current value | Ladder rung |
| --- | --- | --- | --- | --- | --- |
| IM-1 | Minutes, address → accepted property snapshot | M1 (T0 resolve click → T1 property accepted), pre-warmed server, capture mode labeled. Report median + range over N runs, never best-of. Not a feasibility claim — see naming rule above. | property-test protocol M1 | NOT MEASURED | 4 (use), 6 (useful) |
| IM-2 | Minutes, mission constraints → confirmed model | M2 (interpret submitted → all rules confirmed, revision advanced). | M2 | NOT MEASURED | 4 |
| IM-3 | Share of consequential rules with authoritative provenance | count of rules whose source tier is adopted-code/official-GIS/official-reference ÷ total consequential rules shown, per property run. Report per property; pool only with capture modes labeled. | M3 + benchmark evidence states | computable from canonical fixture only (benchmark: 27 rules, 13 sources) — participant-observed variant NOT MEASURED | 4 |
| IM-4 | Expert-review questions surfaced rather than guessed | M4 count of UNKNOWN / EXPERT REQUIRED / open items visible at snapshot (canonical fixture has 14 open questions). | M4 | NOT MEASURED | 4 |
| IM-5 | Scenarios compared per session | count of scenarios participant compared. **Requires scenario engine (#7) — not yet measurable; do not project.** | future | NOT MEASURABLE YET | 4–6 |
| IM-6 | Real properties analyzed end to end | count of distinct properties with a complete logged run. | session records | 0 (target ≥1, preferably 2–3) | 4, 6 |
| IM-7 | User comprehension | M5 rubric distribution per probe (report full distribution; a mean alone hides failures). | M5 | NOT MEASURED | 4, 6 |
| IM-8 | User trust | M6: states noticed unprompted + independent-verification intent + rating with reason. | M6 | NOT MEASURED | 4, 6 |
| IM-9 | User usefulness | M7 rating with useful-for reason. | M7 | NOT MEASURED | 6 |
| IM-10 | Professional usefulness | same as M7 for professional-side sessions, plus handoff verdict (§7 of professional guide). | professional guide | NOT MEASURED | 6 |
| IM-11 | Interviews where feedback caused a material product change | count of sessions with ≥1 linked PC-### ÷ total sessions. Report numerator/denominator, never a bare percentage. | evidence log PC entries | 0/0 | 5 |
| IM-12 | Board/professional forward action | M8 classifications; **stated (rung 7) and observed (rung 8) reported as separate numbers, never merged.** | M8 + follow-through records | stated 0 · observed 0 | 7, 8 |
| IM-13 | Pilot / design-partner interest | count of participants meeting pilot/design-partner criteria (README vocabulary). Authentic only. | evidence log relationship levels | 0 | 9 |
| IM-14 | Time to board/council-ready artifact | minutes to produce a board-ready artifact from the accepted project. **Requires Council surface — not yet measurable; do not project.** | future | NOT MEASURABLE YET | 6 |

## Housing-capacity rule

Potential housing capacity (units) may be shown **only** when computed from
real properties with explicit, listed solver assumptions, and must be labeled
preliminary. No unit number from a roadmap mockup may ever appear next to a
real property. If a judge asks for units and none are computed, the answer is
"we have not computed units yet; here is what computing them requires."

## Banned claims

- "Acrevia ends homelessness" / "saves lives".
- "Acrevia created/produced housing" — no housing exists that Acrevia caused.
- "Acrevia replaces architects / planners / attorneys / developers / lenders /
  feasibility studies".
- "Churches love it" / "users are amazed" — no adjectives in place of numbers.
- Any percentage or duration without an evidence-log ID.
- "Partner" language for anyone below design-partner criteria
  (see `pitch-evidence-rules.md`).

## The standing direct-impact sentence

The direct impact claim, per Issue #20, remains exactly:

> Acrevia helps faith communities move potentially viable housing projects
> from conviction to a credible first development decision.

Any stronger sentence requires rung-6-or-above evidence recorded in the
evidence log first, and a matching update to `pitch-evidence-rules.md`.

## Pitch-sentence shape (to be filled from real data only)

Issue #20's target payoff has this shape. It is a **format**, not a draft —
every bracket is filled from a logged entry or the sentence is not used:

> "We tested Acrevia with [real roles, from S-ids]. On a real church property
> ([property, with consent]), a user went from an address to [measured output]
> in [measured time, IM-1]. A [role] challenged [specific weakness,
> OBJ-id], so we changed [specific product change, PC-id]."

The `[measured output]` bracket is filled with what was actually measured —
today, the **accepted property snapshot** (IM-1). "Feasibility snapshot" may
appear there only after the versioned post-#5/#7 feasibility metric exists and
was measured. If any bracket is empty at pitch time, the sentence is shorter —
not invented.
