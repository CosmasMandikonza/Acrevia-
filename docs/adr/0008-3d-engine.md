# ADR 0008 — Forge 3D engine: deterministic in-app React Three Fiber, with a professional-export boundary for later

Status: proposed with issue #8 (spike; awaiting review — do not merge unreviewed).

Note: issue #8 originally named this document `docs/adr/004-3d-engine.md`; ADR
numbering moved to four digits before the spike ran (0003–0007 exist), so it
lands as `0008-3d-engine.md`.

## Outcome and scope

Issue #8 spikes the engine for Acrevia Forge (#9): the 3D layer where law and
mission must visibly shape what can be built. This ADR records what was
actually built and measured, the alternatives investigated from official
documentation, and the recommendation.

The spike delivers a working proof at `/forge-spike` on the canonical Calvary
benchmark: Development Graph + mission + scenario state → `SpatialSceneModel`
→ React Three Fiber renderer, with four moments (Existing / Legal / Mission /
Scenario), four deterministic saved cameras, envelope clipping, parking
reservation, a refused-mass state, click-to-provenance, a derivation drawer,
and a deterministic SVG plan fallback. No protected contract was modified:
Scenario/Constraint/certificate schemas, solver, regulatory compiler, mission
compiler, and Development Graph core are untouched (all changes are additive
under `src/spatial/`, `src/adapters/spatial/`, `src/app/forge-spike/`,
`tests/spatial/`, one e2e spec, CSS appended to globals.css, and dev
dependencies).

## The decision

**Choose in-app React Three Fiber / Three.js as Forge's engine (option A),
built strictly behind the `SpatialSceneModel` adapter boundary, and treat
professional-tool integration (option C) as a future export path — not a
demo dependency.** Snaptrude (option B) is rejected as the engine because it
cannot be embedded in Acrevia, cannot be driven from outside its own app, is
cloud-only, and its only server-facing API is an Enterprise-tier,
undocumented line item — all fatal for a stage demo that must render the
canonical truth when the network or a vendor dies.

## Alternatives investigated

### B. Snaptrude (official documentation, verified 2026-10-07)

- **No public REST/GraphQL API.** The only public developer surface is the
  in-app Plugin API (`snaptrude.*` RPC namespace), documented at
  docs.snaptrude.com/plugin-api.html. Plugins are React+Vite apps running
  INSIDE Snaptrude's Plugin Builder iframe; an external program cannot drive
  a Snaptrude scene over the network.
- **The plugin CAN deterministically build massing** — `design.create.space/
  mass/spaces` (bulk, ≤1000 items), and notably `design.create.buildableEnvelope(
  sitePolygon, lengthUnit, setbacks, verticalCap, floorToFloor, farRatio?,
  lotCoverageMaxPct?)` — a zoning-envelope generator. Signatures verified
  first-hand on docs.snaptrude.com/plugin-api/design/create.html.
- **No embedding**: no iframe/SDK for putting a Snaptrude scene inside a
  third-party app is documented anywhere; whitelabel is "planned" roadmap
  language on the App Builder (private-beta, invite-code) page.
- **Cloud-only**: help-center docs require org IT to whitelist Snaptrude
  service APIs for the app to load; no offline mode is documented.
- **Licensing** (snaptrude.com/pricing, verified): Free = 3 projects, single
  user, limited presentation outputs; Individual $60/mo; Organization
  $100/mo; **"Open API access" appears ONLY at Enterprise (custom pricing)
  and is undocumented** — what that API is, its auth, and its endpoints are
  not public.
- **Exports**: plugin API can export GLB/OBJ/FBX and presentation PNG/PDF;
  IFC/Revit/DWG exports are fire-and-forget SERVER jobs whose bytes cannot
  be retrieved via API. AI renders draw on the user's AI quota.
- **Operational caps**: 60 s per server-backed call, one CAD import job at a
  time, >100 MB imports rejected — fine for design work, uncomfortable for a
  timed demo.

### Competitors (official sites, brief)

