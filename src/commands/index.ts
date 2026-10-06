import { z } from "zod";
import { Project, addEdge, removeEdgesWhere, requireNode } from "../domain/graph/project";
import { nodeWithMeta, touchNode } from "../domain/graph/node";
import { buildCertificateDependencies, refreshStaleness } from "../domain/graph/traversal";
import { canonicalJson } from "../domain/graph/serialization";
import { stripVolatile } from "../domain/graph/node";
import { ProjectEvent, ProjectEventType } from "../domain/events/project-event";
import { SourceArtifactSemantic } from "../domain/evidence/source-artifact";
import { ClaimSemantic, validateClaimRules } from "../domain/evidence/claim";
import { RegulationSemantic } from "../domain/evidence/regulation";
import { ConstraintSemantic } from "../domain/constraints/constraint";
import { MissionConstraintConfirmation } from "../domain/constraints/mission";
import { AssumptionSemantic } from "../domain/constraints/assumption";
import {
  ScenarioMetric,
  ScenarioCertificateSemantic,
  computeCertificateHash,
} from "../domain/scenarios/entities";
import { ExpertReviewSemantic } from "../domain/review/expert-review";
import { StakeholderViewSemantic } from "../domain/views/stakeholder-view";
import { ComputationState, ReviewState } from "../domain/enums";
import { Quantity } from "../domain/units/quantity";

/**
 * Typed mutation commands. Each command:
 *   1. validates its input (Zod + cross-field rules),
 *   2. mutates canonical project state,
 *   3. appends a ProjectEvent,
 *   4. advances the project revision,
 *   5. re-grades certificate freshness (dependency-aware).
 *
 * There is deliberately NO generic "edit node JSON" command. Later Copilot tools
 * (#10) call these, never raw object mutation.
 */

export type CommandContext = {
  project: Project;
  actor: string;
  correlationId?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
};


/** Generated ids (certificates, versioned results) must be UNUSED regardless
 *  of the existing node's kind — same-kind collision would overwrite history. */
function requireUnusedNodeId(project: Project, nodeId: string, label: string): void {
  if (project.nodes[nodeId]) {
    throw new Error(
      `${label}: node id ${nodeId} already exists; generated ids must be unused`,
    );
  }
}

/** Node ids are globally unique and never change semantic kind. Create paths
 *  require an unused id; update paths require the expected kind. */
function rejectKindCollision(
  project: Project,
  nodeId: string,
  expectedKind: Project["nodes"][string]["kind"],
  label: string,
): void {
  const existing = project.nodes[nodeId];
  if (existing && existing.kind !== expectedKind) {
    throw new Error(
      `${label}: node id ${nodeId} already exists as ${existing.kind}; node ids never change semantic kind`,
    );
  }
}

