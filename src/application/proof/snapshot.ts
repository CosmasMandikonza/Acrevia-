import type { Project, AnyNode } from "../../domain/graph/project";
import { nodesOfKind } from "../../domain/graph/project";
import { getDependencies, gradeCertificate } from "../../domain/graph/traversal";
import { selectExecutableConstraints } from "../regulatory/executable";
import type { ConflictRecord } from "../regulatory/conflicts";
import type { RecordedScenario } from "../solver/record";
import type { SolveSuccess } from "../solver/solve";
import { openExpertReviewItem, type CommandContext } from "../../commands";

/**
 * Acrevia Proof projection (issue #11).
 *
 * Proof is a VIEW over existing truth. This module NEVER stores anything: it
 * reads the rebuilt Development Graph plus the current deterministic solve
 * and projects a typed read-only snapshot the Evidence surface renders.
 * Every id below is a real graph id; every number arrives from the graph or
 * the solver — nothing is invented here.
 *
 * Vocabulary discipline: MACHINE CHECKED is a PRESENTATION label computed for
 * deterministic ConstraintResults (known solver method/version, inspectable
 * inputs). It is never written into EvidenceState or any persisted node.
 */

export const PROJECTION_VERSION = "acrevia.proof.v1";

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export type ProofSourceRow = {
  id: string;
  title: string;
  publisher: string;
  authority: string;
  sourceType: string;
  retrievedAt: string;
  version: number;
  logicalSourceKey: string;
  rawContentHash?: string;
  rawEvidenceRef?: string;
  supersededBy?: string;
  effectiveDate?: string;
  canonicalUrl: string;
};

export type ProofClaimRow = {
  id: string;
  predicate: string;
  subjectNodeId: string;
  evidenceState?: string;
  originKind: string;
  valueSummary: string;
  verbatimQuote?: string;
  sourceIds: string[];
  strand: "law" | "applies-here";
};

export type ProofRegulationRow = {
  id: string;
  codeSection: string;
  applicability: Record<string, unknown>;
  currentness: string;
  conflictRefs: string[];
  claimIds: string[];
};

export type ProofConstraintRow = {
  id: string;
  constraintKind: string;
  valueSummary: string;
  executable: boolean;
  executabilityReasons: string[];
  regulationId: string;
  lawClaimId?: string;
  lawSourceId?: string;
  appliesHereClaimId?: string;
  appliesHereSourceId?: string;
};

export type ProofAssumptionRow = {
  id: string;
  statement: string;
  valueSummary: string;
  rationale: string;
  active: boolean;
  reviewTrigger?: string;
  usedByScenarioIds: string[];
};

export type ProofMissionRow = {
  id: string;
  intentText: string;
  normalizedSummary: string;
  hardOrSoft: string;
  structureId?: string;
};

export type ProofQuantity = { value: number; unit: string } | null;

export type ProofResultRow = {
  id: string;
  constraintId: string;
  scenarioId: string;
  status: string;
  actual: ProofQuantity;
  limit: ProofQuantity;
  explanation: string;
  /** Presentation label basis: deterministic method/version known. */
  machineCheckable: boolean;
  method: string;
  source: "law" | "mission" | "assumption";
};

export type ProofScenarioRow = {
  id: string;
  label: string;
  status: string;
  solverVersion: string;
  confidence: string;
  metrics: Array<{ metricId: string; label: string; value: ProofQuantity }>;
  certificateId: string;
  freshness: string;
  resultIds: string[];
};

export type ProofCertificateRow = {
  id: string;
  scenarioId: string;
  certificateVersion: number;
  solverVersion: string;
  freshness: string;
  freshnessReasons: string[];
  dependencyCount: number;
  generatedAt: string;
  certificateHash: string;
  dependencies: Array<{ nodeId: string; nodeKind: string; revision: number; semanticHash: string }>;
};

export type ProofConflictMemberRow = {
  candidateId: string;
  sourceRef: string;
  authority: string;
  retrievedAt: string;
  valueSummary: string;
};

export type ProofConflictRow = {
  conflictId: string;
  semanticRuleKey: string;
  predicate: string;
  resolution: string;
  explanation: string;
  members: ProofConflictMemberRow[];
};

export type ProofExpertReviewRow = {
  id: string;
  question: string;
  whyItMatters: string;
  category: string;
  severity: string;
  reviewStatus: string;
  affectedNodeIds: string[];
  evidenceRefs: string[];
};

