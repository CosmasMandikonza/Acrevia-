# Acrevia benchmark pack

Real-property ground truth for Acrevia's development-intelligence claims.
Created by Issue #2. The canonical property is the hero demo property, the
engineering gold fixture, the Forge 3D property, and the target real-world
validation case; secondary properties are regression fixtures.

| Directory | Role | Property | Jurisdiction |
| --- | --- | --- | --- |
| `calvary-memorial-philadelphia/` | **canonical** | Calvary Memorial Church, 7200 Roosevelt Blvd | Philadelphia, PA |
| `wesley-seminary-dc/` | secondary | Wesley Theological Seminary, 4500 Massachusetts Ave NW | Washington, DC |
| `central-lutheran-minneapolis/` | secondary | Central Lutheran Church, 333 S 12th St | Minneapolis, MN |
| `central-nazarene-portland/` | secondary | Central Church of the Nazarene, 9715 SE Powell Blvd | Portland, OR |

Selection rationale and the full weighted candidate matrix: `SELECTION.md`.

## What this pack is — and is not

This pack records what public authoritative sources said about four real
properties at specific retrieval times, plus the questions those sources cannot
answer. It is a research artifact, not legal advice, and not a determination of
development feasibility. Nothing here is a permit, a zoning opinion, or a
substitute for licensed professionals. The intended consumer is future Acrevia
code (Development Graph #3, regulatory compiler #5, solver #7, evidence ledger
#11, evals #16) and human reviewers auditing whether Acrevia's outputs trace to
real sources.

## Fixture format (benchmark-local, provisional)

The format is deliberately local to this pack. It is **not** the canonical
Development Graph schema — issue #3 owns that. When #3 lands, these fixtures
should be mapped into the graph rather than becoming a parallel model. ADR 0002
records this boundary.

Each property directory contains:

- `README.md` — identity, evidence chain, reproduction steps, currentness.
- `sources.manifest.json` — every source with id, title, publisher, canonical
  URL, authority level, retrieval timestamp (UTC, ISO 8601), and purpose.
- `parcel.geojson` — a single GeoJSON `Feature` (WGS84 / EPSG:4326) with
  provenance properties and recorded + computed areas.
- `rules.expected.json` — structured expected rules (see below).
- `open-questions.json` — unknowns / expert-required questions, machine-readable.
- `raw/` (canonical only) — trimmed copies of the actual fetched evidence
  responses, so a reviewer can audit without re-fetching.

### Rule record fields

| Field | Meaning |
| --- | --- |
| `id` | Stable slug, unique within the property |
| `category` | One of the pack categories (below) |
| `statement` | Plain-language statement of the rule |
| `value` / `unit` | Numeric value where applicable, else `null` |
| `sourceRef` | `id` of an entry in `sources.manifest.json` |
| `codeSection` | Exact section/table citation when available |
| `authorityLevel` | Where the fact sits in the source hierarchy (below) |
| `status` | Evidence state (below) |
| `legalFinality` | Always `EXPERT_REVIEW_REQUIRED` — the benchmark never certifies law |
| `retrievedAt` | ISO 8601 UTC retrieval timestamp |
| `verbatimQuote` | Exact quoted text proving the value (required for `VERIFIED` / `SOURCE_CONFIRMED`) |
| `notes` | Caveats, extraction method, applicability limits |

### Status vocabulary

- `VERIFIED` — adopted code/ordinance text captured live during this research,
  with a verbatim quote in the record.
- `SOURCE_CONFIRMED` — captured from an official city interpretation (GIS layer,
  official guide/tool); the underlying adopted text was not itself captured.
- `ASSUMPTION` — an explicit modeling input, not a claim about the world.
- `CONFLICT` — sources disagree; the conflict is described, not resolved.
- `UNKNOWN` — could not be retrieved or computed; deliberately left empty.
- `EXPERT_REQUIRED` — requires professional/official judgment Acrevia will not
  simulate.
- `STALE` — previously captured, superseded or aging past confidence.

### Authority hierarchy

```
ADOPTED_CODE                 adopted ordinance text (highest authority)
        ↓
OFFICIAL_GIS                 official city/county parcel + zoning layers
        ↓
OFFICIAL_CITY_TOOL           official city interpretation engines (e.g. L&I
                             Zoning Summary Generator)
        ↓
OFFICIAL_CITY_REFERENCE      official city-published guides (e.g. PCPC
                             Zoning Quick Guide, Feb 2026)
        ↓
PROPERTY_SELF_REPORTED       the property owner's own public statements
        ↓
SECONDARY                    news/aggregators — context only, never load-bearing
```

A rule can be `SOURCE_CONFIRMED` at the guide level while its legal finality
remains `EXPERT_REVIEW_REQUIRED` because the adopted text was not captured.
Both dimensions are recorded separately on purpose.

### Categories

`jurisdiction`, `zoning-district`, `use-permission`, `setback-front`,
`setback-side`, `setback-rear`, `height`, `lot-width`, `lot-area`,
`occupied-area`, `density`, `far`, `parking`, `overlay`, `bonus`, `site-condition`,
`governance`, `title`, `environmental`, `access`, `utilities`.

## Provenance rules

1. No rule may carry `VERIFIED` or `SOURCE_CONFIRMED` without a manifest source
   and (for the canonical pack) a cached raw evidence file where one exists.
2. Timestamps are UTC, recorded at fetch time to the minute; a few early fetches
   were reconstructed to the nearest recorded anchor in the session window and
   are marked in the manifest notes.
3. Where official sources disagree (e.g. OPA `total_area` vs the recorded parcel
   polygon), the disagreement is recorded, never silently resolved.
4. Parcel area claims distinguish recorded values (assessor/registry) from
   computed values (method named in the feature properties).
5. Developable-area claims are **not** made anywhere in this pack. Parcel area is
   a fact about geometry; what can be built is a computation for the future
   solver under its own explicit assumptions.

## Validation

`tests/benchmark.test.ts` structurally validates every fixture offline:
manifest/rule cross-references, status and authority enums, GeoJSON geometry
sanity and area tolerance, ISO timestamps, category coverage (every required
zoning dimension appears as a rule or an open question), and — deliberately —
that the canonical pack contains unresolved items. A benchmark with zero
`UNKNOWN`/`EXPERT_REQUIRED` entries would be suspicious, not impressive.
