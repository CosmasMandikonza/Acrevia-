## What

Closes #5. Acrevia now **compiles law instead of retrieving it**: raw captured evidence becomes typed, verified, conflict-analyzed, executable constraints — with the hard invariant **no uncited regulation enters the solver** and, after the PR review, **no law applies to a property unless Acrevia can prove both the law and the applicability**.

The hero adversarial case works end to end from the committed fixture: an older favorable source says **55 ft**; a newer authoritative adopted code says **45 ft** → Acrevia refuses 55, keeps only 45 executable, keeps the competing source visible with explainable provenance, and dependent certificates go stale through the typed command machinery.

## Architecture (ADR 0006, revised)

`extractor proposes → verifier decides → graph records → solver gate filters`

- **Property binding (fail-closed).** `/api/regulatory/compile` separates jurisdiction-level law from property-specific evidence: the signed accepted session supplies property identity, base district, overlays, and site facts; the reusable corpus contributes ONLY jurisdiction-wide legal texts (S5/S6/S7) — never Calvary's property-specific captures (S1-S4/S8-S11). RM-1 law compiles only when the signed property is actually RM-1; `/SIX` law only when the signed overlays prove `/SIX` applies; a missing district never defaults to RM-1 (needs-evidence); districts outside the captured corpus get an honest unsupported-district state. API-proven (4 route tests) and browser-proven (A→B: JFK after Calvary shows the honest unavailable state and zero Calvary rules, facts, overlays, or `/SIX`).
- **Semantic rule identity.** Every candidate carries a `semanticRuleKey` (`height:max:principal`, `use:multi-family:permission`, `overlay:/six:applicability` vs `overlay:/six:adu-prohibition`). candidateId/claimId = unique evidence observation (`<key>:<sourceRef>`); regulationId/constraintId = the semantic rule (`<key>`); duplicate candidate ids are rejected loudly. Proven: /SIX applicability ≠ /SIX ADU prohibition, with the ADU constraint tracing specifically to the prohibition regulation, claim, and verbatim quote.
- **Qualitative conflicts.** Disagreement is measured in normalized legal semantics — quantities (`q:38 ft`), use permissions (BY_RIGHT/SPECIAL_EXCEPTION/PROHIBITED), overlay prohibitions (`prohibits:<subject>`), parking formulas (normalized text) — so `multi-family = BY_RIGHT` vs `SPECIAL_EXCEPTION` BLOCKs exactly like 55 vs 45. Arbitrary prose across different semanticRuleKeys never compares.
- **Conflict lifecycle.** A previously-executable 38 ft rule confronted with later equal-authority 45 ft evidence: the old constraint REMAINS for audit, the regulation is upserted to currentness STALE with conflictRefs, the solver gate excludes it, a deterministic expert review opens whose affectedNodeIds reference REAL graph nodes only (claims, regulation, source artifacts, constraint — never candidate ids; asserted per-node), and the dependent certificate grades STALE while the unrelated one stays CURRENT.
- **Source artifact truth.** Artifacts are built from REAL captured bytes: SHA-256 over the source's files combined deterministically (sorted names; order-invariant), exact AuthorityLevel→SourceType mapping (adopted_code/official_gis/official_city_tool/official_city_reference/property_self_reported/secondary), and the compiler ALWAYS replays through `addSourceArtifact` so the immutability guard verifies exact content. Tests prove: byte changes change the hash; same id + changed content fails loudly; source types preserved exactly; sources without captured bytes are never fabricated.
- **True idempotency.** Regulations are grouped ONE per semanticRuleKey; an exact semantic replay is SKIPPED. Re-compiling identical evidence runs ZERO commands — proven by asserting project.revision, event count, edges, regulation revisions, node semantic hashes, and the canonical encoded state are ALL unchanged, plus ProjectCodec integrity on the encoded result.
- **Executable solver gate.** `selectExecutableConstraints → { executable, decisions[] }` with per-constraint reasons over Constraint→Regulation→Claims→Sources; #7 consumes only this.
- **True source-supersession certificate test.** raw evidence → compiled constraint → certificate depends on it → newer artifact of the same logical source arrives → typed supersession → the rule is excluded from the gate with the "superseded" reason → the dependent certificate grades STALE/INVALIDATED **for the supersession reason** → the unrelated certificate stays CURRENT.

## Benchmark parity (gold tests)

Extractor reads only raw evidence and matches the curated oracle: **all 27 rules** (predicate, value, unit, source). **FAR stays UNKNOWN** — never 0, never "not applicable." Lot-width/lot-area stay sourced claim+regulation facts without fake constraints until #7. No Affordability/Exception variants invented.

## UI (minimal, Evidence surface)

COMPILED LAW section with values, locators, sources, VERIFIED/SOURCE CONFIRMED chips, honest "Unresolved: far", visible conflicts, and — new — honest unavailable states for unsupported properties ("will not apply another district's law"). Screenshots: `docs/reviews/issue-5/compiled-law-1-evidence.png`, `compiled-law-2-property-a.png`, `compiled-law-3-property-b.png`.

## Tests

- **Vitest 251/251** (24 files; 27 regulatory tests: extraction parity ×4, pipeline ×9 incl. hero/qualitative/lifecycle/idempotency/supersession-certificate, source truth ×2, benchmark full-compile ×4, property binding ×4).
- **Playwright 57/57 on dev** (regulatory compiled-law 3 + regulatory property-binding 3 + mission 15 + site-hardening 30 + gis-flow 6) and **regulatory journeys on a production build** with the signing secret set.
- `tsc --noEmit` strict clean, `eslint` clean, `next build` clean.

## Intentionally deferred

- **#7 Solver** — consumes `selectExecutableConstraints` only.
- **#10 Copilot** — model-backed extraction behind the same adapter interface.
- lot-width/lot-area executable constraints; affordability/exception variants; broader district corpus beyond RM-1 (fail-closed today); retiring the legacy benchmark mapper (kept as seed; parity proven).
