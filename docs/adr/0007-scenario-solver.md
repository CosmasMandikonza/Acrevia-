# ADR 0007 — Deterministic Scenario Solver: LAW ∩ MISSION, modeled truthfully

Status: accepted with issue #7 (revised in the consolidated correction round).

## Context

Issue #7 computes what may actually be built. LAW says what may happen;
MISSION says what the church refuses to sacrifice; the solver computes the
intersection — and only the intersection. It consumes executable law
exclusively through `selectExecutableConstraints()` (ADR 0006's gate),
missions exclusively through CONFIRMED typed commands (ADR 0005), geometry
exclusively from the accepted GIS commit (ADR 0004). The dramatic result
must emerge from the truth — never from discretization, hidden caps, or
presentation labels.

## Decisions

1. **Integer home count is the decision variable — no footprint lattice.**
   For each (homes, floors, parking) triple the solver derives the minimum
   required footprint exactly:

   `requiredFootprint = ceil(homes × grossPerUnit / floors)`

   and tests it against every modeled bound. There is no 500-sq-ft (or any)
   footprint grid, so the modeled bound and the first refused target follow
   the exact area, not a lattice artifact. The exact per-floor maximum is
   `floor(floor(room) × floors ÷ gross)` because `ceil(h·G/F) ≤ R ⇔ h ≤
   floor(R)·F/G` for integer h.

2. **The parking range is derived, never capped.** Stalls enumerate from the
   required floor (max of law fixed requirement and mission minimum) up to
   the derived physical bound `floor((parcel − preserved) ÷ stallArea)` —
   the whole non-preserved site as stalls. That derived range is included in
   the pre-search point count `homes × floors × stalls`; exceeding
   MAX_ENUM_POINTS = 250,000 raises SolveRefusal("UNSUPPORTED_SEARCH").
   The solver refuses rather than truncate or pretend an optimum. (No
   OR-Tools: the lattice is small and the semantics are bespoke; determinism
   must be byte-level.)

3. **One shared capacity primitive.** `attainableHomes(inputs, geometry,
   overrides)` — min of the independently computed ceilings under at most
   ONE relaxed bound — powers the primary solve's modeled upper bound, every
   binding proof, every counterfactual, and the nearest alternatives. A
   constraint binds only if relaxing exactly that one bound increases
   attainableHomes. Candidate relaxations: occupied-area +5pp, height +10ft,
   density uncapped (when density is the minimum ceiling), use prohibition
   lifted (when PROHIBITED), mission parking −20, preserve-structure
   ignored, gross-per-unit −200. Mission-locked relaxations are explanatory
   only and counterfactuals are phrased "Acrevia did not use that
   alternative"; they are never recommended.

4. **Three ceilings, computed INDEPENDENTLY; overall = min.**
   - LEGAL DENSITY CAPACITY — RM-1 tiered minimum lot area per unit.
   - BUILDING MASSING CAPACITY — occupied-area envelope (structures only) ×
     floors ÷ gross per unit. Surface parking land is NOT subtracted here.
   - PHYSICAL SITE AREA-BUDGET CEILING — parcel − preserved structures −
     required parking land, then × floors ÷ gross per unit.
   Each is reported so a reader sees which truth binds; none is copied from
   another.

5. **Pareto frontier over the full modeled space; labels AFTER, by
   documented criteria.** Non-domination is (homes ↑, parking margin ↑,
   footprint ↓). Before the non-domination filter, points collapse per
   (homes, footprint) to the max-margin representative — exact and fast.
   Presentation labels never control generation:
   - Useful set U = frontier points with homes ≥ ceil(max/2) — a presented
     project must still meaningfully advance the housing mission.
   - HOUSING MAX: max homes (ties: max margin, then min footprint).
   - LOW CHANGE: min footprint within U — by construction the
     smallest-footprint displayed scenario.
   - MISSION BALANCE: the Pareto knee within U — the min-max-normalized
     point closest to the ideal corner (max homes, max margin, min
     footprint) — the homes-vs-parking tradeoff without drifting into
     useless extremes.

6. **Occupied area is NOT site land consumption.** Philadelphia Code
   §14-202(12): occupied area = aggregate top-view area of structures above
   grade. Parking is a separate land consumer; it is never subtracted from
   the occupied-area allowance and never added to it.

7. **Area arithmetic does not prove physical placement.** Until #9 places
   actual parking + building polygons and setbacks are classified, the
   solver's language is disciplined: scenarios are "supported within
   modeled scope" (confidence vocabulary: SUPPORTED_WITHIN_MODED_SCOPE /
   ASSUMPTION_SENSITIVE / EXPERT_REVIEW_REQUIRED / NO_VERIFIED_SOLUTION);
   the top of the model is a "modeled upper bound"; the site limit is a
   "physical site area-budget ceiling". A target ABOVE the modeled upper
   bound is safely NO VERIFIED SOLUTION (failure of an optimistic bound
   proves the target cannot fit under the same hard inputs); a target below
   it is supported, not placement-proven.

