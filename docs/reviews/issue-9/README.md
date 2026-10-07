# Issue #9 — Forge review artifacts

Screenshots captured by `tests/e2e/forge-live.spec.ts` (Playwright, desktop
project 1512×982, SwiftShader software WebGL) on the LIVE canonical Calvary
journey: resolve → accept → confirm the canonical mission → `/forge`. Every
image is the production `/forge` surface rendering real #7 solver scenarios
with CURRENT ScenarioCertificates — no spike fixture appears anywhere.

| File | Moment |
| --- | --- |
| `01-forge-scenario-housing-max.png` | HOUSING MAX 123 homes — 8 validated massing bars (PARTIAL: parking honestly unresolved) |
| `02-forge-existing.png` | Existing — sanctuary + parcel |
| `03-forge-legal.png` | Legal — law-informed planning envelope (ASSUMPTION_DERIVED) + 38 ft height plane |
| `04-forge-mission.png` | Mission — envelope clips (protected sanctuary removal) |
| `05-forge-scenario-low-change.png` | LOW CHANGE 62 homes |
| `06-forge-recomputed-parking-90.png` | After the 110 → 90 Sunday-parking mission edit: new CURRENT certificate, superseded certificate named |
| `07-forge-no-verified-solution-124.png` | 124-home goal: NO VERIFIED SOLUTION ghost treatment, binding constraints, nearest alternatives |
| `08-forge-before-after.png` | Before/after draggable reveal (existing ⟂ selected scenario) |
| `09-forge-fallback-plan.png` | `?fallback=1` deterministic SVG plan (no WebGL) |
| `10-final-1512.png` / `11-final-1440.png` / `12-final-1280.png` | Post-critique round at the three professional viewports |

Visual QA: two critique rounds against the AEC bar (Forma/TestFit/Finch),
driven by Playwright captures + vision-model review:

Round 1 findings fixed: scenario massing and the existing sanctuary were
near-identical ivories (now: warm study-model card vs darker stone, floor
lines strengthened), the mission pill overlapped the legend (repositioned
with breathing room), the goal panel sat in the camera rail's corner (moved
into the left column), and the disclaimer contrast was weak (darkened).
Playwright also caught real layout defects that became fixes: the
before/after control sat under the scenario rail (pointer interception) and
the plan-fallback HUD duplicated moment controls (reduced to plan-applicable
controls).

Round 2 (final 1512/1440/1280 captures): massing/sanctuary distinction
legible, no panel collisions at any professional width, canvas dominant,
no clipped text. Known software-GL limitation: captures render at ~1 fps
under SwiftShader, so lighting reads flatter than the GPU path measured in
ADR 0008; geometry, statuses, and layout are identical.
