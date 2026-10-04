# ADR 0002 — Benchmark fixture format and source-authority hierarchy

Status: proposed for review with issue #2.

## Outcome and scope

Issue #2 adds a real-property benchmark pack under `docs/benchmarks/`: one canonical
property (Calvary Memorial Church, Philadelphia) with cached raw evidence, plus three
secondary properties (Washington DC, Minneapolis, Portland). The pack is a research
artifact — structured facts with provenance — consumed by future issues (#3 Development
Graph, #5 regulatory compiler, #7 solver, #11 evidence ledger, #16 evals) as gold test
input. It contains no code, no computed feasibility, and no legal conclusions.

## Decisions

1. **Benchmark-local schema, not a domain model.** The fixture files
   (`sources.manifest.json`, `parcel.geojson`, `rules.expected.json`,
   `open-questions.json`) use a deliberately flat, pack-local vocabulary
   (`acrevia.benchmark.*.v1`). This preserves ADR 0001's boundary: the foundation does
   not invent Project/Scenario/Constraint/Evidence contracts, and issue #3 owns the
   canonical Development Graph. Downstream issues must map these fixtures into the graph
   rather than import them as the model. If #3's contracts diverge, the fixtures get a
   mapping layer — they do not silently become the schema.
2. **Two-dimensional trust.** Every rule records an `authorityLevel` (where the fact
   sits in the source hierarchy: ADOPTED_CODE > OFFICIAL_GIS > OFFICIAL_CITY_TOOL >
   OFFICIAL_CITY_REFERENCE > PROPERTY_SELF_REPORTED > SECONDARY) and a `status`
   (VERIFIED / SOURCE_CONFIRMED / ASSUMPTION / CONFLICT / UNKNOWN / EXPERT_REQUIRED /
   STALE), plus `legalFinality: EXPERT_REVIEW_REQUIRED` throughout. "The official city
   guide says 38 ft" and "this is legally settled" are different claims; the format
   never lets one masquerade as the other.
3. **Adopted-text capture is distinguished from official interpretation.** `VERIFIED`
   is reserved for adopted code/ordinance text captured live with a verbatim quote
   (Philadelphia § 14-802 parking and § 14-548 overlay; DC ZR16 consolidated export
   tables; Portland Title 33 chapter PDFs). The official PCPC Quick Guide, GIS layers,
   and city tools yield `SOURCE_CONFIRMED`. This split was forced by reality: the
   Philadelphia code host bot-blocks plain clients, and one research pass returned
   dimensional values that independent verification showed were wrong — the failure
   mode this format is designed to expose.
4. **Reproducibility over automation.** Each property README records exact
   reproduction queries. The canonical pack caches trimmed raw evidence responses in
   `raw/` so an auditor can verify without network access. No scraping pipeline exists
   in the repository by design (#5 owns future retrieval).
5. **No derived feasibility.** The pack records rules and site conditions, not
   outcomes: no unit counts, no developable-area claims, no parking-lot claims. Parcel
   area is geometry; what can be built is a solver computation under explicit
   assumptions.
6. **Unknowns are content.** `open-questions.json` is a first-class fixture tested for
   presence. A benchmark with no UNKNOWN or EXPERT_REQUIRED entries would be
   conveniently fictional, so the test suite requires them.

## Validation

`tests/benchmark.test.ts` (Vitest, offline) structurally validates every property
directory: manifest/rule cross-reference integrity, status and authority enums, ISO-8601
timestamps, GeoJSON ring closure and coordinate sanity, computed-vs-recorded area
tolerance, category coverage (each required zoning dimension appears as a rule or an
open question), VERIFIED/SOURCE_CONFIRMED records carry quotes and code sections, and
the canonical pack keeps unresolved items and raw evidence present.

## Consequences

- Later issues get a stable, auditable gold input without blocking on #3.
- The authority/status vocabulary is a prototype for the future evidence ledger (#11);
  #3/#11 should formalize, not fork, these concepts.
- Maintenance: re-verification of sources is manual until Watch (#17) exists; each
  README states the re-check obligation.
- The four properties are real congregations/institutions; the pack contains publicly
  available records and published contact paths only, and makes no claim of any
  relationship with any of them.
