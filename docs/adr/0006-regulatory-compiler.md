# ADR 0006 — Regulatory Compiler: extractor proposes, verifier decides, graph records, solver gate filters

Status: proposed with issue #5 (revised twice after PR #28 review).

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

2. **Semantic rule identity.** Every candidate carries a `semanticRuleKey`
   (`height:max:principal`, `use:multi-family:permission`,
   `overlay:/six:adu-prohibition`, `overlay:/six:applicability`, ...).
   Identity rules: candidateId/claimId = UNIQUE EVIDENCE OBSERVATION
   (`<semanticRuleKey>:<sourceRef>`); regulationId/constraintId = the
   SEMANTIC LEGAL RULE (`<semanticRuleKey>`). Duplicate candidate ids are
   rejected loudly. Different legal propositions (/SIX applies vs ADUs
   prohibited in /SIX) never collapse; the ADU constraint traces to the
   prohibition regulation, claim, and verbatim quote specifically.
   CandidateRule carries everything needed for independent checking:
   source identity + artifact id, verbatim text, locator, retrieval metadata,
   normalized value+unit, applicability, extraction method. A candidate is
   NOT canonical truth and never writes to project.nodes.

3. **Verification decides (second pass), independently bound to the
   capture.** Compiler-internal ACCEPT/REJECT decisions — deliberately NOT
   EvidenceState values (the domain vocabulary stays VERIFIED /
   SOURCE_CONFIRMED / CONFLICT / UNKNOWN / EXPERT_REQUIRED / STALE). The
   verifier never trusts extractor-supplied authority, dates, or quotes.
   Every candidate carries an EVIDENCE ANCHOR (`{documentId, exactText}`) —
   a fragment that literally exists in the captured bytes (raw table line,
   matched regex span, JSON attribute fragment). The verifier resolves the
   anchor document, requires its sourceRef to match, requires the anchor
   text to exist in the capture, and cross-checks sourceArtifactId /
   authority / retrievedAt against the captured-version metadata. For
   deterministically-readable predicates the proposed value must agree with
   a value independently parsed from the anchor. Rejections: spoofed
   authority, invented retrieval dates, invented quotes/anchors, unknown
   anchor documents, mismatched artifact ids, anchor-says-38-but-proposes-55
   values, missing locators, non-finite/non-positive quantities (0 parking
   spaces is valid law; 0 ft height is not), and district applicability that
   does not match the subject. An LLM extractor (#10) can propose, but never
   gains authority over evidence.

4. **Conflict analysis is explicit, not a rank+date comparator.** Grouping
   by SEMANTIC RULE KEY; disagreement is measured in NORMALIZED LEGAL
   SEMANTICS — quantities (`q:<value> <unit>`), use permissions
   (BY_RIGHT/SPECIAL_EXCEPTION/PROHIBITED), overlay prohibitions
   (`prohibits:<subject>`), parking formulas (normalized text) — so
   `multi-family = BY_RIGHT` vs `SPECIAL_EXCEPTION` conflicts exactly like
   55 ft vs 45 ft. Resolution reasons about authority, currentness,
   supersession, and applicability:
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

5. **Claims are per captured-version observation**
   (`phl:claim:<semanticRuleKey>:<sourceArtifactId>`): the excluded 55 ft
   memo and the winning 45 ft adopted code each keep their own claim, and
   same-logical-source versions (S5@v1 = 55, S5@v2 = 45) are distinct
   candidate/claim identities with both retained for inspection; ONE
   regulation per semanticRuleKey cites only the executable captured
   version's claims and carries conflictRefs. Source binding prefers the
   captured version (sourceArtifactId) so versioned evidence resolves to its
   own metadata.

6. **Canonical compilation is TRULY idempotent and audited.** Source
   artifacts are constructed from REAL captured bytes (SHA-256 over the
   source's files combined deterministically in sorted-name order; exact
   AuthorityLevel->SourceType mapping; no fabricated hashes) and ALWAYS
   replay through addSourceArtifact so its immutability guard verifies exact
   content. Claims/constraints/reviews are create-only with deterministic
   ids. Regulations are grouped ONE per semanticRuleKey and an exact
   semantic replay is SKIPPED — re-compiling identical evidence runs ZERO
   commands: revision, event count, edges, regulation revisions, node
   semantic hashes, and the canonical encoded state are all unchanged.
   CONFLICT LIFECYCLE: when later evidence creates an unresolved conflict,
   the old constraint remains for audit, the regulation is upserted to
   currentness STALE with conflictRefs, the gate excludes it, a deterministic
   expert review opens whose affectedNodeIds reference REAL graph nodes
   (claims, regulation, source artifacts, constraint — never candidate ids),
   and dependent certificates grade non-CURRENT through the existing
   freshness machinery. Previously-trusted rules go stale through TYPED
   COMMANDS, never by erasing history.

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

9. **Property binding is fail-closed.** `/api/regulatory/compile` separates
   JURISDICTION-LEVEL LAW from PROPERTY-SPECIFIC EVIDENCE: the signed
   accepted session supplies property identity, base district, overlays, and
   site facts; the reusable benchmark corpus contributes ONLY jurisdiction-
   wide legal texts (S5/S6/S7) — never Calvary's property-specific captures
   (S1-S4/S8-S11). RM-1-column law compiles only when the signed property is
   actually RM-1; /SIX law only when the signed overlays prove /SIX applies;
   a missing district NEVER defaults to RM-1 (needs-evidence); districts
   outside the captured corpus get an honest unsupported-district state.
   Browser-proven A->B: accepting the JFK property after Calvary shows the
   honest unavailable state and zero Calvary rules, facts, or overlays.

10. **UI scope.** A COMPILED LAW section on the existing Evidence surface —
   values, locators, sources, evidence states, honest unresolved dimensions,
   visible conflicts with the excluded value and why it lost; honest
   unavailable states for unsupported properties. Inspection list, not a
   dashboard; the map/property remains the hero.

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
