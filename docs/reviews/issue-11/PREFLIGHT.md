# Issue #11 Proof — Preflight

Date: 2026-10-07 · Branch `feat/issue-11-proof` from `236f397`.

## 1. Existing proof/evidence entities (what Truth already exists)

| Entity | Where | Notes |
|---|---|---|
| `SourceArtifact` | `src/domain/evidence/source-artifact.ts` | Captured version; authority, retrievedAt, rawContentHash, supersededBy IS semantic |
| `Claim` | `src/domain/evidence/claim.ts` | `phl:claim:<rule>:<artifactId>` (law) vs `gis:claim:<predicate>:<parcel>` (applicability); EvidenceState lives HERE |
| `Regulation` | `src/domain/evidence/regulation.ts` | currentness, conflictRefs, claimIds include applicability claims |
| `Constraint` union | `src/domain/constraints/constraint.ts` | `constraintKind` discriminator; `phl:constraint:<semanticRuleKey>` |
| `MissionConstraint` | `src/domain/constraints/mission.ts` | USER_DECLARED, CONFIRMED-only at boundary, no evidence state |
| `Assumption` | `src/domain/constraints/assumption.ts` | MODELER_DECLARED, 5 solver seeds |
| `Scenario` | `src/domain/scenarios/entities.ts` | metrics, solverVersion, constraintResultIds, certificateId |
| `ConstraintResult` | same | ComputationState vocabulary (SATISFIED/VIOLATED/UNKNOWN/NOT_EVALUATED/EXPERT_REQUIRED) |
| `ScenarioCertificate` | same | pins transitive closure `{nodeId, nodeKind, revision, semanticHash}`; metricsSnapshot immutable |
| `ExpertReview` | `src/domain/review/expert-review.ts` | question/whyItMatters/category/severity/affectedNodeIds/evidenceRefs |
| Traversal | `src/domain/graph/traversal.ts` | getEvidenceChain, computeDependencyClosure, gradeCertificate (INVALIDATED/STALE/CURRENT + reasons), explainMetric |

**Non-negotiable:** Proof is a VIEW over these — no parallel store. `EvidenceState ≠ ComputationState ≠ Origin ≠ Freshness` stay separate; "MACHINE CHECKED" is a presentation label only (never an enum value).

## 2. Graph edges available for chain traversal

`supported-by` (claim→source), `interpreted-from` (regulation→claim), `materializes` (constraint→regulation), `evaluated-under` (result→constraint), `scenario-input` (scenario→result/constraint/mission/assumption/parcel), `certifies` (certificate→scenario), `mission-applies-to` (mission→structure), `concerns` (expert-review→node), plus property/parcel/structure/jurisdiction edges from the GIS commit.

Chain direction: `certificate → scenario → {results→constraints→regulations→claims→sources, missions(+structure), assumptions, parcel→claims→GIS sources}`.

## 3. How ScenarioCertificates are currently graded

`gradeCertificate(project, id)` — INVALIDATED (missing node / superseded source / conflicted regulation), STALE (pinned revision/semanticHash drift, with per-dependency reasons naming old vs new revision+hash8), CURRENT otherwise. `recordSolverScenarios` re-grades after each recording; scenario ids embed a digest over `{nodeId, revision, semanticHash}` per direct dependency so a consequential edit with identical points yields a NEW scenario id (old cert goes STALE).

## 4. Current conflict representation

`ConflictRecord` from `decideConflicts` (compile-time, verifier-owned): members with authority/retrievedAt/valueSummary/normalizedLegalValue, resolution ∈ {authority-resolved, blocked, superseded}, explanation. Blocked conflicts → deterministic `phl:review:<conflictId>` ExpertReview + regulation currentness STALE + conflictRefs. Compile response ships `conflicts[]`; UI shows members + explanation (no side-by-side compare view yet).

## 5. Current ExpertReview items

- Compile path: one per BLOCKED conflict only (canonical RM-1 corpus has none).
- Legacy benchmark seed (`mapBenchmarkToProject`): all 14 `open-questions.json` → `phl:review:<oq-id>` OPEN items. The canonical BROWSER flow does not seed them today — Proof must seed them through `openExpertReviewItem` in its rebuild (same ids/fields as the legacy seed) so the queue shows the real 14.
- ConstraintResults with UNKNOWN/NOT_EVALUATED/EXPERT_REQUIRED = computation questions (separate visual lane, same queue).

## 6. How the Evidence page currently gets law

