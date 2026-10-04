# Secondary fixture — Wesley Theological Seminary, Washington DC

**Property:** Wesley Theological Seminary, 4500 Massachusetts Ave NW, Washington, DC 20016
(SSL `1600    0819`; abutting improved campus lot 0818 under the same owner)
**Jurisdiction:** District of Columbia
**Benchmark role:** secondary (runner-up for canonical; best calibration case)
**Research window:** 2026-10-04T03:17Z–04:32Z (UTC)

## Why it is in the pack

Scored 4.60 in the selection matrix (tied highest; see `../SELECTION.md`). A faith-owned
(theological seminary, United Methodist) 113,758 sq ft parcel that the city's own layers classify
as vacant, in RA-1, with a **pending PUD whose parameters (FAR 1.07, 75.6 ft, 735 beds, 394
parking) are real professional proposals** — a natural ground-truth calibration target for the
future scenario solver (#7/#16): compute the by-right envelope, then compare with what
professionals actually sought.

It was not chosen as canonical because the pending PUD means the site's development story is
already underway (undermining the discovery narrative), the owner is an institution rather than a
congregation, and the best machine-readable regulations text is an unofficial consolidated export.

## Files

- `sources.manifest.json` — 6 sources with authority levels
- `parcel.geojson` — parcel polygon (WGS84) with provenance
- `rules.expected.json` — 13 rules; RA-1 standards verified from the ZR16 consolidated export
- `open-questions.json` — 5 unresolved items

## Key verified facts

- Owner: "WESLEY THE THEOLOGICAL SEMINARY OF METHODIST CHURCH" (OTR extract ≈ 2026-08-03)
- Land: 113,758 sq ft, classified vacant, $0 improvements
- Zoning: RA-1; FAR 0.9 (IZ 1.08 w/ special exception); 40 ft / 3 stories; rear yard 20 ft;
  side yards 3 in/ft height-coupled, min 8 ft; lot occupancy 40% (60% worship); parking 1/3
  units over 4 (religious 1/10 sanctuary seats; 50% reduction within 0.5 mi of Metrorail,
  eligibility unverified); row-unit land requirement 1,800 sq ft/unit
- Pending PUD on site (see rules fixture)

## Reproduction

Query the DC GIS endpoints in the manifest with the SSL and the parcel centroid
(-77.0901315, 38.9391215); download the ZR16 consolidated PDF and check the cited Subtitle F/C
sections. Expect the recorded values; differences mean something changed — log them.
