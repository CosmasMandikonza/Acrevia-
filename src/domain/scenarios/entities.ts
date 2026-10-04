import { z } from "zod";
import { ComputationState, FreshnessState, NodeKind } from "../enums";
import { Quantity } from "../units/quantity";
import { Origin } from "../evidence/claim";
import { createSha256 } from "../graph/hashing";
import { canonicalJson } from "../graph/serialization";

/**
 * Computation layer. Issue #3 defines the contracts and the proof objects; the
 * deterministic solver itself belongs to #7. `recordScenario` accepts results
 * computed elsewhere (test doubles today, solver later) and issues a
 * ScenarioCertificate pinning the TRANSITIVE CLOSURE of the inputs that
 * contributed to the computation.
 */

export const ScenarioMetric = z
  .object({
    metricId: z.string().min(1),
    label: z.string().min(1),
    value: Quantity.nullable(),
  })
  .strict();
export type ScenarioMetric = z.infer<typeof ScenarioMetric>;

export const ScenarioSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("scenario"),
    label: z.string().min(1),
    status: z.enum(["COMPUTED", "FAILED", "REFUSED"]),
    solverVersion: z.string().min(1),
    metrics: z.array(ScenarioMetric),
    constraintResultIds: z.array(z.string()),
    assumptionIds: z.array(z.string()),
    certificateId: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type ScenarioSemantic = z.infer<typeof ScenarioSemantic>;

export const ConstraintResultSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("constraint-result"),
    constraintId: z.string().min(1),
    scenarioId: z.string().min(1),
    /** Computation vocabulary — never an evidence state. */
    status: ComputationState,
    actual: Quantity.nullable().optional(),
    limit: Quantity.nullable().optional(),
    explanation: z.string().min(1),
    origin: Origin, // SYSTEM_DERIVED
  })
  .strict();
export type ConstraintResultSemantic = z.infer<typeof ConstraintResultSemantic>;

export const DependencyRef = z
  .object({
    nodeId: z.string().min(1),
    nodeKind: NodeKind,
    revision: z.number().int().nonnegative(),
    semanticHash: z.string().min(1),
  })
  .strict();
export type DependencyRef = z.infer<typeof DependencyRef>;

export const ScenarioCertificateSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("scenario-certificate"),
    scenarioId: z.string().min(1),
    certificateVersion: z.number().int().positive(),
    solverVersion: z.string().min(1),
    /**
     * Transitive closure of consequential computation dependencies: direct
     * constraints + their regulations + claims + source artifacts, parcel
     * geometry + its source, mission constraints, active assumptions. Views,
     * narrative, unused sources/constraints are structurally excluded.
     */
    dependencies: z.array(DependencyRef).min(1),
    assumptionIds: z.array(z.string()),
    constraintResultIds: z.array(z.string()),
    /** Immutable output snapshot frozen at computation time, so a historical
     *  certificate keeps resolving its ORIGINAL metrics after recomputation. */
    metricsSnapshot: z.array(ScenarioMetric),
    generatedAt: z.string(), // timestamp: never semantic
    certificateHash: z.string().min(1),
    freshness: FreshnessState,
  })
  .strict();
export type ScenarioCertificateSemantic = z.infer<typeof ScenarioCertificateSemantic>;

/** certificateHash covers exactly the proof content; generatedAt and
 *  freshness are excluded (timestamps are never semantic; freshness is
 *  derived cache state). */
export function computeCertificateHash(input: {
  id: string;
  scenarioId: string;
  certificateVersion: number;
  solverVersion: string;
  dependencies: DependencyRef[];
  assumptionIds: string[];
  constraintResultIds: string[];
  metricsSnapshot: ScenarioMetric[];
}): string {
  return createSha256(
    canonicalJson({
      id: input.id,
      scenarioId: input.scenarioId,
      certificateVersion: input.certificateVersion,
      solverVersion: input.solverVersion,
      dependencies: input.dependencies,
      assumptionIds: input.assumptionIds,
      constraintResultIds: input.constraintResultIds,
      metricsSnapshot: input.metricsSnapshot,
    }),
  );
}