`CompiledLaw` client component POSTs `/api/regulatory/compile` with `{envelope, receipt}`; that route verifies the pair, rebuilds the base project (hash-gated), compiles the corpus gated on RM-1 + /SIX-from-signed-session, and returns two-strand rows (LAW = phl claim/source/locator; APPLIES HERE = gis zoning-base/overlay claim + official GIS source). The page itself renders accepted-record summary + CompiledLaw + captures list. **No proof chain, no certificates, no assumptions/mission display, no expert queue.**

## 7. Proposed proof DTO (`POST /api/proof/snapshot`)

Input: `{ envelope, receipt, commands, scenarioId?, certificateId?, focusNodeId? }`. Server mirrors the solver route's trust boundary (verify pair → rebuild → hash gate → compile law → replay missions → seed assumptions → solve + recordSolverScenarios), then projects:

```
ProofSnapshot {
  status, generatedAt (receipt-bound), property {projectId, query, matchedAddress, district, overlays}
  sources[]        {id, title, publisher, authority, retrievedAt, version, rawEvidenceRef, supersededBy?}
  claims[]         {id, predicate, subjectNodeId, evidenceState, valueSummary, verbatimQuote, sourceIds[]}
  regulations[]    {id, codeSection, applicability, currentness, conflictRefs[]}
  constraints[]    {id, constraintKind, valueSummary, executable, executabilityReasons[], law{claimId,sourceId}, appliesHere{claimId,sourceId,district,overlay}}
  assumptions[]    {id, statement, valueSummary, rationale, active, whereUsed[]}
  missions[]       {id, intentText, normalizedSummary, hardOrSoft, structureId?}
  scenarios[]      {id, label, status, solverVersion, metrics[], certificateId, freshness, resultIds[]}
  results[]        {id, constraintId, scenarioId, status, actual, limit, explanation, machineCheckable, method}
  certificates[]   {id, scenarioId, certificateVersion, solverVersion, freshness, freshnessReasons[], dependencyCount, dependencies[{nodeId,nodeKind,revision,semanticHash}]}
  conflicts[]      {conflictId, semanticRuleKey, predicate, resolution, explanation, members[]}
  expertReviews[]  {id, question, whyItMatters, category, severity, reviewStatus, affectedNodeIds[], evidenceRefs[], kind: "graph"}
  computationQuestions[] {scenarioId, constraintId, label, status, explanation}  (results ≠ SATISFIED/VIOLATED)
  chain (focused)  {focusNodeId, nodes: layered chain w/ real ids}
  requestedCertificate {requestedId, status: current|superseded, currentCertificateId?, reasons[]}
  ceilings         {legalDensity, massing, physicalSiteAreaBudget, overall}
  projectionVersion: "acrevia.proof.v1"
}
```

All real graph ids retained; server never trusts client graph data.

## 8. Deep-link handling

Receiver: the new `EvidenceLedger` via `useSearchParams()`. Contract with #9:
`/workspace?view=evidence&focus=<nodeId>&scenario=<id>&certificate=<id>`
- focus in current project → select + scroll/highlight that proof node
- scenario → select scenario; certificate → open certificate proof
- unknown/cross-property ids → fail closed, "not part of this current project", nothing rendered from the id

## 9. Diligence export design

Deterministic Markdown built client-side from the SAME ProofSnapshot DTO (no second fetch, no new truth): property, selected scenario + metrics, certificate + freshness, key law (two-strand), mission constraints, assumptions, conflicts, unresolved/expert questions, sources table, disclaimer "Preliminary decision-support summary — not legal, architectural, or financial certification." Download as `.md` via Blob.

## 10. Expected files

```
src/application/proof/snapshot.ts        (projection builder — pure, project+inputs → DTO)
src/app/api/proof/snapshot/route.ts      (trusted projection endpoint)
src/components/evidence/evidence-ledger.tsx  (premium inspection workspace host)
src/components/evidence/proof-chain.tsx / certificate-panel.tsx / inspector-panel.tsx (or folded in)
src/components/evidence/diligence.ts     (markdown builder, shared with export button)
src/components/workspace/workspace.tsx   (thin host edit ONLY)
tests/proof/snapshot.test.ts             (projection + completeness + adversarial)
tests/proof/stale.test.ts                (certificate grading presentation logic)
tests/e2e/proof.spec.ts                  (canonical browser journey + deep link + cross-property)
docs/adr/0011-proof.md
```

## 11. Questions

None blocking. Decisions taken: (a) CompiledLaw keeps its own section + testids inside the new surface so existing regulatory e2e passes unchanged; (b) the 14 benchmark open questions seed as real ExpertReview nodes in the proof rebuild (same deterministic ids as the legacy seed), gated to the same compiled-corpus path so no cross-property contamination; (c) MACHINE CHECKED = presentation label computed as `result.method present && status ∈ {SATISFIED,VIOLATED} && inputs inspectable` — never persisted.