- **Autodesk Forma**: real public HTTP APIs (APS Forma, Site Design API in
  beta) including an Integrate API that can create elements with geometry;
  OAuth app + tokens; free developer tier. Cloud compute with quotas — same
  demo-fatalities as Snaptrude (network, auth, latency) plus heavier
  integration work.
- **TestFit**: no public API or scripting documented (integrations page:
  MCP, Revit add-in, file exports).
- **Finch**: no public API documented; algorithmic control via
  Rhino/Grasshopper plug-ins.

### A. In-app React Three Fiber / Three.js (spiked — the rest of this ADR)

Everything renders from Acrevia state inside the app, offline, with
sub-second loads and 60 fps on integrated laptop graphics.

### C. Hybrid (spiked as a boundary, not a vendor integration)

The spike implements the part of the hybrid that matters now: Forge renders
the deterministic truth itself, and the `SpatialSceneModel` is a pure-data
contract from which professional hand-off (GeoJSON feet polygons + heights →
DWG/IFC/GLB → Snaptrude/Revit import, or a Snaptrude plugin that replays
`buildableEnvelope` + `create.mass` from an Acrevia export) can be built
AFTER the hackathon without touching the renderer. Spending spike time on
live vendor plumbing now would buy demo risk, not capability.

## What the proof actually renders (canonical benchmark)

All numbers derived from the graph at request time (server component, fixed
clock; nothing hard-coded in React):

