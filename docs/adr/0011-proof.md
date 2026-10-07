# ADR 0011 — Proof: a trusted projection over existing truth

Status: proposed with issue #11.

## Context

Issue #11 makes trust a visible product feature. A pastor must be able to
click "38 ft" and see where the number came from, why it applies to this
parcel, how Acrevia used it, which scenario depends on it, whether that proof
is current, and what still requires a professional — without reading source
code. The repo already contained every truth object needed (ADR 0003's
Development Graph, ADR 0005's mission bridge, ADR 0006's two-strand compiled
law, ADR 0007's certificates); what did not exist was a trusted, complete,
inspectable projection of them.

## Decisions

1. **Proof is a view, never a store.** Everything displayed derives from the
   Development Graph rebuilt per request: SourceArtifact, Claim, Regulation,
   Constraint, MissionConstraint, Assumption, Scenario, ConstraintResult,
   ScenarioCertificate, ConflictRecord, ExpertReview. No Proof-specific
   database, schema, or cached copy of consequential facts exists anywhere in
   the implementation.

2. **One trusted projection endpoint: `POST /api/proof/snapshot`.** The route
   mirrors the solver route's trust boundary exactly — verify the accepted
   `{ envelope, receipt }` pair, rebuild the committed project, hash-gate
   against the signed `projectHash`, compile current law (fail-closed
   property binding: RM-1 corpus only, /SIX only when the signed overlays
   prove it), replay the mission command log through the typed boundary,
   seed assumptions, solve, and record scenarios/certificates — then projects
   the graph into a typed read-only DTO (`acrevia.proof.v1`). Client-supplied
   graph data is never read; optional `scenarioId` / `certificateId` /
   `focusNodeId` are real graph ids validated against the rebuilt project,
   never trusted as data. `/api/solver/solve` is unchanged.

3. **The DTO retains real graph ids and complete linked tables** (sources,
   claims with LAW vs APPLIES-HERE strand classification by namespace,
   regulations, constraints with per-constraint executability reasons and
   both provenance strands, assumptions with where-used, missions, scenarios,
   results, certificates, conflicts, expert reviews, computation questions).
   Historical certificates stay in the DTO, graded — a prior proof remains
   inspectable as "true as of these exact inputs" (ADR 0003 §11).

4. **MACHINE CHECKED is a presentation label only.** It is computed in the
   projection for deterministic ConstraintResults (status SATISFIED/VIOLATED,
   known solver method/version, inspectable actual/limit) and rendered as a
   chip. `EvidenceState` gains no value; EvidenceState ≠ ComputationState ≠
   Origin ≠ Freshness remain separate axes. Status language on the surface is
   restricted to SOURCE CONFIRMED / MACHINE CHECKED / ASSUMPTION / CONFLICT /
   EXPERT REQUIRED / STALE / RECOMPUTE / CURRENT; certification-implying
   language (LEGALLY VERIFIED, APPROVED, PERMITTED, GUARANTEED FEASIBLE)
   appears nowhere.

5. **The core chain is the primary interaction.** The Evidence surface is a
   diligence workspace: scenario selector + proof chain
   (CERTIFICATE → SCENARIO → CONSTRAINT RESULTS → …) in the center, a sticky
   inspector rail on the right (result derivations with actual/limit/margin/
   method, LAW and APPLIES HERE strands, source detail with authority tier +
   retrieval/version identity + raw-evidence pointer, certificate with pinned
   dependency kinds and expandable revision/semanticHash/node-id details),
   and lower bands for assumptions (never styled as law), mission rules
   (USER DECLARED · CONFIRMED · HARD, never as sourced facts), the conflict
   compare view, and the expert queue. The issue #5 COMPILED LAW section is
   kept intact inside the new surface (same aria-label and data-testids), so
   the regulatory e2e contracts pass unchanged.

6. **Conflicts compare, never crown.** Each conflict renders members side by
   side with value, source, authority, and retrieval date, the compiler
   resolution, and its linked ExpertReview. `blocked` resolutions explicitly
   say Acrevia refused to choose; `authority-resolved` ones explain why the
   other candidate lost. Canonical RM-1 evidence currently has zero
   conflicts; the surface states that honestly instead of hiding the section.

7. **The expert queue is graph truth.** The canonical benchmark's 14 open
   questions seed as REAL ExpertReview nodes through `openExpertReviewItem`
   in the proof rebuild (same deterministic ids and fields as the legacy
   benchmark seed: `phl:review:<oq-id>`; affectedNodeIds resolve to live
   claims when present, never fabricated) — gated to the same compiled-corpus
   path as the law, so a property outside the corpus never sees them.
   ConstraintResults that are UNKNOWN / NOT_EVALUATED / EXPERT_REQUIRED
   appear in a visually distinct "unresolved computation" lane in the same
   queue; the distinction graph-review vs computation-question is always
   visible.

8. **STALE / RECOMPUTE is unmistakable and honest about its limits.** When a
   requested certificate id is not reproduced by the deterministic current
   rebuild, the surface shows a red STALE / RECOMPUTE banner ("this proof
   belongs to an earlier project state") and links to the current
   certificate. The stateless server never claims to know WHICH historical
   field changed. In-graph history is different: when the old certificate
   node still exists (in-memory/graph-level tests), `gradeCertificate()`
   supplies the exact drifted dependencies, and the projection surfaces them
   verbatim.

9. **Deep links fail closed (contract with #9 Forge).**
   `/workspace?view=evidence&focus=<nodeId>&scenario=<ScenarioId>&certificate=<ScenarioCertificateId>`
   is received with `useSearchParams()`; valid ids select/highlight (a
   constraint focus highlights its result row), and invalid or cross-property
   ids render "not part of this current project" with no data. The server
   independently validates `focusNodeId` and returns `focus.valid: false` for
   foreign ids.

10. **Diligence summary export is derived, deterministic, and labeled.** A
    Markdown document is built client-side from the SAME snapshot DTO (no
    second fetch): property, selected scenario + metrics, certificate +
    freshness, key law with both strands and quotes, mission rules,
    assumptions, conflicts, open expert questions + unresolved computation
    checks, and a sources table — under the standing disclaimer "Preliminary
    decision-support summary — not legal, architectural, or financial
    certification."

11. **Provenance completeness is tested, not asserted.** The proof suite
    (32 tests) traces every consequential number: height result → exact
    SourceArtifact (Quick Guide, OFFICIAL_CITY_REFERENCE) AND the site's own
    GIS applicability claim; homes metric → density constraint → claim →
    source closure; parking mission → USER_DECLARED MissionConstraint (never
    law); parking land → the explicit 350 sq_ft stall Assumption pinned by
    the certificate; every recorded result's constraintId inside its
    certificate's dependency closure; FAR-style null claims never becoming
    values or constraints; conflicted regulations never displaying as
    current executable truth; consequential law changes grading the prior
    certificate STALE with the exact drifted dependency; MACHINE_CHECKED
    absent from the domain enum and every persisted evidenceState; fabricated
    and cross-property focus ids rejected; all 14 benchmark questions visible.

## Consequences

- The Evidence surface answers "where did that come from?" for any
  consequential number it shows, by construction rather than by promise.
- The projection is stateless and deterministic: identical accepted state +
  mission log yields identical certificates and an identical snapshot.
- EvidenceLedger moved from an inline function in workspace.tsx to
  `src/components/evidence/evidence-ledger.tsx`; the workspace shell stays a
  thin host (the one permitted integration edit).
- Deferred: #13 Council consumes the same DTO later; the conflict compare
  view renders real data but the canonical corpus has no conflicts to show;
  supersession-driven STALE banners rely on #17 Watch re-verification for
  live re-capture flows; the open-questions corpus is Calvary-benchmark
  scoped (an RM-1 property other than Calvary would see those questions
  until a property-generic question set exists).
