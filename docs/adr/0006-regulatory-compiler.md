# ADR 0006 — Regulatory Compiler: extractor proposes, verifier decides, graph records, solver gate filters

Status: proposed with issue #5.

## Context

Issue #5 replaces the direct rules.expected.json benchmark mapping with a
real regulatory compiler: raw captured evidence + source-manifest metadata
become typed CandidateRules, which are deterministically verified,
conflict-analyzed, and only then recorded into the Development Graph as
Claim → Regulation → Constraint through the typed command boundary. The
benchmark fixture becomes a test ORACLE only — never compiler input — so the
benchmark cannot be circular.

## Decisions

1. **Extraction boundary.** `RegulatoryExtractionAdapter.extract(input)` —
   a typed interface with a deterministic benchmark implementation that
   parses the ACTUAL captured evidence (markdown code captures, ArcGIS JSON,
   CARTO rows, GeoJSON) under `docs/benchmarks/.../raw/` plus manifest
   metadata. No model, no network; identical documents produce identical
   candidates in deterministic order. A Gloo/model-backed extractor (#10)
   can implement the same interface and produce the same CandidateRule
   contract; verification and everything downstream stay deterministic
   either way.

2. **CandidateRule carries everything needed for independent checking**:
   candidateId, sourceArtifactId + sourceRef, subject, jurisdiction,
   predicate, proposedValue (quantity/qualitative/unknown), applicability,
   codeSection locator, verbatimSupportingText, authority, retrieval/effective
   metadata, extractionMethod. A candidate is NOT canonical truth and never
   writes to project.nodes.

3. **Verification decides (second pass).** Compiler-internal ACCEPT/REJECT
   decisions — deliberately NOT EvidenceState values (the domain vocabulary
   stays VERIFIED / SOURCE_CONFIRMED / CONFLICT / UNKNOWN / EXPERT_REQUIRED /
   STALE). Rejections: hallucinated sourceRef, missing verbatim text, missing
   locator for regulatory rules, non-finite/non-positive quantities where the
   dimension demands them (0 parking spaces is valid law; 0 ft height is
   not), and applicability that does not match the subject district.

4. **Conflict analysis is explicit, not a rank+date comparator.** Grouping
   by jurisdiction+subject+predicate+applicability+dimension; only genuinely
   disagreeing quantity values conflict. Resolution reasons about authority,
   currentness, supersession, and applicability:
   - same logical source, newer capture → SUPERSEDED (supersession machinery);
   - adopted code vs older/lower source → lower EXCLUDED ("never overrides
     adopted code"), discrepancy stays visible as a CONFLICT claim with full
     provenance, adopted stays executable if independently verified;
   - equal-authority incompatible, unresolved → BLOCKED + one deterministic
     EXPERT_REQUIRED review; nothing executable;
   - newer lower-authority summary vs adopted code → never silently
     overrides; flagged for re-verification.
   Decisions are computed over sorted groups, so [55, 45] and [45, 55]
   produce identical results (source-order invariance, tested).

5. **Claims are per evidence observation** (`phl:claim:<rule>:<sourceRef>`):
   the excluded 55 ft memo and the winning 45 ft adopted code each keep
   their own claim, so discrepancies stay inspectable; regulations cite only
   executable (corroborating) claims and carry conflictRefs.

6. **Canonical compilation is idempotent and audited.** Source artifacts
   replay exactly (create-only, content-immutable); claims/constraints/
   reviews are create-only with deterministic ids (compiler skips existing);
   regulations upsert with edge replacement. Re-running the compiler on the
   same evidence leaves the semantic graph unchanged — no duplicate claims,
   regulations, reviews, or conflict references. Previously-trusted rules go
   stale through TYPED COMMANDS (supersedeSourceArtifact / upsertRegulation),
   never by erasing history; the executable gate then excludes them and the
   dependency-aware freshness machinery invalidates dependent certificates.

7. **Executable solver gate returns reasons, not just an array.**
   `selectExecutableConstraints(project)` → `{ executable, decisions }` with
   per-constraint Constraint→Regulation→Claims→Sources traversal. An
   executable regulatory constraint requires: regulation CURRENT and not
   superseded and citing claims; claims exist, SOURCE_DERIVED,
   VERIFIED/SOURCE_CONFIRMED, with verbatim quotes; source artifacts resolve
   and are not superseded; no unresolved BLOCKING expert review in the chain.
   EvidenceState belongs to CLAIMS — the gate never demands evidence of a
   SourceArtifact. **No uncited regulation enters the solver (#7 consumes
   only this gate's output).**

8. **Vocabulary discipline.** No MACHINE_CHECKED added to EvidenceState; no
   AffordabilityConstraint or Exception variants invented — lot-width and
   lot-area stay sourced claim+regulation facts without fake executable
   constraints until #7 defines their participation; FAR stays UNKNOWN
   (never 0, never "not applicable").

9. **UI scope.** A COMPILED LAW section on the existing Evidence surface —
   values, locators, sources, evidence states, honest unresolved dimensions,
   visible conflicts with the excluded value and why it lost. Inspection
   list, not a dashboard; the map/property remains the hero.

## Consequences

- The benchmark mapper remains as the legacy seed for existing tests; the
  compiler path produces the same executable values from raw evidence
  (proven by parity tests) and can replace it when #7 lands.
- `/api/regulatory/compile` exposes the compiled-law view for an accepted
  property using the same verified-pair + hash-gated rebuild trust model as
  the mission bridge (ADR 0005) — stateless, deterministic.
- #7 Solver consumes `selectExecutableConstraints` only; #10 can add
  model-backed extraction behind the adapter interface; Proof/Copilot/
  Council can cite the gate's reasons for "why wasn't this rule used?"
