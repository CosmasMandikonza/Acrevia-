import { recordScenario, type CommandContext } from "../../commands";
import { gradeCertificate } from "../../domain";
import { createSha256 } from "../../domain/graph/hashing";
import { canonicalJson } from "../../domain/graph/serialization";
import { Unit } from "../../domain";
import { SOLVER_VERSION, type EvaluatedConstraint, type SolveSuccess } from "./solve";

/**
 * Production scenario recording (issue #7, consolidated correction round).
 *
 * The solve path must not just compute scenarios — every scenario it RETURNS
 * is recorded into the Development Graph through the EXISTING recordScenario
 * command, so each displayed scenario carries a machine-checkable
 * ScenarioCertificate whose dependency closure pins the exact law, missions,
 * assumptions, parcel, and preserved structures it was computed from.
 *
 * Determinism/idempotency: scenario ids are derived from a digest over the
 * certificate-closure inputs plus the selected point. Replaying identical
 * solve state yields identical ids — the already-recorded scenario is reused
 * and its certificate re-graded (CURRENT). Changed law/mission/assumption
 * state yields a NEW id (the old certificate goes STALE through the normal
 * dependency-closure machinery); recording follows existing command
 * semantics, so certificate history is intentional, not surprising.
 */

export type RecordedScenario = {
  scenarioId: string;
  certificateId: string;
  freshness: string;
};

function labelSlug(label: string | null): string {
  return (label ?? "unlabeled").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function toResultRows(digest: string, results: EvaluatedConstraint[]) {
  return results
    .filter((r) => r.constraintId !== undefined)
    .map((r) => ({
      resultId: `result:${digest}:${r.constraintId}`,
      constraintId: r.constraintId as string,
      status: r.status,
      actual:
        r.actual !== undefined && r.actualUnit !== undefined
          ? { value: r.actual, unit: Unit.parse(r.actualUnit) }
          : null,
      limit:
        r.limit !== undefined && r.limitUnit !== undefined
          ? { value: r.limit, unit: Unit.parse(r.limitUnit) }
          : null,
      explanation: r.explanation,
    }));
}

export function recordSolverScenarios(ctx: CommandContext, result: SolveSuccess): RecordedScenario[] {
  if (result.status !== "SOLVED") {
    throw new Error("recordSolverScenarios requires a SOLVED result");
  }
  const recorded: RecordedScenario[] = [];

  // Exact semantic identity of every direct dependency, mirroring what the
  // certificate closure pins: {nodeId, revision, semanticHash}. IDs alone
  // are NOT enough — a consequential edit can leave the selected point
  // identical, and reusing the old scenario id would return the old STALE
  // certificate instead of issuing a fresh CURRENT one. Never timestamps:
  // revision + semanticHash are semantic, createdAt/lastModifiedAt are not.
  const dependencyState = (ids: string[]) =>
    ids.map((nodeId) => {
      const node = ctx.project.nodes[nodeId] as
        | { meta?: { revision?: number; semanticHash?: string } }
        | undefined;
      return {
        nodeId,
        revision: node?.meta?.revision ?? -1,
        semanticHash: node?.meta?.semanticHash ?? "",
      };
    });

  const lawState = dependencyState(result.inputs.law.map((c) => c.id));
  const missionState = dependencyState(result.inputs.missions.map((m) => m.id));
  const assumptionState = dependencyState(result.inputs.assumptionIds);
  const parcelState = dependencyState([result.inputs.parcelId]);

  for (const scenario of result.scenarios) {
    // Digest over the exact dependency semantic state + the selected point.
    const digest = createSha256(
      canonicalJson({
        projectId: result.inputs.projectId,
        parcel: parcelState,
        law: lawState,
        missions: missionState,
        assumptions: assumptionState,
        label: scenario.label,
        point: scenario.point,
      }),
    ).slice(0, 12);
    const scenarioId = `scenario:solver:${labelSlug(scenario.label)}:${digest}`;
    const certificateId = `${scenarioId}:certificate`;

    if (!ctx.project.nodes[scenarioId]) {
      recordScenario(ctx, {
        scenarioId,
        label: scenario.label ?? "Solver scenario",
        solverVersion: SOLVER_VERSION,
        status: "COMPUTED",
        metrics: [
          {
            metricId: "homes",
            label: "Homes",
            value: { value: scenario.point.homes, unit: "dwelling_units" },
          },
          {
            metricId: "parking-stalls",
            label: "Parking stalls",
            value: { value: scenario.point.parkingStalls, unit: "spaces" },
          },
          {
            metricId: "footprint",
            label: "Building footprint",
            value: { value: scenario.point.footprintSqFt, unit: "sq_ft" },
          },
          {
            metricId: "floors",
            label: "Floors",
            value: { value: scenario.point.floors, unit: "stories" },
          },
        ],
        constraintIds: result.inputs.law.map((c) => c.id),
        missionIds: result.inputs.missions.map((m) => m.id),
        assumptionIds: result.inputs.assumptionIds,
        parcelId: result.inputs.parcelId,
        results: toResultRows(digest, scenario.results),
        certificateId,
      });
    }

    const grade = gradeCertificate(ctx.project, certificateId);
    recorded.push({ scenarioId, certificateId, freshness: grade.freshness });
  }
  return recorded;
}