export type ProofComputationQuestionRow = {
  scenarioId: string;
  resultId: string;
  constraintId: string;
  label: string;
  status: string;
  explanation: string;
};

export type RequestedCertificateState = {
  requestedId: string;
  /** current: the rebuild reproduces this exact certificate id. */
  status: "current" | "superseded" | "unknown";
  currentCertificateId?: string;
  currentScenarioId?: string;
  reason: string;
};

export type ProofFocusState = {
  id: string;
  valid: boolean;
  nodeKind?: string;
};

export type ProofSnapshot = {
  projectionVersion: string;
  status: "compiled";
  identity: {
    projectId: string;
    query: string;
    matchedAddress?: string;
    district: string | null;
    overlay?: string;
    parcelNodeId: string;
    solverVersion: string;
  };
  ceilings: {
    legalDensity: number | null;
    massing: number;
    physicalSiteAreaBudget: number;
    overall: number;
  };
  sources: ProofSourceRow[];
  claims: ProofClaimRow[];
  regulations: ProofRegulationRow[];
  constraints: ProofConstraintRow[];
  assumptions: ProofAssumptionRow[];
  missions: ProofMissionRow[];
  scenarios: ProofScenarioRow[];
  results: ProofResultRow[];
  certificates: ProofCertificateRow[];
  conflicts: ProofConflictRow[];
  expertReviews: ProofExpertReviewRow[];
  computationQuestions: ProofComputationQuestionRow[];
  requestedCertificate?: RequestedCertificateState;
  focus?: ProofFocusState;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function claimValueSummary(node: AnyNode): string {
  if (node.kind !== "claim") return "";
  const value = node.value as { type: string; quantity?: { value: number; unit: string }; text?: string; reason?: string };
  if (value.type === "quantity") return `${value.quantity?.value} ${value.quantity?.unit}`;
  if (value.type === "qualitative") return value.text ?? "";
  if (value.type === "null") return `unknown (${value.reason ?? "unknown"})`;
  return value.type;
}

function assumptionValueSummary(node: AnyNode): string {
  if (node.kind !== "assumption") return "";
  const value = node.value as { type: string; quantity?: { value: number; unit: string }; text?: string };
  if (value.type === "quantity") return `${value.quantity?.value} ${value.quantity?.unit}`;
  if (value.type === "qualitative") return value.text ?? "";
  return value.type;
}

/** Two-strand classification (ADR 0006 §11): namespace decides, never order. */
function strandOfClaim(claimId: string): "law" | "applies-here" {
  return claimId.startsWith("gis:claim:") ? "applies-here" : "law";
}

function quantityOf(value: unknown): ProofQuantity {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>) && "unit" in (value as Record<string, unknown>)) {
    const typed = value as { value: number; unit: string };
    return { value: typed.value, unit: typed.unit };
  }
  return null;
}

function describeConstraintValue(node: AnyNode): string {
  if (node.kind !== "constraint") return "";
  switch (node.constraintKind) {
    case "height":
      return `${node.limit.value} ft maximum height`;
    case "parking-requirement":
      return node.requirement.type === "fixed"
        ? `${node.requirement.spaces.value} spaces required`
        : node.requirement.text;
    case "use-permission":
      return `${node.use.replace(/-/g, " ")}: ${node.permission.replace(/_/g, " ").toLowerCase()}`;
    case "setback": {
      if (node.spec.type === "numeric") return `${node.spec.min.value} ft minimum ${node.face} setback`;
      if (node.spec.type === "range") return `${node.spec.range.min}–${node.spec.range.max} ft ${node.face} setback`;
      return `contextual ${node.face} setback (adjacent facades)`;
    }
    case "occupied-area":
      return `max occupied area ${node.byLotType.intermediate ?? "?"}% (intermediate lot)`;
    case "density":
      return "tiered minimum lot area per dwelling unit";
    case "overlay-prohibition":
      return `${node.overlay}: ${node.prohibits.replace(/-/g, " ")} prohibited`;
    case "density-bonus":
      return "density bonus available by tier";
    default:
      return "";
  }
}

function missionSummary(node: AnyNode): string {
  if (node.kind !== "mission-constraint") return "";
  const normalized = node.normalized;
  switch (normalized.type) {
    case "min-parking":
      return `at least ${normalized.spaces.value} parking spaces`;
    case "preserve-structure":
      return `preserve structure ${normalized.structureId}`;
    case "max-stories":
      return `at most ${normalized.stories.value} stories`;
    case "retain-ownership":
      return "congregation retains land ownership";
    case "max-height":
      return `no taller than ${normalized.limit.value} ft`;
    default:
      return String((normalized as { type?: string }).type ?? "");
  }
}

