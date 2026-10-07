# ADR 0007 — Deterministic Scenario Solver: LAW ∩ MISSION, proven or refused

Status: accepted with issue #7.

## Context

Issue #7 computes what may actually be built. LAW says what may happen;
MISSION says what the church refuses to sacrifice; the solver computes the
intersection — and only the intersection. It consumes executable law
exclusively through `selectExecutableConstraints()` (ADR 0006's gate),
missions exclusively through CONFIRMED typed commands (ADR 0005), geometry
exclusively from the accepted GIS commit (ADR 0004), and it returns either a
proven scenario family or an explicit NO VERIFIED SOLUTION with mechanically
proven binding constraints. The dramatic result must emerge from the truth;
the math is never bent to manufacture a demo.

## Decisions

1. **Occupied area is NOT site land consumption.** Philadelphia Code
   §14-202(12) defines occupied area as the aggregate top-view area of
   structures above grade. Parking is therefore modeled as a separate land
   consumer: two distinct constraints are evaluated — OCCUPIED AREA
   (sanctuary + proposed building footprints vs the % allowance) and SITE
   LAND CONSUMPTION (buildings + preserved surface parking + reserved areas
   vs parcel area). Parking is never subtracted from the occupied-area
   allowance, and never added to it.

2. **Three capacity ceilings, proven separately; overall = min.**
   - LEGAL DENSITY CAPACITY — RM-1 tiered minimum lot area per unit.
   - BUILDING/MASSING CAPACITY — developable footprint × floors ÷
     residential gross per unit.
   - PHYSICAL SITE CAPACITY — non-overlapping land use on the computed
     geodesic parcel.
   The overall ceiling is the minimum of the proven ceilings, never a blend,
   and each ceiling is reported so a reader can see which truth binds.

3. **The maximum is proven, never declared.** For the canonical Calvary
   benchmark the solver proves M feasible and M+1 = NO VERIFIED SOLUTION by
   enumeration (today M = 122; 123 is the first impossible target; 70 homes
   is comfortably FEASIBLE and emerges from the same math — it is never
   forced to fail and never hard-coded). If the canonical assumptions or law
   change, M changes, and the regression suite recomputes it rather than
   asserting a constant.

4. **Deterministic bounded enumerator, refused beyond the bound.** The
   feasible lattice is enumerated explicitly: floors 1..floorsCap × parking
   stalls required..required+PARKING_ENUM_SPAN × footprint steps of
   FOOTPRINT_STEP=500 sq ft up to the physical cap. The point count is
   computed BEFORE search and checked against MAX_ENUM_POINTS=250,000;
   exceeding it raises SolveRefusal("UNSUPPORTED_SEARCH") — the solver
   refuses rather than truncate or pretend an optimum. No OR-Tools: the
   lattice is small, the semantics (stepped footprints, mission-locked
   parking floors) are bespoke, and determinism must be byte-level.

5. **Pareto frontier first, labels after.** Non-dominated points maximize
   homes and parking margin and minimize footprint; presentation labels
   (HOUSING MAX / MISSION BALANCE / LOW CHANGE) are attached AFTER frontier
   selection and are never inputs to the math. Tests prove non-domination.

6. **Binding constraints are mechanically proven.** For each candidate
   binding constraint the solver relaxes exactly that limit, RE-SOLVES, and
   reports the capacity delta. Lockable mission rules are never proposed for
   removal; their counterfactuals are phrased "Acrevia did not use that
   alternative."

7. **Assumptions are canonical nodes; certificates pin them.** Five
   assumptions (below) seed into the graph; every ScenarioCertificate's
   dependency closure includes them; missing/inactive/non-positive
   assumptions fail closed. Sensitivity tests prove each numeric assumption
   moves capacity in the predicted direction.

   | id | value | note |
   |---|---|---|
   | assumption:residential-gross-per-unit | 1,200 sq_ft_per_unit | gross residential area per unit |
   | assumption:parking-stall-gross-land-area | 350 sq_ft | stall + circulation land |
   | assumption:story-floor-to-floor-height | 11 ft | floor-to-floor, not clear height |
   | assumption:area-basis-computed-geodesic | qualitative | computed area is the basis; recorded area never substituted |
   | assumption:planning-envelope-uniform-setback | 9 ft | assumption-labeled planning envelope; NOT verified legal setback compliance |

8. **Unknown stays unknown.** Setbacks surface as EXPERT_REQUIRED
   (contextual front) or NOT_EVALUATED (numeric side/rear — lot-line roles
   unclassified); the religious-assembly parking formula is NOT_EVALUATED
   when seat/floor-area inputs are unavailable; the mission's 110-space
   minimum is USER_DECLARED and is never presented as a legal requirement.
   No scenario whose unknowns matter carries VERIFIED_WITHIN_MODED_SCOPE.

9. **Confidence vocabulary.** VERIFIED_WITHIN_MODED_SCOPE /
   ASSUMPTION_SENSITIVE / EXPERT_REVIEW_REQUIRED / NO_VERIFIED_SOLUTION —
   computation states, never evidence states.

10. **Neutral #9 geometry handoff.** `buildGeometryHandoff()` emits
    SolverRegions (parcel-boundary, preserved-structure,
    parking-reservation, proposed-footprint,
    planning-envelope-assumption) tagged with geometryStatus
    (COMPUTED_GEODESIC / ASSUMPTION_DERIVED / UNRESOLVED_BOUNDARY) and
    `legalEnvelopeVerified: false` hard-typed. No renderer, map, or 3D
    concepts cross this boundary; #9 renders and must visually distinguish
    verified legal envelopes from assumption envelopes from unresolved
    boundaries.

11. **Route trust boundary.** POST /api/solver/solve verifies the accepted
    { envelope, receipt } pair, hash-gates the rebuilt base project,
    compiles law exactly as /api/regulatory/compile does, replays the
    mission command log through the typed boundary, seeds assumptions, then
    solves. Statelessness matches /api/mission/state; the client never
    authors project JSON and never sends geometry.

## Consequences

- The 70-home demo story is honest: the solver says 70 is feasible because
  the math says so, and says 123 is impossible because the enumeration
  proved it — with binding-constraint proofs (physical site land, occupied
  area, mission parking) each carrying a re-solve delta.
- Scenario certificates staleness-react to mission and law changes through
  the existing DependencyRef closure; the hero certificate flips STALE when
  the parking mission moves 110 → 130 while an unrelated law-only
  certificate stays CURRENT.
- Enumeration is deliberately coarse (500 sq ft footprint steps, 60-stall
  parking span). A finer lattice raises the point count toward the refusal
  bound; if that becomes the binding limit, the answer is a smarter
  algorithm with the same refusal discipline, never a silent truncation.
