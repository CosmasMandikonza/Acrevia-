# Benchmark property selection — Issue #2

Status: decided 2026-10-04. Research window 2026-10-04T02:48Z–04:30Z (all timestamps UTC).

Seven jurisdictions were researched against the Issue #2 selection criteria plus the
maintainer's four-role requirement (engineering gold fixture, hero demo property,
Forge 3D property, real-world validation/design-partner case). Every load-bearing
fact below was verified against an authoritative source during the research window;
leads are labeled and excluded from scoring evidence. The per-candidate evidence
logs are summarized in each property README and in the PR description.

## Canonical property (decided)

**Calvary Memorial Church, 7200 Roosevelt Blvd, Philadelphia, PA 19149**
(`calvary-memorial-philadelphia/`)

## Canonical readiness gates

Weighted scores rank opportunity and complexity; they do not decide readiness.
Issue #2 sets mandatory selection criteria (public parcel geometry; public,
machine-readable or clean zoning sources; clear current code; enough complexity
without making the benchmark impossible). A candidate is eligible to serve as
the **first** canonical gold fixture only when every load-bearing source,
currentness, and geometric prerequisite for those criteria is actually in hand —
so another engineer can reproduce every consequential value today. Gates are
pass (✓) / open, not weighted preferences.

| Gate | NYC | Seattle | Portland | Denver | Philadelphia | DC | Minneapolis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 parcel geometry retrieved & committed | OPEN — MapPLUTO unreachable in-session | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| G2 zoning assignment from official layer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| G3 dimensional rules captured from official sources | ✓ | OPEN — code text unreadable to automated clients | ✓ | PARTIAL — PDF tables scramble under extraction | ✓ | ✓ | PARTIAL — handbook only (self-described incomplete) |
| G4 clear current code | ✓ | OPEN | OPEN — chapter revision dates vs consolidated code effective 2026-07-01 unreconciled | ✓ | ✓ [a] | ✓ — consolidated export with stated currency [b] | OPEN — adopted text JS-only |
| G5 binding constraints resolvable without unfetched layers | ✓ | ✓ | OPEN — floodway layer unfetched; developable fraction unknown | ✓ | ✓ | ✓ | OPEN — parking, yards, density rules uncaptured |

[a] Philadelphia: adopted text captured live for § 14-802(2) and § 14-548; the
dimensional table is captured via the official PCPC Quick Guide (February 2026)
with currency documented; adopted-table capture itself is an open question in
the fixture. [b] DC: DCOZ's consolidated export is labeled unofficial; the
official register is JS-only — caveat recorded in the fixture.

**Gate-closed candidates: Philadelphia and DC.** Among them the maintainer's
matrix ranks Philadelphia first (4.50 vs 4.48), and the decision layer
(congregation vs institutional seminary owner; pending PUD already advancing the
site) also favors Philadelphia. **Portland is the highest-scoring candidate
overall (4.60) and is deferred as canonical, not rejected** — until its two open
gates close (floodway mapping; code-currency reconciliation), after which
re-cutting the canonical designation is a documentation change, not new
research, because its fixture already exists. This is how Philadelphia becomes
canonical without hand-waving away Portland's higher weighted score.

## Weighted selection matrix

**Weighting correction (2026-10-04, PR review).** The first version of this document
scored candidates against a provisional weighting (0.25 data / 0.15 ownership /
0.15 land / 0.15 access / 0.10 housing relevance / 0.10 complexity / 0.10 visual)
and incorrectly labeled it "approved by maintainer." The maintainer's specified
matrix is different: **0.30 data quality / 0.20 real-person access / 0.15
underused land / 0.15 regulatory complexity / 0.10 visual potential / 0.05
ownership verifiability / 0.05 storytelling.** The matrix below is re-scored
against the maintainer's actual weights. Affordable-housing relevance, which the
maintainer's matrix does not carry as a standalone criterion, informed the
storytelling and complexity scores rather than disappearing.

