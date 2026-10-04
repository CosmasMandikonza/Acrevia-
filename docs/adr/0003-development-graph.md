# ADR 0003 — Development Graph: typed causal project state

Status: accepted with issue #3 (after the final integrity pass).

## Outcome and scope

Issue #3 adds Acrevia's canonical project state under `src/domain/` (graph,
evidence, constraints, property, scenarios, review, events, views, units), typed
mutation commands under `src/commands/`, and a benchmark adapter plus persistence
boundary under `src/adapters/`. No UI, solver, GIS, LLM, or renderer behavior is
included; the workspace shell is untouched. The graph is an explicit causal model
over typed nodes and edges — not a graph database, per the approved preflight and
the Issue #3 architecture addendum.

## Decisions

1. **Five truth layers, five vocabularies.** SourceArtifact → Claim →
   Regulation → Constraint (discriminated union) → ConstraintResult/Scenario/
   ScenarioCertificate, with StakeholderView as presentation only. Authority,
   evidence, computation, freshness, and review states are separate enums and
   tested as non-assignable.
2. **Origin ≠ evidence (addendum correction 1).** `OriginKind`
   (SOURCE_DERIVED / USER_DECLARED / MODELER_DECLARED / SYSTEM_DERIVED) is
   provenance, carried as an `origin` object. Mission constraints are
   USER_DECLARED with no evidence state; assumptions are MODELER_DECLARED
   entities. Commands reject masquerades.
3. **Two hashes, explicitly named (correction 3).** `semanticHash` on every node
   (SHA-256 of the canonical semantic view); `rawContentHash` on SourceArtifacts
   (SHA-256 of captured bytes/normalized text). Timestamps are never semantic:
   `meta` plus the key names retrievedAt/generatedAt/declaredAt/occurredAt/
   createdAt/lastModifiedAt are stripped before hashing, so a capture-time change
   can never drift a hash, while `supersededBy` IS semantic and does.
4. **Certificates pin transitive consequential closure (correction 2).**
   `recordScenario` computes the dependency closure of its direct inputs
   (constraints + regulations + claims + source artifacts, parcel geometry +
   its grounding claim, mission constraints, active assumptions) and pins
   `{nodeId, nodeKind, revision, semanticHash}` for each. Views, narrative,
   unused sources/constraints are structurally unreachable and therefore never
   pinned. A source-only supersession invalidates a certificate without touching
   the constraint — enforced by a mandatory test.
5. **Freshness semantics.** CURRENT / STALE / INVALIDATED, where STALE means
   dependency drift (recompute may restore) and INVALIDATED means retraction or
   conflict (superseded artifact, conflicted/superseded regulation, missing
   node). The global project revision is never used for staleness.
6. **Versioned source identity (addendum).** Logical source key + `@v{version}`
   node id. Historical captured content and rawContentHash are immutable;
   `supersedeSourceArtifact` mutates only lifecycle metadata, explicitly marks
   caller-named regulations conflicted (no automatic conflict detection — that
   is #5's compiler), and forces dependent certificates to INVALIDATED.
7. **Commands + event-sourcing-lite.** addSourceArtifact, recordClaim,
   upsertRegulation, materializeConstraint, confirmMissionConstraint,
   setAssumption, recordScenario, open/updateExpertReviewItem,
   updateStakeholderView, supersedeSourceArtifact. Each validates (Zod +
   cross-field rules), mutates, appends a ProjectEvent (actor, revisions,
   correlationId), and re-grades certificates. No generic JSON-edit command
   exists, which is what will make Copilot tools (#10) safe.
8. **Persistence boundary.** `ProjectRepository` + `InMemoryProjectRepository` +
   deterministic `ProjectCodec` (canonical JSON encode, Zod-validated decode —
   the single boundary). Optimistic concurrency: saves conflict only against
   stored revisions; a first save of a freshly built project overwrites nothing.
   PostgreSQL/PostGIS remains deferred (ADR 0001 boundary); nothing here is a
   production persistence story.
9. **Benchmark adapter isolation.** `src/adapters/benchmarks/` owns fixture
   schemas and `mapBenchmarkToProject`. Fixture types do not leak (enforced by
   an isolation test). Statuses map 1:1; FAR stays UNKNOWN with no regulation,
   no constraint, and no default; interpretation needed for executable form
   (tiered density, occupied-area by lot type, contextual setbacks) happens in
   the adapter with the fixture's verbatim quote preserved on the claim.
10. **Type/schema bridge.** Zod v4 schemas validate at boundaries; the 15-member
    node union is hand-written in TypeScript and bridged to the runtime schemas,
    because deeply nested zod inference degraded to `unknown`. Constraint
    variants use a `constraintKind` discriminator (distinct from the node
    `kind`). This trades inference auto-sync for stable narrowing; tests pin
    schema/type agreement through round trips.
11. **Certificate history.** Re-recording a scenario issues a NEW certificate
    node (`:v2`, `:v3`, …) rather than overwriting the old proof, so "true as of
    these exact inputs" remains inspectable after inputs change.

## Validation

79 domain tests across 9 files (plus 7 foundation and 33 benchmark-structure
tests; full suite 119): Philadelphia contract mapping, dependency-aware
invalidation (incl. the mandatory source-only supersession), serialization and
hashing, persistence round trip and optimistic concurrency, traversal and
scenario-explicit `explainMetric(project, scenarioId, metricId)`, units/enums/
commands, architecture isolation, review hardening, and the final-pass
integrity suite (scenario-head edge replacement, node-id kind integrity,
supersession-history immutability, encode-side validation). The codec's
integrity pass runs on BOTH encode and decode.

## Consequences

- Downstream issues consume `src/domain` (public barrel) and commands — never
  fixture types, never raw node mutation.
- `explainMetric(project, scenarioId, metricId)` returns the provenance chain as data, which is the shape the
  future Proof surface (#11) renders.
- Deferred: PostgreSQL/PostGIS mapping, automatic conflict detection (#5),
  certificate re-issuance workflow (#7), Watch-driven re-verification (#17),
  secondary-fixture adapter polish.
- zod is the only new runtime dependency.
