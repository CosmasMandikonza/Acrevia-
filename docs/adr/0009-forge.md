# ADR 0009 — Forge: the interactive 3D legal + mission development twin

Status: accepted with issue #9.

## Context

Issues #7 (deterministic solver) and #8 (R3F engine behind the
`SpatialSceneModel` boundary) are merged. #9 is the convergence point: the
spike's fixture truth is replaced by the live pipeline — accepted signed
property → verified Development Graph → Regulatory Compiler gate →
confirmed Mission command log → solver → Scenario + ScenarioCertificate →
#7 SolverGeometryHandoff area truth → #9 deterministic conceptual placement
→ SpatialSceneModel → R3F renderer (plus the deterministic SVG plan
fallback). The renderer never gains a regulatory inference; a component
constant can never produce a feasibility result.

## Decisions

1. **`POST /api/forge/scene` mirrors the solver route's trust discipline,
   deliberately isolated.** Verify the accepted `{ envelope, receipt }`
   pair → rebuild the committed base project and SHA-256 hash-gate it →
   multi-parcel/district guards → compile law from the captured corpus
   exactly as `/api/regulatory/compile` does → replay the client mission
   command log through the typed boundary → seed assumptions → `solve()` →
   `recordSolverScenarios()` → derive the scene server-side. The
   orchestration lives in `src/application/forge/build-forge-scene.ts`; the
   solver route was NOT refactored (no shared helper — duplication over
   coupling, byte-equivalence of solver behavior is by construction since
   both call the same `solve`/`recordSolverScenarios` and is regression-
   tested in `tests/forge/scene.test.ts`). The client may select an
   existing scenario or change a mission value (through the typed mission
   route, never through this one); it never authors geometry, zoning,
   parcel identity, solver results, or certificates.

2. **Scenario → spatial placement is a deterministic, mechanically
   validated construction** (`src/adapters/spatial/forge-placement.ts`).
   #7 hands Forge AREA truth (exact footprint budget, floors, height,
   stalls) and deliberately null shapes. Forge runs a frontage-aligned
   strip sweep (bar depths 72/56/44/32 ft tried in fixed order) inside the
   mission planning envelope, bisection-trimming the final bar so the
   AGGREGATE area equals the exact #7 budget; a whole-region trim is the
   fallback for fragmented envelopes. Every emitted polygon is validated:
   finite rings, positive area, fully inside the allowed region, clear of
   every preserved structure, aggregate area within ±1 sq ft, height ≤ the
   modeled cap. Anything unprovable is `UNRESOLVED` — never a plausible
   shape. Same state ⇒ byte-identical placement (no randomness, no
   wall-clock, quantized sweeps).

