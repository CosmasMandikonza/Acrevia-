# ADR 0004 — GIS property resolution: providers, tiers, and atomic site commit

Status: accepted with issue #4 (after all review passes).

## Outcome and scope

Issue #4 turns a typed church address into a trustworthy, provenance-carrying
site inside the Development Graph: address candidates → official parcel
geometry → per-parcel structures → per-parcel zoning/jurisdiction assignment →
an atomically committed project, with ambiguity, capture modes, partial
failures, and a deterministic spatial fallback all explicit and visible. The
map/canvas is the product surface. Regulatory interpretation stays with #5.

## Decisions

1. **Provider stack (anonymous, supported, keyless).** US Census Geocoder
   (address candidates only; TIGER points are hints, never parcel identity).
   City of Philadelphia PWD_PARCELS ArcGIS FeatureServer (canonical live
   parcel geometry, ids, owner, recorded area). L&I ArcGIS layers for zoning
   base/overlays (SEPARATE captures), building footprints (by parcel_id_num
   link or envelope+spatial filter), and site context (flood / historic /
   RCO, each with its own capture). AIS is optional keyed enrichment only.

2. **Full-session signed ResolutionEnvelope.** The ENTIRE ResolutionSession
   is HMAC-SHA256 signed — no field exclusions. User choices arrive as
   separate request inputs; the server verifies the fully signed previous
   state, applies the allowed choice, and returns a newly fully signed
   envelope. `ACREVIA_RESOLUTION_SECRET` is required in production and the
   module fails closed if absent (dev/test fallback only).

3. **Per-parcel contexts.** `ResolvedParcelContext { parcelId, zoningBase,
   zoningOverlays, structures, flood, historic, rco, failures }`. Each
   confirmed parcel resolved independently via `Promise.allSettled` —
   successful sibling results survive individual provider failures. Typed
   per-capability failures are recorded and rendered in plain language.

4. **Per-parcel jurisdiction persistence.** `jurisdictions: array` in the
   commit contract. Each parcel's zoning base claim gets its own
   JurisdictionAssignment node. Multi-parcel campuses preserve zoning
   differences — never flattened into one assignment.

5. **Separate provenance per context fact.** Zoning base, zoning overlays,
   flood, historic, and RCO each get their own CaptureMetadata, source
   artifact, and claim. No composite claims sourced by responses that didn't
   contain the fact. All context facts are committed into the graph.

6. **Query-scoped source identity.** `logicalCaptureKey` includes the stable
   query fingerprint (e.g., `phl-pwd-parcels:address-registry:7200-ROOSEVELT`).
   Distinct queries are distinct logical sources, enabling future version
   tracking (Watch #17).

7. **Atomic typed site commit.** `commitResolvedSite` stages ALL mutations
   into a codec-cloned project, applies typed commands with deferred grounding
   edges, validates the whole result through `ProjectCodec.encode()`, and only
   then returns. Any failure leaves the original project byte-for-byte
   unchanged. Invalid geometry gated: `confirmParcels()` and the commit both
   reject invalid polygons without an explicit override.

8. **CRS discipline.** EPSG:4326 / RFC 7946 [lon, lat] only. Anything else
   is a typed `UNSUPPORTED_CRS` failure. Polygon/MultiPolygon preserved.
   Recorded vs computed area separate. No silent repair.

9. **Deterministic spatial fallback.** When MapLibre/WebGL cannot initialize
   or the basemap is unavailable, a lightweight SVG renderer projects the
   exact same WGS84 GeoJSON (parcels, structures, hint) into a viewport.
   This is a renderer, not a data copy. The verified church property remains
   visibly there in any environment. `data-testid` elements (parcel-geometry,
   structure-geometry, geocode-hint) provide browser-testable proof of
   actual rendered geometry, not React intent.

10. **PostGIS deferred.** The committed project is codec-validated canonical
    JSON, ready for a future PostGIS-backed `ProjectRepository`.

## Validation

35 GIS tests across 3 files: 8 canonical (no-AIS path, hint-not-truth,
area separation, provenance chain, logical key separation), 12 adversarial
(ambiguity, zero/multi parcels, campus, CRS, invalid geometry, malformed
payloads, provider outages, tamper-evident envelope, partial failures,
invalid-geometry gate), 10 final-pass (full-session signing, production
fail-closed, jurisdictions[]), 5 browser (canonical with SVG geometry
assertions, neutral-basemap fallback). Full suite: 156/156 tests.

## Consequences

- Downstream issues (#5 regulation, #7 solver, #9 Forge) consume
  graph-committed parcels/structures/zoning with full provenance.
- The deterministic SVG fallback guarantees Denver demo resilience: even if
  WebGL fails in the venue browser, the verified property geometry renders.
- New dependencies: `@turf/*` (5 micro-packages), `maplibre-gl`.
