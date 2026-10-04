# ADR 0004 — GIS property resolution: providers, tiers, and atomic site commit

Status: accepted with issue #4.

## Outcome and scope

Issue #4 turns a typed church address into a trustworthy, provenance-carrying
site inside the Development Graph: address candidates → official parcel
geometry → structures → jurisdiction/zoning assignment → an accepted project,
with ambiguity, capture modes, and failure states explicit at every step. The
map/canvas is the product surface (`src/components/site/`). Regulatory
interpretation stays with #5; no solver/AI/3D behavior is included.

## Decisions

1. **Provider stack (anonymous, supported, keyless; all verified live
   2026-10-04).** US Census Geocoder is the address-candidate source — its
   TIGER points are street-range interpolations and are treated strictly as
   hints, never parcel identity. City of Philadelphia `PWD_PARCELS` ArcGIS
   FeatureServer is the canonical live parcel source (geometry, ids, owner,
   recorded gross area), queried two labeled ways: registry address match and
   envelope + containment/distance ranking. L&I ArcGIS layers provide zoning
   assignment (base + overlays at parcel centroid), building footprints, and
   site context (FEMA 2023, local historic districts, RCO). AIS is optional
   keyed enrichment only (`AIS_GATEKEEPER_KEY`); anonymous AIS is not a
   supported integration and the canonical path never requires it.
2. **No silent parcel selection.** Auto-resolution of the parcel stage happens
   only for a single registry match without contention; every other case —
   multiple candidates, geocoder/parcel disagreement, zero parcels — stops in
   a typed state for user confirmation. Campus composition (multi-parcel
   property) is always user-confirmed.
3. **CRS discipline.** EPSG:4326 / RFC 7946 [lon, lat] is the only supported
   CRS in #4; ArcGIS sources are requested with `outSR=4326`; a declared or
   detected non-4326 response is a typed `UNSUPPORTED_CRS` failure — never a
   silent reprojection. Polygon/MultiPolygon are preserved; validity
   (closure, ranges, orientation recorded, turf boolean-valid topology) is
   recorded, never repaired; recorded area (assessor) and computed area
   (turf geodesic) remain separate fields, as the graph already requires.
4. **Provisional sessions vs canonical truth.** The resolution session is
   application-layer state (`src/application/resolution/`), carried
   client-side; the server routes are stateless. Only a user-confirmed session
   may commit, and only through the atomic boundary.
5. **Atomic typed site commit (issue #4 addendum correction).** Live GIS
   never writes nodes benchmark-style. `commitResolvedSite` stages the entire
   mutation set into a codec-cloned project, applies
   `addSourceArtifact`/`recordClaim`/parcel/structure/jurisdiction/property
   commands with deferred grounding edges for the parcel↔claim reference
   cycle, validates the whole result through `ProjectCodec.encode()` (schema +
   keys + hashes + edges + property resolution), and only then returns the
   committed project. Any failure — including a deliberately late structure
   failure — leaves the original project byte-for-byte unchanged (tested).
6. **CaptureStore tiers.** `MemoryCaptureStore` (runtime) and
   `FixtureCaptureStore` (committed real evidence under
   `docs/benchmarks/calvary-memorial-philadelphia/raw/gis/`, captured live on
   2026-10-04) implement LIVE → CACHED → FIXTURE degradation. A
   `rawEvidenceRef` is produced only for the durable fixture tier; in-memory
   bodies never masquerade as durable evidence. The deployed runtime does not
   depend on a writable filesystem.
7. **PostGIS deferred.** No database is introduced; the committed project is
   codec-validated canonical JSON, ready for a future PostGIS-backed
   `ProjectRepository` without domain changes. This supersedes the issue-#4
   "PostGIS persistence" line item, per the addendum.
8. **Basemap is non-critical.** MapLibre renders OSM raster tiles as visual
   context; on tile/style failure the map degrades to a neutral canvas while
   parcel/structure/evidence layers continue to render. No bundled tiles.

## Validation

21 GIS tests (canonical fixture resolution incl. no-AIS path, hint-not-truth,
recorded/computed area separation, provenance chain with hash-verified fixture
evidence; adversarial: two-candidate ambiguity, zero candidates, road-centroid
disagreement, zero/single/multiple parcels, multi-parcel campus commit,
half-resolved rejection, atomic late-failure rollback, UNSUPPORTED_CRS, open
ring/bowtie recording, MultiPolygon preservation, malformed payload, outage
tiers, AIS-unavailable) plus the full pre-existing suite.

## Consequences

- Downstream issues (#5 regulation, #7 solver, #9 Forge) consume
  graph-committed parcels/structures/zoning with full provenance.
- The workspace Site surface now hosts the live resolution experience; other
  surfaces remain placeholders until their issues.
- New runtime dependencies: `@turf/boolean-valid`, `@turf/area`,
  `@turf/centroid`, `@turf/boolean-point-in-polygon`, `@turf/distance`,
  `maplibre-gl`.
- Deferred: durable capture store, PostGIS adapter, Census-fallback polish
  for non-Philadelphia addresses, context-layer UI depth.