function timestamp(ctx: CommandContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

export function apply(
  ctx: CommandContext,
  eventType: ProjectEventType,
  affectedNodeIds: string[],
  commandSummary: string,
  mutate: (now: string) => void,
): void {
  const now = timestamp(ctx);
  const priorRevision = ctx.project.revision;
  mutate(now);
  const nextRevision = priorRevision + 1;
  ctx.project.revision = nextRevision;
  ctx.project.updatedAt = now;
  const event: ProjectEvent = {
    eventId: `evt-${nextRevision}`,
    actor: ctx.actor,
    eventType,
    occurredAt: now,
    affectedNodeIds,
    priorProjectRevision: priorRevision,
    nextProjectRevision: nextRevision,
    commandSummary,
    correlationId: ctx.correlationId,
  };
  ctx.project.events.push(event);
  refreshStaleness(ctx.project);
}

// ---------------------------------------------------------------------------
// Sources, claims, regulations, constraints
// ---------------------------------------------------------------------------

export const AddSourceArtifactInput = SourceArtifactSemantic;
export function addSourceArtifact(
  ctx: CommandContext,
  input: z.infer<typeof AddSourceArtifactInput>,
): void {
  const parsed = AddSourceArtifactInput.parse(input);
  const existing = ctx.project.nodes[parsed.id];
  if (existing) {
    // Historical captures are immutable. Exact replay is an idempotent no-op;
    // anything else (changed content under the same version id) fails loudly.
    if (canonicalJson(stripVolatile(existing)) !== canonicalJson(stripVolatile(parsed))) {
      throw new Error(
        `source artifact ${parsed.id} already exists; historical captures and rawContentHash are immutable (add a new version instead)`,
      );
    }
    return;
  }
  apply(
    ctx,
    "source.artifact.added",
    [parsed.id],
    `add source artifact ${parsed.id} (${parsed.title})`,
    (now) => {
      ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
    },
  );
}

export const RecordClaimInput = ClaimSemantic;
export function recordClaim(ctx: CommandContext, input: z.infer<typeof RecordClaimInput>): void {
  const parsed = RecordClaimInput.parse(input);
  const problems = validateClaimRules(parsed);
  if (problems.length > 0) throw new Error(problems.join("; "));
  if (!ctx.project.nodes[parsed.subjectNodeId]) {
    throw new Error(`claim subject does not exist: ${parsed.subjectNodeId}`);
  }
  for (const sourceId of parsed.sourceIds) {
    requireNode(ctx.project, sourceId, "source-artifact");
  }
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`node already exists: ${parsed.id} (claims are create-only; add a new claim id)`);
  }
  apply(
    ctx,
    "claim.recorded",
    [parsed.id],
    `record claim ${parsed.id} (${parsed.predicate})`,
    (now) => {
      ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      for (const sourceId of parsed.sourceIds) {
        addEdge(ctx.project, { dependentId: parsed.id, dependencyId: sourceId, role: "supported-by" });
      }
    },
  );
}

export const UpsertRegulationInput = RegulationSemantic;
export function upsertRegulation(
  ctx: CommandContext,
  input: z.infer<typeof UpsertRegulationInput>,
): void {
  const parsed = UpsertRegulationInput.parse(input);
  for (const claimId of parsed.claimIds) {
    requireNode(ctx.project, claimId, "claim");
  }
  rejectKindCollision(ctx.project, parsed.id, "regulation", "upsertRegulation");
  apply(
    ctx,
    "regulation.upserted",
    [parsed.id],
    `upsert regulation ${parsed.id} (${parsed.codeSection})`,
    (now) => {
      const existing = ctx.project.nodes[parsed.id];
      if (existing && existing.kind === "regulation") {
        Object.assign(existing, parsed);
        touchNode(existing, now);
      } else {
        ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      }
      // Replace role edges so the graph always agrees with the canonical
      // claimIds list — no stale evidence edges survive an upsert.
      removeEdgesWhere(
        ctx.project,
        (edge) => edge.dependentId === parsed.id && edge.role === "interpreted-from",
      );
      for (const claimId of parsed.claimIds) {
        addEdge(ctx.project, { dependentId: parsed.id, dependencyId: claimId, role: "interpreted-from" });
      }
    },
  );
}

export const MaterializeConstraintInput = ConstraintSemantic;
export function materializeConstraint(
  ctx: CommandContext,
  input: z.infer<typeof MaterializeConstraintInput>,
): void {
  const parsed = MaterializeConstraintInput.parse(input);
  requireNode(ctx.project, parsed.regulationId, "regulation");
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`node already exists: ${parsed.id} (constraints are create-only; materialize a new id)`);
  }
  apply(
    ctx,
    "constraint.materialized",
    [parsed.id],
    `materialize ${parsed.kind} constraint ${parsed.id}`,
    (now) => {
      ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      addEdge(ctx.project, { dependentId: parsed.id, dependencyId: parsed.regulationId, role: "materializes" });
    },
  );
}

// ---------------------------------------------------------------------------
// Mission + assumptions (origin rules enforced here)
// ---------------------------------------------------------------------------

