# Canonical benchmark — Calvary Memorial Church, Philadelphia

**Property:** Calvary Memorial Church, 7200 Roosevelt Blvd, Philadelphia, PA 19149
(OPA/BRT parcel `778273000`; PWD parcel id `494018`; ward 54; census tract 314)
**Jurisdiction:** City of Philadelphia, Pennsylvania
**Benchmark role:** canonical (hero demo property, engineering gold fixture, Forge 3D property, real-world validation case)
**Selected:** 2026-10-04 — see `../SELECTION.md` for the weighted matrix and runner-up tradeoffs
**Research window:** 2026-10-04T02:48Z–04:30Z (all timestamps UTC)

## Why this property

A single congregation owns a single 119,295 sq ft (2.74 acre) parcel on which it operates its
sanctuary (one building, 31,272 sq ft, ~26% of the parcel) plus an affiliated school; the remaining
~74% of the parcel is not covered by the mapped building footprint (actual surfacing/use unsurveyed). The base district (RM-1) permits multi-family housing by right with zero
required parking spaces, and a city overlay (/SIX) genuinely constrains the scenario space (ADU
prohibition). In other words: the exact inputs Acrevia exists to reason about — real church, real
parcel, real rules, real trade-offs — are physically and legally present, and every consequential
fact below traces to an official source fetched during this research.

## Evidence chain (summary)

| Fact | Value | Source (manifest id) | Status |
| --- | --- | --- | --- |
| Owner of record | CALVARY MEMORIAL CHURCH (OPA exemption values populated for land and building) | S1 (OPA) | SOURCE_CONFIRMED |
| Parcel geometry & area | MultiPolygon; 119,295 sq ft recorded / 119,300 sq ft geodesic | S2 (PWD parcels) | SOURCE_CONFIRMED |
| Base zoning | RM-1, pending: No | S3 (L&I zoning layer; matches OPA field) | SOURCE_CONFIRMED |
| Overlays | /SIX (14-548); sign controls (14-904(4)); childcare standards (14-603(5)); /NIS (14-540) | S4 (L&I overlay layer) | SOURCE_CONFIRMED |
| Multi-family use | Permitted by right (Y[1]) | S5 (PCPC Quick Guide, Table 14-602-1) | SOURCE_CONFIRMED |
| Religious assembly use | Special exception (S[2], § 14-603(5)) | S5 | SOURCE_CONFIRMED |
| Dimensional standards | 16 ft width; 1,440 sq ft lot area; 75%/80% occupied area; context front setback; 5–12 ft side yard; 9 ft rear yard; 38 ft height; 360/480 tiered density | S5 (Table 14-701-2) | SOURCE_CONFIRMED |
| FAR | No value printed in guide table; adopted text not captured | S5 | UNKNOWN |
| Parking — multi-family | 0 spaces | S7 (adopted § 14-802, live) | **VERIFIED** |
| Parking — religious assembly | 1/10 seats or 1/1,000 sq ft, whichever greater | S7 (adopted § 14-802, live) | **VERIFIED** |
| /SIX ADU prohibition | "(2)(c) Accessory dwelling units shall not be permitted." | S6 (adopted § 14-548, live) | **VERIFIED** |
| Building | One building (BIN 1282177), 31,272 sq ft, ~29 ft | S8 (city footprints) | SOURCE_CONFIRMED |
| Flood | FEMA Zone X, minimal hazard | S9 | SOURCE_CONFIRMED |
| Historic | No local historic district; basemap landmark label only; register status unverified | S10 | SOURCE_CONFIRMED / open question |
| Civic review | 3 RCOs cover the parcel (exp. 2027) | S11 | SOURCE_CONFIRMED |
| Church identity | Website confirms address, phone, email, Sunday school, school | S12 | PROPERTY_SELF_REPORTED |

## Files

- `sources.manifest.json` — 13 sources with authority levels and retrieval timestamps
- `parcel.geojson` — WGS84 parcel polygon with provenance properties
- `rules.expected.json` — 27 structured rules with quotes and evidence states
- `open-questions.json` — 14 unknowns / expert-required items
- `raw/` — cached evidence responses (API JSON + code/guide excerpts) for audit without re-fetching

## What this fixture deliberately does NOT contain

- **No unit count.** The density formula is recorded, but computing "how many homes" requires
  solver assumptions (building placement, occupied area vs. existing building retention, context
  setbacks, mission constraints) that belong to the scenario solver (#7), not the benchmark.
- **No developable-area claim.** Parcel area is geometry. Existing building, context front
  setbacks, side/rear yards, access, easements, and mission reservations all reduce buildable land.
- **No parking-lot claim and no land-use claim.** ~74% of the parcel is not covered by the mapped
  building footprint (a statement about mapped geometry), but the church's own website never mentions
  parking, and no public source inventories stalls or describes that unmapped area — its
  current use is UNKNOWN.
- **No legal conclusion of any kind.** Every record carries `legalFinality: EXPERT_REVIEW_REQUIRED`.

## Reproducing this research

1. Owner/building attributes: query `opa_properties_public` (CARTO) for `parcel_number='778273000'` (S1).
2. Geometry: query `pwd_parcels` for `brt_id='778273000'`, `ST_AsGeoJSON(the_geom)` (S2).
3. Zoning: point-intersect the L&I `Zoning_BaseDistricts` and `Zoning_Overlays` FeatureServers at
   the parcel centroid (-75.056429177, 40.043767556) (S3, S4).
4. Dimensionals/uses: download the PCPC Quick Guide PDF (S5) and read Tables 14-701-2 and 14-602-1
   for RM-1.
5. Parking + overlay text: open code library nodes 293733 (§ 14-802) and 308864 (§ 14-548) in a
   real browser (plain HTTP clients are bot-blocked) (S6, S7).
6. Site conditions: building_footprints, fema_floodplain_2023, HistoricDistricts_Local,
   Landmark_Poly, Zoning_RCO — point queries at the centroid (S8–S11).
7. Expect the outputs recorded in `raw/`. Differences mean a source has changed — record them,
   do not silently overwrite.

## Currentness

- Zoning layers reported `pending: No` (2026-10-04T04:30Z retrieval).
- The adopted-code host states its text "may not reflect the most recent legislation"; the parking
  table's latest recorded amendment is Bill No. 250525 (approved June 13, 2025).
- The Quick Guide is dated February 13, 2026 and self-describes as non-authoritative against the
  adopted code.
- Re-verification before any real-world reliance is mandatory (Watch / issue #17).

## Human-access paths (for issue #20)

Verified during research: the church publishes a main line ((215) 332-1676) and office email
(info@calvarymemorialchurch.org). Philadelphia is also home to Partners for Sacred Places (national
nonprofit for congregations' underused space, 1700 Sansom St) and POWER Interfaith's affordable
housing campaign (named staff contact published). No outreach has been performed; these are
pathways, not relationships, and must be presented as such.