| Derivation | Value |
| --- | --- |
| Parcel (PWD polygon, projected to local feet at ring centroid) | 119,300 ft² computed vs 119,295 recorded |
| Sanctuary (BIN 1282177 footprint + `approx_hgt` claim) | 31,273 ft², 29 ft, PROTECTED |
| Frontage | edges within 60 ft of the published address point (orientation only — hint never geometry) |
| Setback envelope (side 5 ft range-min, rear 9 ft numeric, front contextual → no plane) | 114,413 ft² (95.9%) |
| Legal envelope (occupied-area cap 75%, intermediate-lot conservative, trimmed 208 ft from the Roosevelt frontage) | 89,475 ft² × 38 ft |
| Parking (canonical mission min 110 stalls) | honestly UNRESOLVED — no deterministic rectangular field fits beside the preserved sanctuary (2–6 rows searched along every frontage); nothing faked, nothing subtracted; solver #7 owns the parking design |
| Mission envelope (legal − sanctuary; canonical flow has NO mission height cap) | derived at request time; verification ASSUMPTION_DERIVED |
| Envelope verification (PR #30 review truth label) | `legalEnvelope.verification = "ASSUMPTION_DERIVED"` — edge-role geometry is a visualization heuristic; the 38-ft height and 75% occupied-area remain sourced law |
| Scenario setback results (PR #30 review truth label) | front EXPERT_REQUIRED; side/rear NOT_EVALUATED (lot-line roles unclassified in trusted state) |
| Scenario A "24 homes" (graph status COMPUTED; HYPOTHETICAL SPIKE FIXTURE label) | north bar + east wing, 28 ft, VALID |
| Scenario B "optimistic tower" (graph status REFUSED, height VIOLATED 45 > 38; HYPOTHETICAL SPIKE FIXTURE label) | rust ghost, dashed, "NOT BUILDABLE" |

Four saved cameras (aerial / church entry / pedestrian / neighbor) are
computed from parcel bbox, sanctuary centroid, and frontage normal — exact
poses asserted in vitest; switching tweens 950 ms with an ease-in-out curve
and SNAPS to the exact saved pose (determinism), then OrbitControls take
over.

## Truth labels (added in the PR #30 review round)

The maintainer approved the engine decision and required the spike to be
unable to masquerade as canonical feasibility truth. Changes:

1. **Canonical mission flow only.** The bootstrap confirms exactly
   preserve-sanctuary + min-parking **110** + retain-ownership — the
   canonical Calvary USER_DECLARED flow (matching #7). The invented 28-ft
   mission height cap is REMOVED; the mission envelope now clips only the
   preserved sanctuary at the legal height.
2. **Honest setback statuses.** Fixture scenario results no longer claim
   SATISFIED setbacks: front is EXPERT_REQUIRED (contextual + unclassified),
   side/rear are NOT_EVALUATED (lot-line roles are not classified in
   trusted state). Height and occupied-area keep their sourced evaluations.
3. **Envelope verification status.** `SpatialSceneModel` gains
   `EnvelopeVerification = VERIFIED | ASSUMPTION_DERIVED | UNRESOLVED` on
   every envelope. This spike's envelope is `ASSUMPTION_DERIVED`: the 38-ft
   height max and 75% occupied-area cap are sourced law, but the
   frontage/rear edge-role classification that shapes the polygon is a
   visualization heuristic. UI, legends, selection cards, and this ADR say
   "planning envelope — assumption-derived", never "verified legal
   envelope".
4. **Scenario massings are HYPOTHETICAL SPIKE FIXTURES.** Graph labels,
   solverVersion strings, the fixture description, and the HUD say so
   explicitly. They are synthetic visual test inputs — never canonical user
   decisions, never pitch or user evidence.
5. **110-stall parking is honestly UNRESOLVED.** The deterministic
   rectangular first-fit (2–6 rows along every frontage edge) cannot place
   110 stalls without overlapping the preserved sanctuary inside the
   setback strips. The requirement stands; the spike renders no fake field
   and subtracts nothing — solver #7 owns the parking design (podium,
   structured, or multi-field).

## Measurements (this host, 2026-10-07)

- **Server scene derivation** (benchmark→graph→model incl. boolean ops):
  ~80–240 ms warm; 883 ms on a cold fs read. Displayed live in the HUD.
- **Production load** (nav → first rendered frame, `next start`):
  **0.88–1.03 s on GPU** (headed Chrome, Intel UHD 615 / D3D11);
  4.0–5.7 s under SwiftShader software rendering in headless (WebGL init
  dominates; scene then renders correctly at 1–2 fps).
- **Frame rate**: 60 fps GPU-headed at 1512×982 with 2048 shadow map, ACES
  tone mapping, dpr up to 2. 1–2 fps SwiftShader (correct, slow).
- **Layer legibility** (pixel deltas at judge viewport, aerial, after the
  truth-label round): existing→legal 21.0%, legal→mission 4.4% (the
  canonical mission now clips only the sanctuary — no invented cap or
  parking field to remove), mission→scenario 12.9%, valid→refused
  scenario 6.9% (localized to the mass region). Every story beat visibly
  changes the scene.
- **Offline**: with every non-localhost request aborted, the page renders
  the full scenario moment and the spec asserts ZERO external requests were
  even attempted (no CDN fonts, HDR environments, tiles, or APIs).
- **Determinism**: building the model twice yields identical canonical-JSON
  SHA-256 (vitest); rebuilds with a different project clock change nothing.
- **Tests** (after the truth-label round): 299/299 vitest (290 pre-existing
  + 9 new: 8 adapter incl. canonical-mission, honest-setback-status, and
  envelope-verification regressions, 1 renderer isolation); 6/6 e2e on the
  production build (moments, camera determinism, statuses +
  HYPOTHETICAL SPIKE FIXTURE labeling, provenance card, derivation drawer,
  offline-blocked, SVG
  fallback). `npm run check` green; lint clean under the repo's react-hooks
  v6 rules.

## Capability matrix

| Criterion | A. R3F in-app (spiked) | B. Snaptrude | C. Hybrid (export later) |
| --- | --- | --- | --- |
| Visual fidelity (massing-grade) | high — ACES, soft shadows, token palette; no raytrace | highest out of the box | A now, B's renders later |
| Deterministic geometry control | total (adapter owns every polygon) | total inside plugin; unreachable from Acrevia | total on Acrevia side |
| React integration | native (R3F v9 / React 19 / Next 16 verified) | none (no embedding documented) | native + export |
| Parcel/GeoJSON support | yes (WGS84 in, local-ft ENU out) | via Mapbox terrain/import; no site API from outside | A's pipeline + vendor import |
| Clipping/envelope visualization | yes (boolean ops + ghost clips, proven) | `buildableEnvelope()` in-plugin | A now |
| Camera quality | 4 derived saved views + orbit; deterministic snap | presentation views in-app | A now |
| Annotations | HUD + in-scene badges from model strings | in-app tools | A now |
| Screenshots/export | PNG (e2e-proven); GLB/DWG/IFC exportable from model | PNG/PDF/GLB via plugin; IFC/RVT server jobs | the actual point of C |
| Latency | 0.9–1.0 s load (GPU), 60 fps | network + auth + app boot; 60 s server-call caps | A's numbers |
| Offline/cached reliability | fully self-hosted (e2e-proven) | cloud-only; IT whitelist required | A's reliability |
| Vendor dependency | three.js (MIT) | Snaptrude account + cloud | A + optional B |
| API/auth friction | none | plugin login; Enterprise-only "Open API" | A none; B later |
| Licensing | MIT libs; no keys | Free 3 projects; "Open API" Enterprise-only | A MIT; B per above |
| Implementation time | 1 spike (done) | days + review-published plugin; still not embeddable | + days after #9 |
| Demo failure risk | WebGL death → SVG plan fallback (tested) | vendor/network/auth death mid-demo | A's risk profile |
| Stage-machine performance | 60 fps on integrated GPU | depends on venue network | A's profile |

## Deterministic state mapping (the contract)

`Development Graph + Scenario massing → buildSpatialScene() →
SpatialSceneModel → renderer(s)`. The renderer imports nothing from
`src/domain`, `src/adapters`, or `src/commands`, and contains no regulatory
vocabulary — enforced by `tests/spatial/isolation.test.ts` (grep-based
boundary test). The model (`src/spatial/scene-model.ts`,
`acrevia.spatial.scene.v1`) carries: unit + frame (WGS84 anchor), parcel
polygon + areas + provenance, structures (footprint, height, protected flag),
frontage (edges + street label + derivation), legal envelope (multi-part
polygons, height, setbacks with applied/range/contextual semantics, binding
notes, provenance), mission envelope + clips (from/to elevations, mission
constraint ids), parking field (stall geometry + requirement), scenarios
(graph status + certificate id + metrics + volumes with VALID/CONFLICT/
PROTECTED/UNRESOLVED statuses + statusDetail), height plane, annotations,
saved cameras, and a derivationNotes audit trail. Every visible volume
carries Development Graph node ids for click-to-evidence.

Honest-gap semantics are part of the contract: contextual setbacks render no
plane (front stays at the parcel line with an explicit note), lot type is
absent from the graph so the occupied-area cap uses the conservative
intermediate percentage, and any underivable value surfaces as UNRESOLVED
rather than a guessed number.

## Failure modes and stage fallback

1. **WebGL unavailable** (venue browser policy, dead driver): the page
   detects the failure and renders the SAME model as a deterministic SVG
   plan (parcel, sanctuary, envelopes, parking, masses, statuses) — tested
   e2e (`?fallback=1` forces it).
2. **Slow software rendering** (SwiftShader): scene renders correctly at
   1–2 fps; demo can continue on the fallback plan or a GPU machine.
3. **Network death**: nothing external is loaded — asserted by blocking
   every non-localhost request in e2e (zero attempts).
4. **Cold-route compile**: solved by running the production build on stage
   (this spike's numbers are production numbers).
5. **Fixture-path dependency**: the server component reads
   `docs/benchmarks/...` from `process.cwd()` — fine for `next start`; a
   standalone deployment must bundle the pack (noted for #9).

## Visual proof limitation (kept prominent per the PR #30 review)

The ENGINE and PATH are proven: deterministic state mapping, offline
self-hosting, production-build performance, fallback behavior, and layer
legibility are measured above. Forma/Snaptrude-level final aesthetics are
NOT proven: direct visual inspection was unavailable in the spike
environment, so visual QA was programmatic (pixel deltas, color
signatures, DOM assertions), and the screenshots in
`docs/reviews/issue-8/` await human review. **#9 owns the final art
direction and polish** — camera choreography, materials, and typography to
the Design Constitution's bar.

## Final recommendation

Build #9 Forge on **in-app React Three Fiber behind the existing
`SpatialSceneModel` boundary**, ship the SVG plan fallback with it, and keep
the professional-export path as a post-hackathon extension through the same
model (option C's plumbing, none of its demo risk). Do not adopt Snaptrude
as the engine: its strengths (in-plugin determinism, BIM exports) are real
but unreachable from an external app on a hackathon timescale, and its
cloud-only, Enterprise-gated API surface is precisely the kind of dependency
the winning standard forbids for the live demo.

## Exact contract #9 should implement

1. **Consume `src/spatial/scene-model.ts` as-is** (`acrevia.spatial.scene.v1`).
   Extend it (camera transitions config, scenario comparison views,
   before/after states) rather than forking it; bump the version if fields
   change shape.
2. **Truth-source hierarchy (per the PR #30 review)**:
   - **PR #29's `geometry-handoff.ts` is the SOLVER TRUTH SOURCE.** #9
     consumes #7's neutral handoff as source truth for scenario geometry —
     it is NOT integrated into this spike.
   - **`SpatialSceneModel` is the RENDERER ADAPTER TARGET.** #9 maps
     solver-handoff output (plus graph state) into the scene model through
     an adapter like this spike's; the renderer never sees anything else.
   - **The spike massing fixture
     (`src/adapters/spatial/fixtures/forge-spike-massing.json`) is a VISUAL
     TEST FIXTURE ONLY** — synthetic renderer inputs, never the canonical
     solver-output contract, never pitch or user evidence. When #9 lands,
     the fixture survives only as test data under its explicit
     HYPOTHETICAL SPIKE FIXTURE labeling.
3. **Adapter rulebook** (already implemented; keep or amend via ADR): frame
   = ring-centroid ENU feet; frontage = ≤60 ft from the address hint
   (orientation only); rear = longest non-frontage edge; maximum envelope =
   range-minimum side setbacks + numeric rear + cap trim from the longest
   frontage edge via bisection; conservative lot-type for the occupied-area
   cap; parking = deterministic first-fit frontage search (9×18 stalls,
   24 ft aisle, 2–6 rows) that fails closed to an UNRESOLVED note when no
   rectangular field fits (the canonical 110-stall case); mission clips as
   explicit removed volumes with from/to elevations; scenario volumes
   validated against the mission envelope with failures rendered as
   CONFLICT — never as buildable; every envelope carries an
   `EnvelopeVerification` level the UI must display.
4. **Renderer discipline**: renderer files must not import domain/adapters/
   commands or contain regulatory vocabulary (isolation test enforces);
   saved cameras stay derived from geometry; every user-visible derivation
   string comes from the adapter (annotations/notes), not from JSX.
5. **#9 must still build** (not in this spike): real #7 integration (live
   solver output instead of the fixture), scenario switching wired to
   project state with recompute animation, before/after comparison, Council
   export views, camera transition polish, stale-certificate overlay
   (certificate freshness → visible STALE state), multi-parcel campus
   support (currently single-parcel by contract), map context toggle, and
   the production asset/SSR hardening (bundle the benchmark pack for
   standalone deploys; consider build-time scene caching per property).

## Consequences

- New runtime dependencies: `three`, `@react-three/fiber`,
  `@react-three/drei`, `polygon-clipping` (all client/bundled, no network).
- `/forge-spike` is spike surface: labeled as such, excluded from the
  product workspace nav, and intended to be superseded by #9's `/forge`.
- The ADR decision (engine + boundary) is the reviewable artifact; the code
  is the proof, not the product.
