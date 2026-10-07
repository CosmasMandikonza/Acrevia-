# Issue #15 — Premium Journey Review Evidence

Branch: `design/issue-15-premium-landing` · Base: `5aa9cd4` → merged `origin/main` @ `adeac7f` (solver #29, spike #30, Forge #31, proof #32, Copilot #33).

## Slice 1 — Landing (hero-first visual pass)

| File | Viewport | Result |
| --- | --- | --- |
| `hero-desktop.png` | 1512×982 (judge laptop) | asymmetric editorial hero; study sheet staged; 0px overflow |
| `hero-1440.png` | 1440×900 | ✓ |
| `hero-1280.png` | 1280×800 | ✓ — no crowding after fix round |
| `hero-tablet-1024.png` | 1024×768 | two-column holds; entry above fold |
| `hero-tablet-768.png` | 768×1024 | single column, copy-first, sheet below |
| `hero-mobile.png` | 390×844 | stacked editorial entry; 54px touch targets |
| `address-focus.png` | 1512×982 | accent border + hard offset shadow + caret; no default outline |

axe (wcag2a/2aa/21a/21aa): **0 violations** at 1440, 1280, 390.
Reduced motion: global kill leaves every staged element in final state (e2e-verified).
e2e: `tests/e2e/landing-premium.spec.ts` — **24/24** (desktop 1440 / laptop 1280 / mobile 390), including valid→`/workspace?address=…`, invalid alert, keyboard submit, and a no-fabricated-numbers guard.
Perf: `/` prerenders static; system fonts + inline SVG only; zero new dependencies.

## Slice 2 — Journey integration (one scripted visual pass, live records)

`journey-*.png` captured 2026-10-07 against the dev server at `localhost:3127`
(127.0.0.1 stalls dev hydration — Next 16 blocks the HMR websocket as a
cross-origin; localhost works. Prod builds are unaffected.)

| File | State |
| --- | --- |
| `journey-1-landing.png` | Hero; canonical address typed |
| `journey-2-resolving.png` | Workspace arrival — **auto-resolve started without a click**; honest provider line (address registry · city parcels · zoning · building footprints) |
| `journey-3-reveal.png` | Live reveal: parcel + structure geometry dominant, matched-address card, zoning RM-1, facts rail supports (not dominates) |
| `journey-4-accepted-mission.png` | Accepted — Calvary Memorial Church, RM-1 + overlays, 22-node Development Graph; Mission panel opens |
| `journey-5a-mission-proposals.png` | Three typed proposals staged (≥110 Sunday parking / preserve sanctuary / retain ownership) |
| `journey-5-mission-confirmed.png` | Confirmed rules (rev-tracked) + **"Mission set — Compute what fits" bridge** |
| `journey-6-scenarios.png` | Same address, same revision — solver ceilings derived and labeled "within modeled scope", certificates current |

All evidence captures in the pass were **LIVE** (Census, PWD parcels, L&I
zoning/overlays/footprints, FEMA, historic, RCO) — no fixture state, no fake
loading. Forge was not opened (CPU budget); its surface remains #9's.

## Honest-language guarantees

- The hero study sheet fabricates no values; disclaimer is part of the sheet.
- e2e asserts no "N homes feasible / N parking fits / verified legal envelope" strings.
- The searching state names only the providers the resolve call actually consults.
