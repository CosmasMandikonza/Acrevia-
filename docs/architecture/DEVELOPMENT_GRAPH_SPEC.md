# Development Graph Architecture Preflight

Status: implementation contract for Issue #3.

This document exists to prevent Acrevia's core from collapsing into either:
- a generic collection of TypeScript interfaces, or
- a premature graph-database abstraction that looks sophisticated but does not protect truth.

The Development Graph is the **shared causal model** behind Site, Mission, Scenarios, Forge, Copilot, Proof, Capital, Council, Atlas, and Watch.

It must make Acrevia capable of answering not only:

> What is true?

but also:

> Where did this come from?
> What depends on it?
> What changed?
> Which outputs are now stale?
> What can the system compute?
> What must a human still decide?

---

## 1. Core architectural idea

"Graph" means explicit relationships and dependency traversal.

It does **not** require a graph database for Issue #3.

The first implementation should use explicit typed nodes/relations, deterministic serialization, and repository-friendly persistence boundaries. PostgreSQL/PostGIS can later persist the same contracts.

Avoid adding Neo4j or another graph datastore merely to justify the word "Graph."

The differentiator is **causal traceability**, not database branding.

---

## 2. The five truth layers

Acrevia must not collapse these layers into one generic `status` field.

### A. Source

What document/API/user statement exists?

Examples:
- adopted ordinance page
- official zoning GIS response
- city planning guide
- parcel geometry
- church-declared mission goal

### B. Claim

What atomic statement did Acrevia obtain from that source?

Examples:
- parcel zoning = RM-1
- max height = 38 ft
- preserve sanctuary = true
- Sunday parking target = 100 spaces

A claim can be supported, contradicted, stale, unknown, or require review.

### C. Interpreted rule / constraint

What does a claim mean computationally?

Examples:
- `HeightConstraint(max=38 ft)`
- `ParkingConstraint(required=0 for multifamily)`
- `MissionParkingConstraint(min=100 spaces)`

A source claim is not automatically executable.

### D. Computation

What did a deterministic engine calculate from executable constraints?

Examples:
- buildable envelope
- parking allocation
- candidate scenario
- unit count
- funding gap

### E. Decision / communication

What does the product show to a stakeholder?

Examples:
- scenario selected for board discussion
- council slide
- professional handoff question

Views may rephrase facts. They may not create new truth.

---

## 3. Minimum canonical model

Issue #3 should implement these concepts as runtime-validated domain objects.

### Project

Aggregate root.

Required:
- `projectId`
- `schemaVersion`
- `revision`
- `createdAt`
- `updatedAt`
- property identity
- node collections
- relation/dependency records
- project event log

### Property

Identity and human-facing property metadata.

Do not make an address the project identity.

### Parcel

Required:
- source parcel identifier
- geometry
- CRS
- recorded area where available
- computed area where available
- source/evidence references

Never store a parcel area without distinguishing source-recorded vs computed.

### ExistingStructure

Required:
- geometry or footprint reference
- known dimensions/height when available
- use/identity claims
- evidence refs
- uncertainty where applicable

### JurisdictionAssignment

Required:
- jurisdiction
- assignment method
- evidence refs
- evidence state
- effective/currentness metadata where known

### SourceArtifact

Represents a particular retrieved source version.

Required:
- stable id
- source type
- title/publisher
- canonical URL
- authority level
- retrievedAt
- effective date / version where available
- content hash when bytes/text are captured
- raw evidence location/reference when available

Important: the same URL retrieved on a later date can be a different SourceArtifact version.

### Claim

Atomic assertion grounded in one or more sources.

Required:
- claim id
- subject
- predicate/category
- normalized value
- unit where relevant
- source refs
- exact quote/excerpt where applicable
- evidence state
- confidence/ambiguity metadata if used
- valid/effective interval where known

Claims are evidence. They are not executable rules by default.

### Regulation

An interpreted legal/regulatory statement.

Required:
- jurisdiction
- code section/table
- applicability conditions
- source claims
- interpretation state
- currentness state
- conflict refs if any

### Constraint

A discriminated union, not a free-form blob.

Initial variants should support at least:
- use permission
- height
- setback
- occupied area / lot coverage
- density
- parking
- overlay restriction
- affordability / bonus rule where benchmark data supports it

Every executable regulatory constraint must point back to supporting regulation/claim/source.

### MissionConstraint

User-declared values are different from external facts.

Required:
- exact user-declared intent
- normalized executable representation
- confirmation state
- priority / hard-vs-soft semantics
- actor / origin
- event version
- status

Never mark mission inputs SOURCE_CONFIRMED.

### Assumption

Explicit modeling input that cannot currently be claimed as fact.

Examples:
- target unit mix
- average unit size
- construction cost assumption
- unknown parking-stall baseline during early scenario work

Required:
- value/unit
- rationale
- owner/actor
- createdAt
- expiration/review trigger where appropriate

### Scenario

Represents a proposed computed outcome, not truth about the property.

