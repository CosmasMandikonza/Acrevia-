# Secondary fixture — Central Lutheran Church, Minneapolis

**Property:** Central Lutheran Church, 333 S 12th St, Minneapolis, MN 55404
(development parcel: county PID `2702924410124`, situs 328 E 16th St — the surface parking lot)
**Jurisdiction:** Minneapolis, MN (Hennepin County)
**Benchmark role:** secondary (best height/massing contrast case)
**Research window:** 2026-10-04T03:16Z–04:35Z (UTC)

## Why it is in the pack

Scored 4.53 in the selection matrix. A congregation-owned 118,599 sq ft (2.72 acre) downtown-adjacent
parcel with **zero improvements** — the church's own website advertises monthly parking contracts in
the lot. Zoning is a two-layer system (primary "Residence and Institutional" RM3 + built form
"Transit 10") with a dramatic envelope: minimum height 20 ft, base maximum 140 ft / 10 stories,
210 ft / 15 stories with increases, base FAR 5.4 plus 3 × 0.8 premiums, 100% lot coverage. The
before/after massing story (surface lot → mid-rise housing beside a landmark stone church) is the
strongest visual contrast in the study.

Not canonical because the adopted code text (Municode Title 20) is JS-only; numeric standards rest
on the city's official handbook, which itself warns it is "not necessarily a complete picture."

## Files

- `sources.manifest.json` — 6 sources
- `parcel.geojson` — parcel polygon (WGS84)
- `rules.expected.json` — 11 rules (height/FAR/coverage verified by rendered-image reads of the
  handbook; yards and parking explicitly UNKNOWN)
- `open-questions.json` — 6 unresolved items

## Key verified facts

- Owner: "CENTRAL LUTHERAN CHURCH" (Hennepin County parcels)
- Land: 118,599 sq ft, LAND-COMMERCIAL, no improvements (build year 0000)
- Zoning: primary "Residence and Institutional" (RM3) + built form Transit 10 (BFT10)
- Built form: min height 20 ft (2 stories); max 140 ft (10 stories) base, 210 ft (15 stories) with
  increases; base FAR 5.4 ("all other" primary districts; 5.0 for UN/RM — grouping flagged in open
  questions); lot coverage 100% ("all other"; 80% UN/RM); FAR premiums 3 × 0.8

## Reproduction

Query the Hennepin County and Minneapolis endpoints in the manifest (PID / centroid
-93.270875, 44.967961); download the Built Form Districts Handbook and read the Transit 10 spread
(pp. 8–9) and premiums tables. Adopted-text confirmation requires a JS-capable fetch of Municode
Title 20 Ch. 530/540 — recorded as an open question, not resolved here.