8. **Multi-family use permission is a required solver precondition.**
   BY_RIGHT → normal solve; SPECIAL_EXCEPTION → conditional pathway: every
   scenario is EXPERT_REVIEW_REQUIRED with an explicit zoning-approval
   professional question; PROHIBITED → modeled bound 0 and NO VERIFIED
   SOLUTION with the prohibition as a single-bound binding proof; missing /
   stale / conflicted → fail closed (the solver never assumes permission).

9. **Assumptions are canonical nodes; certificates pin them.** Five
   assumptions (below) seed into the graph; every ScenarioCertificate's
   dependency closure includes them; missing/inactive/non-positive
   assumptions fail closed; sensitivity is tested.

   | id | value | note |
   |---|---|---|
   | assumption:residential-gross-per-unit | 1,200 sq_ft_per_unit | gross residential area per unit |
   | assumption:parking-stall-gross-land-area | 350 sq_ft | stall + circulation land |
   | assumption:story-floor-to-floor-height | 11 ft | floor-to-floor, not clear height |
   | assumption:area-basis-computed-geodesic | qualitative | computed area is the basis; recorded area never substituted |
   | assumption:planning-envelope-uniform-setback | 9 ft | assumption-labeled planning envelope; NOT verified legal setback compliance |

10. **Production scenarios are recorded.** `recordSolverScenarios(ctx,
    solveResult)` records every displayed scenario through the EXISTING
    recordScenario command with stable ids derived from a digest over the
    certificate-closure inputs plus the selected point. Replaying identical
    solve state reuses the same ids (idempotent in the user-visible current
    head); changed law/mission/assumption state produces a new id while the
    old certificate goes STALE through the normal closure machinery. The
    API returns scenario id, certificate id, and freshness per displayed
    scenario; the browser journey asserts the visible certificate is
    CURRENT.

11. **Unknown stays unknown.** Setbacks surface as EXPERT_REQUIRED
    (contextual front) or NOT_EVALUATED (numeric side/rear — lot-line roles
    unclassified); the religious-assembly parking formula is NOT_EVALUATED
    when seat/floor-area inputs are unavailable; the mission's 110-space
    minimum is USER_DECLARED and never presented as a legal requirement.

12. **Neutral #9 geometry handoff.** `buildGeometryHandoff()` emits
    SolverRegions (parcel-boundary, preserved-structure, parking-reservation,
    proposed-footprint, planning-envelope-assumption) tagged with
    geometryStatus (COMPUTED_GEODESIC / ASSUMPTION_DERIVED /
    UNRESOLVED_BOUNDARY) and `legalEnvelopeVerified: false` hard-typed. No
    renderer, map, or 3D concepts cross this boundary.

13. **Route trust boundary.** POST /api/solver/solve verifies the accepted
    { envelope, receipt } pair, hash-gates the rebuilt base project,
    compiles law exactly as /api/regulatory/compile does, replays the
    mission command log through the typed boundary, seeds assumptions,
    solves, and records. Statelessness matches /api/mission/state; the
    client never authors project JSON and never sends geometry.

## Canonical Calvary truth (computed by the corrected solver)

Fixture geometry: legal density 249, massing 145, physical area budget 123,
**modeled upper bound 123 homes** (was 122 under the removed 500-sq-ft
lattice — a discretization artifact). 70 homes is supported within modeled
scope; **124 is the first refused target**. The regression tests recompute
these numbers; nothing is hard-coded into the solver.

## Consequences

- The 70-home story and the 124 refusal both emerge from exact integer-home
  arithmetic; changing any assumption or law moves the bound continuously.
- Enumeration cost is linear in the modeled space; the (homes, footprint)
  reduction before non-domination keeps the frontier exact and fast. If the
  derived space ever exceeds the explicit bound, the answer is a refusal,
  never a silent cap.
- Scenario certificates staleness-react to law, mission, AND assumption
  changes through the existing DependencyRef closure; unrelated law-only
  certificates stay CURRENT.