const dependenciesOf = (project: Project, nodeId: string, role: string): string[] =>
  getDependencies(project, nodeId)
    .filter((edge) => edge.role === role)
    .map((edge) => edge.dependencyId);

// ---------------------------------------------------------------------------
// Open-question seeding (canonical benchmark ExpertReview nodes)
// ---------------------------------------------------------------------------

const OpenQuestionDoc = {
  parse(raw: unknown): Array<{ id: string; category: string; kind: string; question: string; whyItMatters: string }> {
    const questions = (raw as { questions?: unknown }).questions;
    if (!Array.isArray(questions)) throw new Error("open-questions.json: missing questions array");
    return questions.map((entry) => {
      const q = entry as Record<string, unknown>;
      for (const key of ["id", "category", "kind", "question", "whyItMatters"]) {
        if (typeof q[key] !== "string" || (q[key] as string).length === 0) {
          throw new Error(`open-questions.json: question ${(q.id as string) ?? "?"} missing ${key}`);
        }
      }
      return q as unknown as { id: string; category: string; kind: string; question: string; whyItMatters: string };
    });
  },
};

/**
 * The canonical benchmark property: Calvary Memorial Church, OPA/BRT parcel
 * 778273000 (graph node `gis:parcel:778273000`). The benchmark's open
 * questions are THIS property's validation context — they may never appear
 * on another church's proof, even in the same district.
 */
export const CANONICAL_BENCHMARK_PARCEL_KEY = "778273000";

/**
 * Property-gated seeding: benchmark open questions become ExpertReview nodes
 * ONLY when the accepted property is the canonical benchmark property (exact
 * confirmed-parcel identity — never district-level or fuzzy matching). A
 * different RM-1 property gets an honest empty expert-review state and keeps
 * its real unresolved ConstraintResults; Calvary-specific title/history/FAR
 * questions never attach to another property.
 */
export function seedBenchmarkOpenQuestionsForProperty(
  ctx: CommandContext,
  questions: Array<{ id: string; category: string; kind: string; question: string; whyItMatters: string }>,
  confirmedParcelKey: string,
): number {
  if (confirmedParcelKey !== CANONICAL_BENCHMARK_PARCEL_KEY) return 0;
  return seedBenchmarkOpenQuestions(ctx, questions);
}

/**
 * Seed the canonical benchmark's open questions as REAL ExpertReview nodes
 * (same deterministic ids and fields as the legacy benchmark seed:
 * `phl:review:<oq-id>`). Idempotent — existing nodes are left untouched.
 * affectedNodeIds resolve to live graph nodes when present (FAR claim, the
 * site's overlay claim), never fabricated references.
 */
export function seedBenchmarkOpenQuestions(
  ctx: CommandContext,
  questions: Array<{ id: string; category: string; kind: string; question: string; whyItMatters: string }>,
): number {
  const farClaim = Object.values(ctx.project.nodes).find(
    (node) => node.kind === "claim" && node.predicate === "far",
  );
  const overlayClaim = Object.values(ctx.project.nodes).find(
    (node) => node.kind === "claim" && node.predicate === "zoning-overlays",
  );
  let seeded = 0;
  for (const question of questions) {
    const id = `phl:review:${question.id}`;
    if (ctx.project.nodes[id]) continue;
    openExpertReviewItem(ctx, {
      id,
      kind: "expert-review",
      question: question.question,
      whyItMatters: question.whyItMatters,
      category: question.category,
      affectedNodeIds:
        question.category === "far" && farClaim
          ? [farClaim.id]
          : question.category === "overlay" && overlayClaim
            ? [overlayClaim.id]
            : [],
      evidenceRefs: [],
      severity: question.kind === "EXPERT_REQUIRED" ? "blocking" : "non-blocking",
      reviewStatus: "OPEN",
    });
    seeded += 1;
  }
  return seeded;
}

export { OpenQuestionDoc };