export const ConfirmMissionConstraintInput = MissionConstraintConfirmation;
export function confirmMissionConstraint(
  ctx: CommandContext,
  input: z.infer<typeof ConfirmMissionConstraintInput>,
): void {
  const parsed = ConfirmMissionConstraintInput.parse(input);
  if (parsed.origin.kind !== "USER_DECLARED") {
    throw new Error("mission constraints must have USER_DECLARED origin");
  }
  // Referential integrity: preserve-structure rules must point at the
  // canonical Development Graph structure node (gis:structure:<id>), never a
  // raw provider identifier or a nonexistent building.
  if (parsed.normalized.type === "preserve-structure") {
    requireNode(ctx.project, parsed.normalized.structureId, "structure");
  }
  rejectKindCollision(ctx.project, parsed.id, "mission-constraint", "confirmMissionConstraint");
  apply(
    ctx,
    "mission.constraint.confirmed",
    [parsed.id],
    `confirm mission constraint ${parsed.id}: ${parsed.intentText}`,
    (now) => {
      const existing = ctx.project.nodes[parsed.id];
      if (existing && existing.kind === "mission-constraint") {
        Object.assign(existing, parsed);
        touchNode(existing, now);
      } else {
        ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      }
    },
  );
}

export const RetractMissionConstraintInput = z.object({ id: z.string().min(1) }).strict();

/**
 * Retract a confirmed mission constraint (issue #6). The node and every edge
 * touching it are removed; certificates whose dependency closure included it
 * grade INVALIDATED ("no longer exists") via the normal staleness refresh —
 * a retracted mission input must never silently keep certifying results.
 */
export function retractMissionConstraint(
  ctx: CommandContext,
  input: z.infer<typeof RetractMissionConstraintInput>,
): void {
  const parsed = RetractMissionConstraintInput.parse(input);
  const existing = requireNode(ctx.project, parsed.id, "mission-constraint");
  const intent = existing.intentText;
  apply(
    ctx,
    "mission.constraint.retracted",
    [parsed.id],
    `retract mission constraint ${parsed.id}: ${intent}`,
    () => {
      removeEdgesWhere(
        ctx.project,
        (edge) => edge.dependencyId === parsed.id || edge.dependentId === parsed.id,
      );
      delete ctx.project.nodes[parsed.id];
    },
  );
}

