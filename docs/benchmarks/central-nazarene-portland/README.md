# Secondary fixture — Central Church of the Nazarene, Portland

**Property:** Central Church of the Nazarene, 9715 SE Powell Blvd, Portland, OR 97266
(PortlandMaps `R992090030`; state/county ID `1S2E09AC 100`; Multnomah County roll 2025-09-27)
**Jurisdiction:** Portland, OR
**Benchmark role:** secondary (best regulatory-complexity case)
**Research window:** 2026-10-04T02:48Z–04:40Z (UTC)

## Why it is in the pack

Scored 4.60 in the selection matrix (tied highest). The largest faith-owned canvas in the study:
477,884 sq ft (10.97 acres) on one legal lot with a 24,642 sq ft building (~95% unbuilt), owned by
the church of record, with a verified pastor contact. The regulatory stack is the richest of the
seven candidates: RM2 base zone with an Environmental Protection overlay at the centroid, split
zoning across the site, the Johnson Creek Basin Plan District (floodway construction
prohibitions), a minimum-density regime with environmental-zone deductions, parking by maximums,
and corridor-dependent coverage. This fixture is where a constraint solver earns its keep.

Not canonical because the floodway extent is unquantified (FEMA mapping not pulled), so the truly
developable fraction of the flagship canvas is unknown, and chapter-PDF currency vs the
consolidated code (effective 2026-07-01) is unresolved — too much unresolved risk for the first
gold fixture, ideal stress for a secondary one.

## Files

- `sources.manifest.json` — 6 sources
- `parcel.geojson` — parcel polygon (WGS84)
- `rules.expected.json` — 10 rules (Title 33 chapter PDFs verified first-hand)
- `open-questions.json` — 6 unresolved items

## Key verified facts

- Owner: "CENTRAL CHURCH OF THE NAZARENE" (PortlandMaps taxlot layer, county roll 2025-09-27)
- Land: 477,884 sq ft; building 24,642 sq ft (1997); property code CHURCH
- Zoning: RM2 ('RM2p' at centroid, Environmental Protection overlay), Johnson Creek Plan District,
  MD-C comprehensive designation; site also contains Environmental Conservation, RM1, and OS slivers
  (research-pass polygon intersect)
- RM2: FAR 1.5:1; height 45 ft (35 ft step-down near RF/R2.5); setbacks 10/5/5 (garage 5/18);
  coverage 60% (70% on corridors); min density 1 unit/1,450 sq ft; no maximum density;
  parking by maximum; Johnson Creek floodway prohibits new above-ground structures

## Reproduction

Query the PortlandMaps endpoints in the manifest (RNO / centroid -122.563669, 45.4988665);
download the three Title 33 chapter PDFs and read Tables 120-4, 33.120.225.B, 33.266.115, and
33.537.100.A. The county assessment portal (multcoproptax.com) is captcha-gated; PortlandMaps'
republication of the county roll is the practical authoritative source and is what was used.