| Criterion (weight) | Weight |
| --- | ---: |
| Authoritative parcel/zoning data quality | 0.30 |
| Realistic access to a real person (pastor/board/ministry/dev partner) | 0.20 |
| Visible underused/developable land | 0.15 |
| Regulatory complexity that exercises Acrevia | 0.15 |
| Visual potential for 2D/3D Forge | 0.10 |
| Publicly verifiable faith ownership | 0.05 |
| Storytelling (documented, verifiable human narrative) | 0.05 |

Scores 1–5, from verified evidence only (storytelling scored on documented,
verifiable narrative material — a stalled project record, an operating school, a
shelter ministry lead, an active congregation's own publications — not on
invented demo copy):

| Candidate | Data | Access | Land | Complexity | Visual | Owner | Story | **Weighted** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Portland — Central Church of the Nazarene | 4.0 | 5.0 | 5.0 | 5.0 | 4.5 | 5 | 4.0 | **4.60** |
| **Philadelphia — Calvary Memorial Church** | 4.5 | 5.0 | 4.5 | 4.0 | 4.0 | 5 | 4.5 | **4.50** |
| DC — Wesley Theological Seminary | 4.5 | 4.5 | 5.0 | 4.5 | 4.0 | 5 | 3.0 | **4.48** |
| Minneapolis — Central Lutheran Church | 4.0 | 4.5 | 5.0 | 4.5 | 4.5 | 5 | 4.5 | **4.45** |
| NYC — St. Peter's Episcopal (Bronx) | 4.0 | 3.0 | 5.0 | 5.0 | 4.0 | 5 | 5.0 | **4.20** |
| Seattle — St. Alphonsus (Ballard) | 3.0 | 4.0 | 4.5 | 4.0 | 4.5 | 5 | 3.5 | **3.85** |
| Denver — Riverside Baptist Church | 3.5 | 2.0 | 4.5 | 4.0 | 4.0 | 5 | 3.0 | **3.53** |

**Under the maintainer's weights, Portland scores highest (4.60), with
Philadelphia second (4.50), DC (4.48), and Minneapolis (4.45) effectively tied.**
The 0.10 spread across the top four is within the noise of one-point subjective
scores. The canonical choice is therefore decided by the readiness gates above,
not by overriding the matrix: among gate-closed candidates, Philadelphia leads
on both the weighted score and the decision layer, while carrying the **highest
evidence completeness for the initial benchmark** — adopted-code live captures
for the two sections that bind feasibility hardest, an official city
dimensional reference, and first-hand capture of every load-bearing input the
fixture asserts. That is not a claim of zero unresolved questions: the
Philadelphia fixture itself records open items (FAR applicability, geographic
bonus restrictions, the overlay edge sweep, contextual/site questions, and
historic-register status), and those unknowns are content, not gaps.

## Finalist tradeoffs

### DC — Wesley Theological Seminary (4500 Massachusetts Ave NW)

- **Identity/ownership:** SSL 1600 0819 + 0818, owner of record
  "WESLEY THE THE THEOLOGICAL SEMINARY OF METHODIST CHURCH" (DC Owner Polygons
  layer, OTR extract ≈ 2026-08-03). Verified first-hand this session.
- **Land:** lot 0819 is 113,758 sq ft and is classified vacant by two independent
  city layers (`PROPTYPE: Vacant-False-Abutting`, `NEWIMPR: 0`; Planning existing
  land use "Vacant"). The cleanest "verified-vacant" signal in the study.
- **Zoning/rules:** RA-1 (verified first-hand). ZR16 PDF (10/1/2025 export)
  verified first-hand: FAR 0.9 (Table F § 201.1), IZ FAR 1.08 with special-exception
  caveat (§ 201.4), height 40 ft/3 stories (§ 203.2), 1,800 sq ft land per row unit
  (§ 202.1).