export const SetAssumptionInput = AssumptionSemantic;
export function setAssumption(
  ctx: CommandContext,
  input: z.infer<typeof SetAssumptionInput>,
): void {
  const parsed = SetAssumptionInput.parse(input);
  if (parsed.origin.kind !== "MODELER_DECLARED") {
    throw new Error("assumptions must have MODELER_DECLARED origin");
  }
  rejectKindCollision(ctx.project, parsed.id, "assumption", "setAssumption");
  apply(
    ctx,
    "assumption.set",
    [parsed.id],
    `set assumption ${parsed.id}: ${parsed.statement}`,
    (now) => {
      const existing = ctx.project.nodes[parsed.id];
      if (existing && existing.kind === "assumption") {
        Object.assign(existing, parsed);
        touchNode(existing, now);
      } else {
        ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Scenarios + certificates
// ---------------------------------------------------------------------------

export const RecordScenarioInput = z
  .object({
    scenarioId: z.string().min(1),
    label: z.string().min(1),
    solverVersion: z.string().min(1),
    status: z.enum(["COMPUTED", "FAILED", "REFUSED"]),
    metrics: z.array(ScenarioMetric),
    /** Direct constraint inputs of the computation. */
    constraintIds: z.array(z.string()).min(1),
    missionIds: z.array(z.string()),
    /** Must all be active assumptions. */
    assumptionIds: z.array(z.string()),
    parcelId: z.string().min(1),
    results: z
      .array(
        z
          .object({
            resultId: z.string().min(1),
            constraintId: z.string().min(1),
            status: ComputationState,
            actual: Quantity.nullable().optional(),
            limit: Quantity.nullable().optional(),
            explanation: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    certificateId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((input, zctx) => {
    const resultConstraints = new Set(input.results.map((result) => result.constraintId));
    for (const constraintId of input.constraintIds) {
      if (!resultConstraints.has(constraintId)) {
        zctx.addIssue({
          code: "custom",
          message: `constraint ${constraintId} has no evaluation result`,
        });
      }
    }
  });

export function recordScenario(
  ctx: CommandContext,
  input: z.infer<typeof RecordScenarioInput>,
): void {
  const parsed = RecordScenarioInput.parse(input);
  const project = ctx.project;

  for (const constraintId of parsed.constraintIds) requireNode(project, constraintId, "constraint");
  for (const missionId of parsed.missionIds) requireNode(project, missionId, "mission-constraint");
  for (const assumptionId of parsed.assumptionIds) {
    const node = requireNode(project, assumptionId, "assumption");
    if (!(node as unknown as { active: boolean }).active) {
      throw new Error(`assumption ${assumptionId} is not active`);
    }
  }
  requireNode(project, parsed.parcelId, "parcel");

  rejectKindCollision(ctx.project, parsed.scenarioId, "scenario", "recordScenario");
  const certificateBase = parsed.certificateId ?? `${parsed.scenarioId}:certificate`;
  const priorCertificates = Object.values(project.nodes).filter(
    (node) =>
      node.kind === "scenario-certificate" &&
      (node as unknown as { scenarioId: string }).scenarioId === parsed.scenarioId,
  );
  const certificateVersion = priorCertificates.length + 1;
  // Historical proofs are retained: each recording issues a NEW certificate
  // node id (v1 uses the base id; later versions are suffixed).
  const certificateId =
    certificateVersion === 1 ? certificateBase : `${certificateBase}:v${certificateVersion}`;
  const generatedIds = new Set<string>();
  const claimGeneratedId = (nodeId: string, label: string): void => {
    if (generatedIds.has(nodeId)) {
      throw new Error(`${label}: duplicate generated id ${nodeId} within the same recording`);
    }
    generatedIds.add(nodeId);
    requireUnusedNodeId(ctx.project, nodeId, label);
  };
  claimGeneratedId(certificateId, "recordScenario certificate id");
  for (const result of parsed.results) {
    const stored = certificateVersion === 1 ? result.resultId : `${result.resultId}@v${certificateVersion}`;
    claimGeneratedId(stored, "recordScenario result id");
  }

  apply(
    ctx,
    "scenario.recorded",
    [parsed.scenarioId],
    `record scenario ${parsed.scenarioId} (${parsed.label}) with certificate`,
    (now) => {
      const directInputs = [
        ...parsed.constraintIds,
        ...parsed.missionIds,
        ...parsed.assumptionIds,
        parsed.parcelId,
      ];
      // Results are versioned per recording: v1 keeps the base id, later
      // recordings get @v2, @v3... so historical certificates keep resolving
      // the results they were issued against (immutable proof history).
      const storedResultId = (baseId: string) =>
        certificateVersion === 1 ? baseId : `${baseId}@v${certificateVersion}`;
      for (const result of parsed.results) {
        const resultId = storedResultId(result.resultId);
        const resultNode = {
          id: resultId,
          kind: "constraint-result" as const,
          constraintId: result.constraintId,
          scenarioId: parsed.scenarioId,
          status: result.status,
          actual: result.actual ?? null,
          limit: result.limit ?? null,
          explanation: result.explanation,
          origin: { kind: "SYSTEM_DERIVED" as const },
        };
        project.nodes[resultId] = nodeWithMeta(resultNode, now);
        addEdge(project, { dependentId: resultId, dependencyId: result.constraintId, role: "evaluated-under" });
      }

      const scenarioNode = {
        id: parsed.scenarioId,
        kind: "scenario" as const,
        label: parsed.label,
        status: parsed.status,
        solverVersion: parsed.solverVersion,
        metrics: parsed.metrics,
        constraintResultIds: parsed.results.map((result) => storedResultId(result.resultId)),
        assumptionIds: parsed.assumptionIds,
        certificateId,
      };
      const existingScenario = project.nodes[parsed.scenarioId];
      if (existingScenario && existingScenario.kind === "scenario") {
        Object.assign(existingScenario, scenarioNode);
        touchNode(existingScenario, now);
      } else {
        project.nodes[parsed.scenarioId] = nodeWithMeta(scenarioNode, now);
      }
      // The Scenario is the mutable current head: replace its scenario-input
      // edge set so the graph always agrees with the head's actual inputs.
      // Historical proofs are unaffected (certificates pin their own refs).
      removeEdgesWhere(
        project,
        (edge) => edge.dependentId === parsed.scenarioId && edge.role === "scenario-input",
      );
      for (const result of parsed.results) {
        addEdge(project, { dependentId: parsed.scenarioId, dependencyId: storedResultId(result.resultId), role: "scenario-input" });
      }
      for (const constraintId of parsed.constraintIds) {
        addEdge(project, { dependentId: parsed.scenarioId, dependencyId: constraintId, role: "scenario-input" });
      }
      for (const missionId of parsed.missionIds) {
        addEdge(project, { dependentId: parsed.scenarioId, dependencyId: missionId, role: "scenario-input" });
      }
      for (const assumptionId of parsed.assumptionIds) {
        addEdge(project, { dependentId: parsed.scenarioId, dependencyId: assumptionId, role: "scenario-input" });
      }
      addEdge(project, { dependentId: parsed.scenarioId, dependencyId: parsed.parcelId, role: "scenario-input" });

      const dependencies = buildCertificateDependencies(project, directInputs);
      const certificate: ScenarioCertificateSemantic = {
        id: certificateId,
        kind: "scenario-certificate",
        scenarioId: parsed.scenarioId,
        certificateVersion,
        solverVersion: parsed.solverVersion,
        dependencies,
        assumptionIds: parsed.assumptionIds,
        constraintResultIds: parsed.results.map((result) => storedResultId(result.resultId)),
        metricsSnapshot: parsed.metrics,
        generatedAt: now,
        certificateHash: "pending",
        freshness: "CURRENT",
      };
      certificate.certificateHash = computeCertificateHash(certificate);
      project.nodes[certificateId] = nodeWithMeta(certificate, now);
      addEdge(project, { dependentId: certificateId, dependencyId: parsed.scenarioId, role: "certifies" });
    },
  );
}

// ---------------------------------------------------------------------------
// Expert review
// ---------------------------------------------------------------------------

export const OpenExpertReviewInput = ExpertReviewSemantic;
export function openExpertReviewItem(
  ctx: CommandContext,
  input: z.infer<typeof OpenExpertReviewInput>,
): void {
  const parsed = OpenExpertReviewInput.parse(input);
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`node already exists: ${parsed.id} (expert reviews are create-only; use updateExpertReviewItem)`);
  }
  apply(
    ctx,
    "expert-review.opened",
    [parsed.id],
    `open expert review ${parsed.id}`,
    (now) => {
      ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      for (const nodeId of parsed.affectedNodeIds) {
        addEdge(ctx.project, { dependentId: parsed.id, dependencyId: nodeId, role: "concerns" });
      }
    },
  );
}

export const UpdateExpertReviewInput = z
  .object({
    reviewId: z.string().min(1),
    reviewStatus: ReviewState,
    resolution: ExpertReviewSemantic.shape.resolution.optional(),
  })
  .strict();
export function updateExpertReviewItem(
  ctx: CommandContext,
  input: z.infer<typeof UpdateExpertReviewInput>,
): void {
  const parsed = UpdateExpertReviewInput.parse(input);
  const node = requireNode(ctx.project, parsed.reviewId, "expert-review");
  apply(
    ctx,
    "expert-review.updated",
    [parsed.reviewId],
    `expert review ${parsed.reviewId} -> ${parsed.reviewStatus}`,
    (now) => {
      Object.assign(node, { reviewStatus: parsed.reviewStatus, resolution: parsed.resolution });
      touchNode(node, now);
    },
  );
}

// ---------------------------------------------------------------------------
// Stakeholder views (presentation only — cannot stale certificates)
// ---------------------------------------------------------------------------

export const UpdateStakeholderViewInput = StakeholderViewSemantic;
export function updateStakeholderView(
  ctx: CommandContext,
  input: z.infer<typeof UpdateStakeholderViewInput>,
): void {
  const parsed = UpdateStakeholderViewInput.parse(input);
  rejectKindCollision(ctx.project, parsed.id, "stakeholder-view", "updateStakeholderView");
  if (parsed.selectedScenarioId) {
    requireNode(ctx.project, parsed.selectedScenarioId, "scenario");
  }
  apply(
    ctx,
    "stakeholder-view.updated",
    [parsed.id],
    `update stakeholder view ${parsed.id} (${parsed.audience})`,
    (now) => {
      const existing = ctx.project.nodes[parsed.id];
      if (existing && existing.kind === "stakeholder-view") {
        Object.assign(existing, parsed);
        touchNode(existing, now);
      } else {
        ctx.project.nodes[parsed.id] = nodeWithMeta(parsed, now);
      }
      removeEdgesWhere(
        ctx.project,
        (edge) => edge.dependentId === parsed.id && edge.role === "presents",
      );
      if (parsed.selectedScenarioId) {
        addEdge(ctx.project, { dependentId: parsed.id, dependencyId: parsed.selectedScenarioId, role: "presents" });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Source supersession
// ---------------------------------------------------------------------------

export const SupersedeSourceArtifactInput = z
  .object({
    sourceId: z.string().min(1),
    supersededBySourceId: z.string().min(1),
    /** Regulations to mark conflicted (explicit — no automatic detection). */
    conflictedRegulationIds: z.array(z.string()).default([]),
    note: z.string().optional(),
  })
  .strict()
  .refine((input) => input.sourceId !== input.supersededBySourceId, {
    message: "an artifact cannot supersede itself",
  });

export function supersedeSourceArtifact(
  ctx: CommandContext,
  input: z.infer<typeof SupersedeSourceArtifactInput>,
): void {
  const parsed = SupersedeSourceArtifactInput.parse(input);
  const oldArtifact = requireNode(ctx.project, parsed.sourceId, "source-artifact");
  const newArtifact = requireNode(ctx.project, parsed.supersededBySourceId, "source-artifact");
  if (oldArtifact.logicalSourceKey !== newArtifact.logicalSourceKey) {
    throw new Error(
      `cannot supersede across logical sources: ${parsed.sourceId} (${oldArtifact.logicalSourceKey}) vs ${parsed.supersededBySourceId} (${newArtifact.logicalSourceKey})`,
    );
  }
  if (newArtifact.version <= oldArtifact.version) {
    throw new Error(
      `superseding version must be strictly newer: ${newArtifact.version} <= ${oldArtifact.version}`,
    );
  }
  const existingTarget = (oldArtifact as unknown as { supersededBy?: string }).supersededBy;
  if (existingTarget) {
    if (existingTarget === parsed.supersededBySourceId) return; // idempotent replay
    throw new Error(
      `supersession history is immutable: ${parsed.sourceId} was already superseded by ${existingTarget}; to advance the chain, supersede ${existingTarget} instead`,
    );
  }
  for (const regulationId of parsed.conflictedRegulationIds) {
    requireNode(ctx.project, regulationId, "regulation");
  }
  const affected = [parsed.sourceId, ...parsed.conflictedRegulationIds];
  apply(
    ctx,
    "source.artifact.superseded",
    affected,
    `supersede ${parsed.sourceId} with ${parsed.supersededBySourceId}${parsed.note ? `: ${parsed.note}` : ""}`,
    (now) => {
      (oldArtifact as unknown as { supersededBy: string }).supersededBy =
        parsed.supersededBySourceId;
      touchNode(oldArtifact, now);
      for (const regulationId of parsed.conflictedRegulationIds) {
        const regulation = requireNode(ctx.project, regulationId, "regulation") as unknown as {
          conflictRefs: string[];
          currentness: string;
        };
        if (!regulation.conflictRefs.includes(parsed.supersededBySourceId)) {
          regulation.conflictRefs.push(parsed.supersededBySourceId);
        }
        regulation.currentness = "STALE";
        touchNode(requireNode(ctx.project, regulationId), now);
      }
      // Certificates re-grade inside apply(): a pinned, now-superseded artifact
      // forces INVALIDATED even when no downstream object was manually edited.
    },
  );
}

// ---------------------------------------------------------------------------
// Benchmark import marker (the adapter drives node creation through the
// commands above and records one import event for auditability)
// ---------------------------------------------------------------------------

export function markBenchmarkImported(
  ctx: CommandContext,
  input: { summary: string; affectedNodeIds: string[] },
): void {
  apply(
    ctx,
    "benchmark.imported",
    input.affectedNodeIds,
    input.summary,
    () => {},
  );
}
