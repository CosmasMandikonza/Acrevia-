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

## Weighted selection matrix

Criteria and weights (approved by maintainer, 2026-10-03):

| Criterion | Weight |
| --- | --- |
| Authoritative parcel/zoning data quality | 0.25 |
| Publicly verifiable faith ownership | 0.15 |
| Visible underused/developable land | 0.15 |
| Realistic access to a real person (pastor/board/ministry/dev partner) | 0.15 |
| Affordable-housing feasibility relevance | 0.10 |
| Regulatory complexity that exercises Acrevia | 0.10 |
| Visual potential for 2D/3D Forge | 0.10 |

Scores 1–5, from verified evidence only:

| Candidate | Data | Owner | Land | Access | Housing | Complexity | Visual | **Weighted** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DC — Wesley Theological Seminary | 4.5 | 5 | 5 | 4.5 | 4.5 | 4.5 | 4.0 | **4.60** |
| Portland — Central Church of the Nazarene | 4.0 | 5 | 5 | 5 | 4.0 | 5 | 4.5 | **4.60** |
| Minneapolis — Central Lutheran Church | 4.0 | 5 | 5 | 4.5 | 4.5 | 4.5 | 4.5 | **4.53** |
| **Philadelphia — Calvary Memorial Church** | 4.5 | 5 | 4.5 | 5 | 4.0 | 4.0 | 4.0 | **4.50** |
| NYC — St. Peter's Episcopal (Bronx) | 4.0 | 5 | 5 | 3.0 | 5 | 5 | 4.0 | **4.35** |
| Seattle — St. Alphonsus (Ballard) | 3.0 | 5 | 4.5 | 4.0 | 4.5 | 4.0 | 4.5 | **4.08** |
| Denver — Riverside Baptist Church | 3.5 | 5 | 4.5 | 2.0 | 4.0 | 4.0 | 4.0 | **3.80** |

The top four sit within 0.10 points (2%) of each other. The matrix alone does not
separate them, so the decision layer below is documented explicitly rather than
hidden inside a rounded score.

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
  the consolidated code is "effective July 1, 2026". Both issues are honest
  real-world mess, but too much unresolved risk for the first gold fixture.
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
  fully tax-exempt (exempt land $456,768 / building $3,056,832), book/page
  0880322. Church website independently confirms name, address, phone, email,
  9:15 a.m. Sunday School, 10:30 a.m. service, and an affiliated school.
- **Land:** verified PWD parcel polygon 119,295 sq ft (2.74 ac); exactly one
  building (city footprint layer: "Calvary Memorial Church", 31,272 sq ft,
  ~26% of parcel); ~74% of the parcel is open land whose specific current use
  (parking vs other) is **UNKNOWN** — the church's website does not mention a
  parking lot, so no parking claim is made.
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
     GIS for zoning assignment, PostGIS parcel polygons, building footprints,
     flood/historic negatives, and RCO data — each item fetched first-hand by the
     benchmark author, not accepted from a secondary report.
  2. **Exact Mission Compiler shape:** one parcel, one congregation, sanctuary +
     Sunday school + affiliated school + large open land. The things Acrevia's
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