Required:
- scenario id
- generation status
- input dependency fingerprint
- solver version
- explicit assumptions
- metrics
- geometry references/output
- constraint results
- createdAt

### ConstraintResult

Do not reuse evidence states here.

Use a computation-oriented vocabulary such as:
- SATISFIED
- VIOLATED
- UNKNOWN
- NOT_EVALUATED
- EXPERT_REQUIRED

Required:
- constraint id
- evaluation status
- actual/computed value where relevant
- limit/target
- explanation payload
- derivation refs

### ScenarioCertificate

This is the proof object that makes downstream trust possible.

Required:
- scenario id
- certificate version
- solver version
- exact dependency refs + content/revision hashes
- assumptions used
- constraint result ids
- generatedAt
- certificate hash
- freshness state

A certificate is stale when any dependency that matters to it changes.

### ExpertReviewItem

Required:
- exact unresolved question
- why it matters
- affected node/scenario refs
- evidence refs
- blocking/non-blocking severity
- review status
- resolution provenance if later closed

### ProjectEvent

Use **event-sourcing-lite**, not full event sourcing.

Current materialized project state remains primary, but every consequential mutation records:
- event id
- actor
- event type
- timestamp
- affected node ids
- prior revision
- next revision
- reason / command
- correlation id when one user action changes several nodes

This gives us auditability without making event replay the only way to reconstruct state.

### StakeholderView

Derived presentation configuration only.

It may contain:
- audience
- selected scenario
- saved spatial viewpoints
- narrative preferences
- visible evidence depth

It must never contain independent copies of feasibility metrics as truth.

---

## 4. Trust vocabularies must remain separate

The benchmark discovered why one overloaded status enum is dangerous.

### Source authority

Keep the benchmark hierarchy, formalized by #3:

- ADOPTED_CODE
- OFFICIAL_GIS
- OFFICIAL_CITY_TOOL
- OFFICIAL_CITY_REFERENCE
- PROPERTY_SELF_REPORTED
- SECONDARY

### Evidence state

Formalize carefully from benchmark semantics:

- VERIFIED
- SOURCE_CONFIRMED
- ASSUMPTION
- CONFLICT
- UNKNOWN
- EXPERT_REQUIRED
- STALE

### Computation state

Separate:
- SATISFIED
- VIOLATED
- UNKNOWN
- NOT_EVALUATED
- EXPERT_REQUIRED

### Artifact freshness

Separate:
- CURRENT
- STALE
- INVALIDATED

### Human review state

Separate:
- OPEN
- IN_REVIEW
- RESOLVED
- WAIVED

Do not compress these into one enum.

---

## 5. Dependency graph and invalidation

This is the heart of the Development Graph.

Every derived artifact must expose what it depends on.

Represent dependencies explicitly with references similar to:

```ts
type DependencyRef = {
  nodeId: string;
  nodeType: string;
  revision: number;
  contentHash: string;
};
```

A scenario certificate stores the dependency refs that actually affected the scenario.

Do **not** invalidate every scenario merely because the global project revision changed.

Example:

Changing a Council-view title should not stale geometry.

Changing:
- max height,
- parcel geometry,
- mission parking target,
- sanctuary-preservation geometry,
- density rule,
- active assumption used by solver

**must** stale affected scenario certificates.

Required query:

```ts
isArtifactStale(project, certificate): boolean
```

Required traversal capabilities:

- `getDependencies(nodeId)`
- `getDependents(nodeId)`
- `getEvidenceChain(nodeId)`
- `getAffectedArtifacts(changedNodeIds)`
- `explainMetric(metricId)`

These may be implemented with maps/arrays in Issue #3. They do not require a graph database.

---

## 6. Deterministic identity and hashing

Derived trust requires stable identity.

For material nodes:
- stable semantic id
- explicit revision
- canonical serialization
- SHA-256 or equivalent deterministic content hash

Do not hash timestamps that are not semantically part of a computation dependency.

The same semantic content should serialize identically.

Scenario certificates should be reproducible from:
- project dependency snapshot
- solver version
- solver input assumptions

This allows Watch later to answer:

> This scenario became stale because the max-height source changed.

instead of:

> Something somewhere in the project changed.

---

## 7. Units

No bare numeric values for domain quantities.

Use runtime-validated structures such as:

```ts
type Quantity = {
  value: number;
  unit:
    | "ft"
    | "sq_ft"
    | "percent"
    | "spaces"
    | "dwelling_units"
    | "usd"
    | "ratio";
};
```

Prefer explicit conversion functions over silent coercion.

Do not create a massive physical-units framework in Issue #3.

---

## 8. Geometry

Issue #3 defines contracts, not geometry algorithms.

Geometry-bearing records must preserve:
- geometry
- CRS
- source/provenance
- geometry validity state
- derived-vs-source distinction

Do not make renderer-specific Three.js data part of domain truth.

Forge consumes domain geometry later.

---

## 9. Benchmark mapping

The newly merged benchmark must be consumed through a dedicated adapter.