3. **Parking is all-or-nothing and area-gated.** Before any search, a
   lower-bound area check proves impossibility when it can: each stall in
   ANY bay layout needs ≥ 9 ft × (18 ft + half of the shared 24 ft aisle) =
   270 sq ft of ground; if `stalls × 270` exceeds the envelope-minus-
   building ground, the plan refuses instantly with the arithmetic (the
   canonical case: 110 stalls need ≥ 29,700 sq ft; 10,128 sq ft remain).
   Otherwise a deterministic multi-field sweep (1–4 row bays, four
   orientations, 12 ft grid, exact-count preference) places fields with
   stall polygons and explicit aisles; it validates exact stall count,
   region containment, sanctuary/building clearance, and pairwise field
   disjointness, and REFUSES (bounded candidate search, 6,000 blocks —
   the same explicit-bound discipline as the solver's `MAX_ENUM_POINTS`)
   rather than truncate. A produced layout is labeled ASSUMPTION_DERIVED
   PLANNING LAYOUT — never legal parking approval. On the canonical
   Calvary flow all three scenarios are PARTIAL: massing placed, parking
   honestly UNRESOLVED.

4. **The 123-home bound stays an area statement, not architecture.**
   HOUSING MAX 123 places its exact 49,200 sq ft footprint (8 validated
   bar volumes × 33 ft) but grades `PARTIAL` — "MODELED UPPER BOUND STANDS,
   PLACEMENT NOT FULLY PROVEN" — because the 110-stall parking cannot be
   placed inside the planning envelope. The HUD distinguishes PLACED /
   PARTIAL / UNRESOLVED per scenario; nothing green claims more than it
   proved. 124 renders the NO VERIFIED SOLUTION ghost: rust, dashed,
   NOT BUILDABLE, with the mechanically proven binding constraints and the
   nearest supported alternatives selectable back to the frontier.

5. **Chained boolean geometry is snap-rounded.** Consecutive
   clip/difference ops accumulate float error that can break
   polygon-clipping's ring completion; every boolean in the Forge path
   snaps vertices to 1e-4 ft first, and residual failures degrade toward
   the honest direction (no overlap / no fit → UNRESOLVED), never toward
   fabricated geometry (`safeIntersection` / `safeDifference`).

6. **Mission-edit → recompute is a visible trust sequence.** The Forge
   mission panel edits Sunday parking through the canonical typed slot
   (`mission:min-sunday-parking` — the sentence flow's id, so the value
   UPSERTS the same constraint and advances its revision). The command
   goes to `/api/mission/state` FIRST; only after the typed boundary
   accepts it is the client log written and the scene refetched. The old
   scene shows `STALE — RECOMPUTING` immediately, then the replacement
   carries NEW scenario ids with CURRENT certificates while the old
   certificate grades STALE in-graph (regression-tested), and the HUD
   names the superseded certificate explicitly.

7. **Freshness fingerprint.** The response carries a SHA-256 digest over
   `{projectId, envelopeSignature, mission semantic state (id + revision +
   semanticHash, sorted), solverVersion, targetHomes}` — never timestamps.
   The client compares fingerprints across fetches; a changed mission
   state changes the digest and flips the display STALE before the new
   scene arrives.

8. **Proof deep-link contract (fixed with #11).** Every inspectable
   element links via URLSearchParams to
   `/workspace?view=evidence&focus=<nodeId>&scenario=<ScenarioId>&certificate=<CertificateId>`
   (plus `address` for workspace binding — additive). The certificate
   badge, scenario volumes, envelopes, sanctuary, and parking fields carry
   real Development Graph node ids from the adapter's provenance arrays;
   the receiver is #11's Evidence UI. No second evidence store exists.

9. **The production renderer is new code under `src/components/forge/`
   consuming ONLY the SpatialSceneModel** — the spike files are untouched
   and `/forge-spike` remains spike surface. Improvements over the spike:
   floor-band massing (stories read at a glance), a ground grid for scale,
   calmer 1050 ms camera tweens that snap to the exact saved pose,
   `prefers-reduced-motion` instant snaps, a draggable before/after reveal
   via world-x clipping planes (existing structures left, selected
   scenario right), per-scenario parking fields, and the STALE desaturation
   treatment. The renderer isolation test now greps BOTH
   `src/spatial/renderer` and `src/components/forge` (imports from
   domain/adapters/commands/application, regulatory vocabulary, or solver
   calls fail the build). Styling is a CSS module
   (`src/components/forge/forge.module.css`) — globals.css is untouched.

10. **`SpatialSceneModel` extended additively (v1 kept).** New OPTIONAL
    fields: `ScenarioPlacement`, per-scenario `ParkingPlanScene`,
    `freshness`, `confidence`, `point`, `SavedCamera.transitionMs`,
    `modeled` ceilings context, and `refusal` for NO VERIFIED SOLUTION
    scenes. The spike model is unchanged; the schema version stays
    `acrevia.spatial.scene.v1` because every change is optional-shape
    additive.

## Canonical Calvary results rendered (live pipeline)

| Scenario | Point | Massing | Parking | Placement grade |
| --- | --- | --- | --- | --- |
| HOUSING MAX | 123 homes · 3 floors · 49,200 sq ft · 110 stalls | 8 validated bars × 33 ft | UNRESOLVED (needs ≥ 29,700 sq ft; 10,128 remain) | PARTIAL |
| MISSION BALANCE | 83 homes · 3 floors · 33,200 sq ft · 156 stalls | 6 validated bars | UNRESOLVED | PARTIAL |
| LOW CHANGE | 62 homes · 3 floors · 24,800 sq ft · 180 stalls | 3 validated bars | UNRESOLVED | PARTIAL |
| Requested 124 | — | rust ghost (CONFLICT) | not attempted | REFUSED (modeled upper bound 123) |

Modeled ceilings: legal density 249 / massing 145 / physical area budget 123
→ upper bound 123; 124 is the first refused target. Scene build ≈ 400 ms
server-side (dev), byte-deterministic (canonical JSON equal across
rebuilds).

## Consequences

- `/forge` is a full client page over the accepted-property trust model
  (WebGL probe → R3F, `?fallback=1` or no WebGL → the SVG plan); the page
  ships a server loading shell only (no hydration mismatch, no
  sessionStorage reads during SSR).
- The scenario solver surface gains "Open in Forge ↗" per scenario
  (`/forge?scenario=<id>`) — the only change outside Forge-owned paths.
- Determinism is test-enforced: same project/mission state ⇒ identical
  canonical-JSON scene, identical placement JSON, identical cameras.
- Deferred: #11 receives the deep-links (focus/scenario/certificate
  params); #13 Council can consume `model.cameras` as saved views;
  multi-parcel campuses, map-context toggle, structured/podium parking
  models, and production asset bundling for standalone deploys remain
  open. The parking planner's rectangular-bay vocabulary is deliberately
  conservative — a real parking design is an architect's job; Forge only
  proves or refuses a concept.
- No new dependencies (three / @react-three/fiber / drei /
  polygon-clipping were already merged via #8).