- **Why not canonical:** the parcel carries a **pending PUD (case 23-08,
  status "Pending", FAR 1.07, height 75.6 ft, 735 beds, 394 parking)** in the
  city's own PUD layer. The site is already deep in a professional development
  process with a development partner — the "congregation discovers what its land
  could become" hero narrative would be staged on a site where that discovery
  already happened. The owner is a seminary (institutional), not a congregation
  with a sanctuary/parking/board dynamic. The best machine-readable regulations
  text is DCOZ's "unofficial export" PDF; the official DC Register view is
  JS-only.
- **Kept as:** secondary fixture — and a future calibration case for the scenario
  solver (#7/#16): when Acrevia computes the by-right envelope, the pending PUD's
  actual parameters are a real-world ground truth to compare against.

### Portland — Central Church of the Nazarene (9715 SE Powell Blvd)

- **Identity/ownership:** R992090030 / 1S2E09AC 100, owner "CENTRAL CHURCH OF THE
  NAZARENE" (PortlandMaps taxlot layer, county roll 2025-09-27). Verified
  first-hand, geometry included.
- **Land:** 477,884 sq ft (10.97 ac), building 24,642 sq ft → ~95% unbuilt. The
  largest canvas in the study.
- **Zoning/rules:** RM2 with Environmental Protection overlay at the centroid,
  Johnson Creek Plan District (verified first-hand). Title 33 chapter PDF verified
  first-hand: FAR 1.5:1, base height 45 ft, front setback 10 ft, side/rear 5 ft,
  min density 1 unit/1,450 sq ft, building coverage 70%/60% corridor rule
  (§ 33.120.225.B).
- **Why not canonical:** the Johnson Creek floodway rules (§ 33.537.100) prohibit
  new above-ground structures in the floodway and environmental-zone land is
  subtracted from density calculations; without FEMA floodway mapping the truly
  developable fraction of the 10.97 acres is **unknown** and could be small. Code
  currency is ambiguous: the per-chapter PDFs carry 2024–2025 revision dates while
  the consolidated code is "effective July 1, 2026". These two issues are recorded
  as **open readiness gates (G4, G5)** in the table above — Portland is the
  highest-scoring candidate and is deferred, not rejected, until they close.
- **Kept as:** secondary fixture (best complexity case).

### Minneapolis — Central Lutheran Church (333 S 12th St / 328 E 16th St)

- **Identity/ownership:** PID 2702924410124, owner "CENTRAL LUTHERAN CHURCH"
  (Hennepin County parcels, verified first-hand, geometry included).
- **Land:** 118,599 sq ft, zero improvements, `LAND-COMMERCIAL`, operated as
  surface parking (church's own parking page advertises monthly contracts).
- **Zoning/rules:** Primary "Residence and Institutional" (RM3) + Built Form
  "Transit 10" (verified first-hand). Handbook (official city PDF, updated
  2026-03-17) verified first-hand via table image read: min height 20 ft/2
  stories, base max 140 ft/10 stories, 210 ft/15 stories with increases; FAR
  base 5.4 with premiums 3 × 0.8.
- **Why not canonical:** the adopted Municode text is JS-only; numeric standards
  come from the handbook, which itself warns it is "not necessarily a complete
  picture". Adopted-text capture is weaker than Philadelphia's. Parking minimums
  for the site could not be verified this session (UNKNOWN).
- **Kept as:** secondary fixture (best height/massing contrast case).

### Philadelphia — Calvary Memorial Church (canonical)

- **Identity/ownership:** OPA parcel 778273000, owner "CALVARY MEMORIAL CHURCH",
  OPA exemption values populated for land and building
  (exempt land $456,768 / building $3,056,832; exemption fields evidence religious use, not a complete tax analysis), book/page 0880322. Church website independently confirms name, address, phone, email,
  9:15 a.m. Sunday School, 10:30 a.m. service, and an affiliated school.
- **Land:** verified PWD parcel polygon 119,295 sq ft (2.74 ac); exactly one
  building (city footprint layer: "Calvary Memorial Church", 31,272 sq ft,
  ~26% of parcel); the remaining ~74% is not covered by the mapped building
  footprint, and its actual surfacing/use is **UNKNOWN** — the church's website does
  not mention a parking lot, so no parking or land-use claim is made.
- **Zoning/rules:** RM-1, `pending: No` (official L&I zoning layer, verified
  first-hand); four overlays incl. /SIX (§ 14-548 — adopted text captured live,
  ADU prohibition verbatim); RM-1 dimensionals from the official PCPC Quick
  Guide (Feb 2026) with double-extracted table reads; parking ratios from
  **adopted code captured live** (§ 14-802, Table 14-802-1: multi-family in RM-1
  requires **0** spaces; religious assembly 1/10 seats or 1/1,000 sq ft).
- **Why canonical (decision layer):**
  1. **Most complete and redundant verified evidence chain in the study** —
     adopted-code live captures for the two sections that bind feasibility
     hardest (parking, overlay), an official city dimensional reference, official
     GIS for zoning assignment, PostGIS parcel polygons, building footprints, a
     FEMA Zone X result at the sampled location, no feature in the queried local
     historic-district layer at the sampled location (individual Philadelphia
     Register status remains an open question), and RCO data — each item fetched
     first-hand by the benchmark author, not accepted from a secondary report.
  2. **Exact Mission Compiler shape:** one parcel, one congregation, sanctuary +
     Sunday school + affiliated school + a large area not covered by any mapped building.
     The things Acrevia's
     mission constraints are supposed to reason about are physically real here.
  3. **Strongest, most redundant human-access paths:** the church publishes a
     phone and email; Partners for Sacred Places (national congregation-capacity
     nonprofit) is headquartered in Philadelphia; POWER Interfaith runs an
     affordable-housing campaign with named staff.
  4. **Technically interesting solver story:** multi-family is permitted by right
     and requires zero parking spaces in RM-1, so the binding constraints become
     occupied-area, height, and the tiered density formula — a demonstration that
     Acrevia computes what actually binds rather than repeating "parking is the
     problem" folk wisdom.
- **Accepted weaknesses (documented, not hidden):** adopted-code live capture of
  Table 14-701-2 itself was blocked by the code host's bot protection (the two
  other sections succeeded); dimensional values therefore carry
  `SOURCE_CONFIRMED` status via the official city guide rather than
  `VERIFIED` adopted text; the guide's "bonus restrictions in select geographic
  areas — see page 49" pointer could not be resolved within the guide; no
  secondary city summary generator output was capturable without a browser.

## Runners-up not carried forward as fixtures

- **NYC — St. Peter's Episcopal:** excellent zoning data quality and a dramatic
  stalled-project story, but parcel polygons were not retrievable this session
  (MapPLUTO ArcGIS blocked from this environment) and the landmark + 1693-era
  cemetery lots add friction that would dominate the first gold fixture.
- **Seattle — St. Alphonsus:** strong property, but the municipal code text is
  unreadable to automated clients (JS-only Municode, 401 API, bot-walled clerk
  site) — the weakest link for a benchmark whose purpose is cited rules.
- **Denver — Riverside Baptist:** good data, but the church has no verifiable web
  presence (its domain is parked), making the real-person access path the weakest
  in the study.

## Research-integrity note

One research agent's report on Philadelphia claimed RM-1 dimensional values
(43 du/acre, 1,000 sq ft/unit, 50% coverage, 15/20 ft rear yards, 50 ft lot width)
attributed to a specific code node. Independent verification showed that node
contains only narrative subsections, and the official February 2026 city guide
contradicts every one of those numbers. Those values were **excluded** from this
benchmark. This is recorded here because it is exactly the failure mode
(`convenient fiction`) this benchmark exists to prevent, and because the
dimensional rules therefore cite the city guide (and live adopted text where
captured) with explicit authority levels.