Create a mapping boundary such as:

```
benchmark fixtures
       ↓
mapBenchmarkToProjectSeed()
       ↓
Development Graph
```

Do not import benchmark JSON shapes throughout application code.

Required canonical test:

Load the Philadelphia fixture and prove that the graph contains, at minimum:
- property identity
- parcel + geometry + source
- RM-1 jurisdiction/zoning claims
- authoritative source artifacts
- regulation/constraint candidates
- 0-space multifamily parking rule
- religious-assembly parking rule
- /SIX ADU prohibition
- dimensional source-confirmed constraints
- FAR unknown
- expert/open questions

The mapping must preserve the difference between:
- VERIFIED adopted code
- SOURCE_CONFIRMED city references
- UNKNOWN
- EXPERT_REQUIRED

---

## 10. Required end-to-end mutation tests

Issue #3 is not done with interface/type tests alone.

### Test A — mission constraint invalidation

1. seed project
2. create scenario certificate depending on mission parking = 80
3. change mission parking to 100
4. prior certificate becomes STALE
5. unrelated evidence records remain unchanged

### Test B — regulatory source supersession

1. seed max height from SourceArtifact A
2. certificate depends on resulting height constraint
3. add newer conflicting SourceArtifact B
4. regulation enters conflict/review state
5. affected certificate cannot remain CURRENT

### Test C — irrelevant project change

1. certificate depends on property/constraint nodes
2. edit stakeholder-view title
3. project revision increments
4. certificate remains CURRENT

This proves invalidation is dependency-aware rather than global-revision theater.

### Test D — unresolved information

1. benchmark FAR is UNKNOWN
2. graph maps it as unknown
3. system does not manufacture FAR=0 or "not applicable"
4. downstream executable constraint is absent unless deliberately modeled

### Test E — provenance chain

For the canonical parking rule:

```
Scenario metric / constraint result
→ executable parking constraint
→ regulation / claim
→ §14-802 SourceArtifact
→ cached raw evidence
```

The full chain must be traversable in code.

### Test F — serialization determinism

Serialize the same graph twice.
Canonical JSON and content hashes must match.

### Test G — round trip

project → storage representation → project

No provenance, unit, state, relation, or version information is lost.

---

## 11. API/service boundary

Issue #3 should define domain/service functions without prematurely building the full backend.

Recommended application boundary:

```ts
interface ProjectRepository {
  get(projectId: string): Promise<Project | null>;
  save(project: Project, expectedRevision: number): Promise<void>;
}
```

Use optimistic concurrency semantics so two future collaborators/agents cannot silently overwrite each other's project state.

A simple file/in-memory adapter is acceptable for tests if production persistence is not yet selected.

If persistence is implemented now, it must not force GIS/geometry into lossy representations.

---

## 12. Domain commands

Prefer explicit mutation commands over arbitrary object editing.

Examples:

- `addSourceArtifact()`
- `recordClaim()`
- `upsertRegulation()`
- `confirmMissionConstraint()`
- `setAssumption()`
- `recordScenario()`
- `openExpertReviewItem()`
- `supersedeSourceArtifact()`

Each command should:
1. validate input,
2. mutate canonical project state,
3. create a ProjectEvent,
4. increment relevant revisions,
5. determine affected derived artifacts,
6. mark them stale/invalidated where necessary.

This makes later Copilot tools much safer because #10 can call typed commands rather than edit JSON.

---

## 13. What NOT to build in Issue #3

Do not:
- implement zoning extraction
- call an LLM
- implement parcel lookup
- solve building geometry
- generate housing unit counts
- add 3D renderer state
- add Capital formulas
- build Council copy
- choose a graph database
- build a generic ontology framework
- build a workflow engine
- turn every field into a node
- pre-design 50 future entity types

The graph should be strong because its invariants are strong, not because it is enormous.

---

## 14. File organization target

The implementer may adapt to current repo conventions, but the end state should resemble:

```
src/domain/
  project/
  evidence/
  constraints/
  scenarios/
  events/
  units/
  graph/
  index.ts

src/adapters/
  benchmarks/
  persistence/

tests/
  domain/
  benchmark-to-graph/
```

Keep domain code framework-agnostic.

React components should consume domain selectors/services, not own the model.

---

## 15. Definition of done

Issue #3 is complete only when:

- the Philadelphia benchmark maps into canonical graph state
- all source/evidence semantics survive mapping
- domain objects are runtime validated
- units are explicit
- dependencies are explicit
- stale detection is dependency-aware
- project mutation creates auditable events
- deterministic serialization/hashing exists
- provenance can be traversed
- optimistic revision semantics exist
- round-trip persistence contract is tested
- scenario certificates cannot remain current after a relevant change
- irrelevant changes do not stale scenarios
- no UI-specific truth exists
- no solver/AI behavior has leaked into the core

The success demo for this issue is not a pretty screen.

It is an engineer changing one underlying fact and watching Acrevia identify exactly which future outputs can no longer be trusted.