function firstSolverVersion(project: Project, recorded: RecordedScenario[]): string {
  for (const entry of recorded) {
    const cert = project.nodes[entry.certificateId];
    if (cert?.kind === "scenario-certificate") return cert.solverVersion;
  }
  return "";
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

export function buildProofSnapshot(
  project: Project,
  input: {
    solve: SolveSuccess;
    recorded: RecordedScenario[];
    conflicts: ConflictRecord[];
    identity: {
      query: string;
      matchedAddress?: string;
      district: string | null;
      overlay?: string;
      parcelNodeId: string;
    };
    requestedScenarioId?: string;
    requestedCertificateId?: string;
    focusNodeId?: string;
  },
): ProofSnapshot {
  const gate = selectExecutableConstraints(project);
  const decisionById = new Map(gate.decisions.map((decision) => [decision.constraintId, decision]));

  // --- Sources ---------------------------------------------------------------
  const sources: ProofSourceRow[] = nodesOfKind(project, "source-artifact")
    .map((node) => ({
      id: node.id,
      title: node.title,
      publisher: node.publisher,
      authority: node.authority,
      sourceType: node.sourceType,
      retrievedAt: node.retrievedAt,
      version: node.version,
      logicalSourceKey: node.logicalSourceKey,
      rawContentHash: node.rawContentHash,
      rawEvidenceRef: node.rawEvidenceRef,
      supersededBy: node.supersededBy,
      effectiveDate: node.effectiveDate,
      canonicalUrl: node.canonicalUrl,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Claims (LAW + APPLIES HERE strands kept apart) ------------------------
  const claims: ProofClaimRow[] = nodesOfKind(project, "claim")
    .map((node) => ({
      id: node.id,
      predicate: node.predicate,
      subjectNodeId: node.subjectNodeId,
      evidenceState: node.evidenceState,
      originKind: node.origin.kind,
      valueSummary: claimValueSummary(node),
      verbatimQuote: node.verbatimQuote,
      sourceIds: node.sourceIds,
      strand: strandOfClaim(node.id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Regulations ------------------------------------------------------------
  const regulations: ProofRegulationRow[] = nodesOfKind(project, "regulation")
    .map((node) => ({
      id: node.id,
      codeSection: node.codeSection,
      applicability: node.applicability as Record<string, unknown>,
      currentness: node.currentness,
      conflictRefs: node.conflictRefs,
      claimIds: node.claimIds,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Constraints with two-strand provenance --------------------------------
  const supportedBy = (claimIds: string[]): string | undefined =>
    claimIds
      .flatMap((claimId) => dependenciesOf(project, claimId, "supported-by"))
      .sort()[0];

  const constraints: ProofConstraintRow[] = nodesOfKind(project, "constraint")
    .map((node) => {
      const decision = decisionById.get(node.id);
      const claimIds = dependenciesOf(project, node.id, "materializes")
        .flatMap((regulationId) => dependenciesOf(project, regulationId, "interpreted-from"));
      const lawClaimIds = claimIds.filter((id) => strandOfClaim(id) === "law");
      const appliesClaimIds = claimIds.filter((id) => strandOfClaim(id) === "applies-here");
      return {
        id: node.id,
        constraintKind: node.constraintKind,
        valueSummary: describeConstraintValue(node),
        executable: decision?.executable ?? false,
        executabilityReasons: decision?.reasons ?? ["no executability decision recorded"],
        regulationId: node.regulationId,
        lawClaimId: lawClaimIds.sort()[0],
        lawSourceId: supportedBy(lawClaimIds),
        appliesHereClaimId: appliesClaimIds.sort()[0],
        appliesHereSourceId: supportedBy(appliesClaimIds),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Assumptions ------------------------------------------------------------
  const scenarioIdsByAssumption = new Map<string, string[]>();
  for (const scenario of nodesOfKind(project, "scenario")) {
    for (const assumptionId of scenario.assumptionIds) {
      const list = scenarioIdsByAssumption.get(assumptionId) ?? [];
      list.push(scenario.id);
      scenarioIdsByAssumption.set(assumptionId, list);
    }
  }
  const assumptions: ProofAssumptionRow[] = nodesOfKind(project, "assumption")
    .map((node) => ({
      id: node.id,
      statement: node.statement,
      valueSummary: assumptionValueSummary(node),
      rationale: node.rationale,
      active: node.active,
      reviewTrigger: node.reviewTrigger,
      usedByScenarioIds: (scenarioIdsByAssumption.get(node.id) ?? []).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Missions ---------------------------------------------------------------
  const missions: ProofMissionRow[] = nodesOfKind(project, "mission-constraint")
    .map((node) => ({
      id: node.id,
      intentText: node.intentText,
      normalizedSummary: missionSummary(node),
      hardOrSoft: node.hardOrSoft,
      structureId:
        node.normalized.type === "preserve-structure" ? node.normalized.structureId : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Scenarios / results / certificates (from the current recording) -------
  // Scenarios surface the CURRENT heads (the recorded solve). Certificates
  // include the full history: a prior certificate node stays inspectable —
  // graded STALE/INVALIDATED with the exact drifted dependencies — because
  // "true as of these exact inputs" is audit truth, not clutter.
  const solvedScenarioByKey = new Map(input.solve.scenarios.map((s) => [s.label ?? "", s]));
  const scenarios: ProofScenarioRow[] = [];
  const results: ProofResultRow[] = [];
  const certificates: ProofCertificateRow[] = [];
  const computationQuestions: ProofComputationQuestionRow[] = [];

  const missionIds = new Set(missions.map((mission) => mission.id));
  const assumptionIds = new Set(assumptions.map((assumption) => assumption.id));
  const resultIdsOfScenario = new Map<string, string[]>();

  for (const entry of input.recorded) {
    const scenarioNode = project.nodes[entry.scenarioId];
    const certificateNode = project.nodes[entry.certificateId];
    if (!scenarioNode || scenarioNode.kind !== "scenario") continue;
    if (!certificateNode || certificateNode.kind !== "scenario-certificate") continue;
    const solved = solvedScenarioByKey.get(scenarioNode.label);

    scenarios.push({
      id: scenarioNode.id,
      label: scenarioNode.label,
      status: scenarioNode.status,
      solverVersion: scenarioNode.solverVersion,
      confidence: solved?.confidence ?? "",
      metrics: scenarioNode.metrics.map((metric) => ({
        metricId: metric.metricId,
        label: metric.label,
        value: quantityOf(metric.value),
      })),
      certificateId: entry.certificateId,
      freshness: gradeCertificate(project, entry.certificateId).freshness,
      resultIds: [...scenarioNode.constraintResultIds],
    });
    resultIdsOfScenario.set(scenarioNode.id, [...scenarioNode.constraintResultIds]);
  }

  // Every certificate node — current heads AND historical proofs, each graded.
  for (const certificateNode of nodesOfKind(project, "scenario-certificate")) {
    const grade = gradeCertificate(project, certificateNode.id);
    certificates.push({
      id: certificateNode.id,
      scenarioId: certificateNode.scenarioId,
      certificateVersion: certificateNode.certificateVersion,
      solverVersion: certificateNode.solverVersion,
      freshness: grade.freshness,
      freshnessReasons: grade.reasons,
      dependencyCount: certificateNode.dependencies.length,
      generatedAt: certificateNode.generatedAt,
      certificateHash: certificateNode.certificateHash,
      dependencies: certificateNode.dependencies.map((dep) => ({ ...dep })),
    });
  }

  for (const scenario of scenarios) {
    for (const resultId of resultIdsOfScenario.get(scenario.id) ?? []) {
      const resultNode = project.nodes[resultId];
      if (!resultNode || resultNode.kind !== "constraint-result") continue;
      const determined = resultNode.status === "SATISFIED" || resultNode.status === "VIOLATED";
      const source: ProofResultRow["source"] = missionIds.has(resultNode.constraintId)
        ? "mission"
        : assumptionIds.has(resultNode.constraintId)
          ? "assumption"
          : "law";
      results.push({
        id: resultNode.id,
        constraintId: resultNode.constraintId,
        scenarioId: resultNode.scenarioId,
        status: resultNode.status,
        actual: quantityOf(resultNode.actual),
        limit: quantityOf(resultNode.limit),
        explanation: resultNode.explanation,
        // Presentation label basis: deterministic method/version + evaluated
        // status + inspectable actual/limit — never an EvidenceState value.
        machineCheckable:
          determined &&
          scenario.solverVersion.length > 0 &&
          (resultNode.actual !== null || resultNode.explanation.length > 0),
        method: scenario.solverVersion,
        source,
      });
      if (resultNode.status === "UNKNOWN" || resultNode.status === "NOT_EVALUATED" || resultNode.status === "EXPERT_REQUIRED") {
        const constraint = project.nodes[resultNode.constraintId];
        computationQuestions.push({
          scenarioId: resultNode.scenarioId,
          resultId: resultNode.id,
          constraintId: resultNode.constraintId,
          label:
            constraint?.kind === "constraint"
              ? describeConstraintValue(constraint)
              : constraint?.kind === "mission-constraint"
                ? constraint.intentText
                : resultNode.constraintId,
          status: resultNode.status,
          explanation: resultNode.explanation,
        });
      }
    }
  }

  // --- Conflicts ---------------------------------------------------------------
  const conflicts: ProofConflictRow[] = input.conflicts
    .map((conflict) => ({
      conflictId: conflict.conflictId,
      semanticRuleKey: conflict.semanticRuleKey,
      predicate: conflict.predicate,
      resolution: conflict.resolution,
      explanation: conflict.explanation,
      members: conflict.members.map((member) => ({
        candidateId: member.candidateId,
        sourceRef: member.sourceRef,
        authority: member.authority,
        retrievedAt: member.retrievedAt,
        valueSummary: member.valueSummary,
      })),
    }))
    .sort((a, b) => a.conflictId.localeCompare(b.conflictId));

  // --- Expert reviews (real graph nodes only) ----------------------------------
  const expertReviews: ProofExpertReviewRow[] = nodesOfKind(project, "expert-review")
    .map((node) => ({
      id: node.id,
      question: node.question,
      whyItMatters: node.whyItMatters,
      category: node.category,
      severity: node.severity,
      reviewStatus: node.reviewStatus,
      affectedNodeIds: node.affectedNodeIds,
      evidenceRefs: node.evidenceRefs,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Requested-certificate state (STALE / RECOMPUTE presentation) -----------
  let requestedCertificate: RequestedCertificateState | undefined;
  if (input.requestedCertificateId) {
    const requestedId = input.requestedCertificateId;
    const recordedMatch = input.recorded.find((entry) => entry.certificateId === requestedId);
    if (recordedMatch && gradeCertificate(project, requestedId).freshness === "CURRENT") {
      requestedCertificate = {
        requestedId,
        status: "current",
        currentCertificateId: recordedMatch.certificateId,
        currentScenarioId: recordedMatch.scenarioId,
        reason: "The deterministic current rebuild reproduces this exact certificate.",
      };
    } else {
      // The certificate exists as a graph node (in-memory history) or is
      // entirely foreign to this rebuild (stateless route). Either way it does
      // not describe the current project state. When the node exists, its
      // graded reasons name the EXACT drifted dependencies; when it does not,
      // the server is stateless and cannot prove which historical field
      // changed — so it never claims to.
      const node = project.nodes[requestedId];
      const graded =
        node && node.kind === "scenario-certificate" ? gradeCertificate(project, requestedId) : null;
      const currentForScenario =
        input.recorded.find((entry) => {
          const scenario = project.nodes[entry.scenarioId];
          const requestedScenario = node && node.kind === "scenario-certificate" ? node.scenarioId : null;
          return requestedScenario && scenario?.id === requestedScenario;
        }) ?? input.recorded[0];
      requestedCertificate = {
        requestedId,
        status: "superseded",
        ...(currentForScenario
          ? { currentCertificateId: currentForScenario.certificateId, currentScenarioId: currentForScenario.scenarioId }
          : {}),
        reason: graded
          ? `This proof belongs to an earlier project state — ${graded.freshness.toLowerCase()} because: ${graded.reasons.join("; ")}. Inspect the current certificate instead.`
          : "This certificate is not part of the current project state. The deterministic rebuild of the accepted property produced different certificate identities, so this proof belongs to an earlier project state (earlier law, mission, or assumption inputs). Inspect the current certificate below; Acrevia cannot prove from this request which historical input changed.",
      };
    }
  }

  // --- Focus validation (fail closed for foreign ids) ---------------------------
  let focus: ProofFocusState | undefined;
  if (input.focusNodeId !== undefined) {
    const node = project.nodes[input.focusNodeId];
    focus = node
      ? { id: input.focusNodeId, valid: true, nodeKind: node.kind }
      : { id: input.focusNodeId, valid: false };
  }

  return {
    projectionVersion: PROJECTION_VERSION,
    status: "compiled",
    identity: {
      projectId: project.projectId,
      query: input.identity.query,
      matchedAddress: input.identity.matchedAddress,
      district: input.identity.district,
      overlay: input.identity.overlay,
      parcelNodeId: input.identity.parcelNodeId,
      solverVersion: firstSolverVersion(project, input.recorded),
    },
    ceilings: {
      legalDensity: input.solve.ceilings.legalDensity,
      massing: input.solve.ceilings.massing,
      physicalSiteAreaBudget: input.solve.ceilings.physicalSiteAreaBudget,
      overall: input.solve.ceilings.overall,
    },
    sources,
    claims,
    regulations,
    constraints,
    assumptions,
    missions,
    scenarios,
    results,
    certificates,
    conflicts,
    expertReviews,
    computationQuestions,
    requestedCertificate,
    focus,
  };
}
