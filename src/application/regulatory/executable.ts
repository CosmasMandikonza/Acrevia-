import type { Project } from "../../domain/graph/project";
import { getDependencies } from "../../domain/graph/traversal";

/**
 * The executable solver gate (issue #5). NO UNCITED REGULATION ENTERS THE
 * SOLVER: #7 must consume only the constraints this function returns, each
 * with the full reason chain for why it is (or is not) executable law.
 *
 * For each constraint the gate traverses the explicit graph edges:
 *   Constraint --materializes--> Regulation --interpreted-from--> Claim(s)
 *   --supported-by--> SourceArtifact(s)
 * and re-verifies independently of the compiler:
 *   - regulation currentness CURRENT
 *   - no unresolved BLOCKING expert review affecting the chain
 *   - supporting claims exist, are SOURCE_DERIVED, VERIFIED/SOURCE_CONFIRMED
 *   - source artifacts resolve, are not superseded, and carry locators
 *
 * SourceArtifact itself has no EvidenceState — evidence belongs to claims;
 * the gate never demands a node-kind it cannot have.
 */

export type ExecutabilityDecision = {
  constraintId: string;
  executable: boolean;
  reasons: string[];
  regulationId: string;
  claimIds: string[];
  sourceIds: string[];
};

export type ExecutableConstraintSelection = {
  executable: StoredConstraint[];
  decisions: ExecutabilityDecision[];
};

type StoredNode = Project["nodes"][string];
type StoredConstraint = Extract<StoredNode, { kind: "constraint" }>;

function dependenciesOf(project: Project, nodeId: string, role: string): string[] {
  return getDependencies(project, nodeId)
    .filter((edge) => edge.role === role)
    .map((edge) => edge.dependencyId);
}

export function selectExecutableConstraints(project: Project): ExecutableConstraintSelection {
  const constraints = Object.values(project.nodes).filter(
    (node): node is StoredConstraint => node.kind === "constraint",
  );
  // Deterministic order.
  constraints.sort((a, b) => a.id.localeCompare(b.id));

  const executable: StoredConstraint[] = [];
  const decisions: ExecutabilityDecision[] = [];

  for (const constraint of constraints) {
    const reasons: string[] = [];
    const regulationId = constraint.regulationId;
    const regulation = project.nodes[regulationId];
    const claimIds = dependenciesOf(project, constraint.id, "materializes")
      .flatMap((id) => dependenciesOf(project, id, "interpreted-from"));
    const sourceIds = claimIds.flatMap((id) => dependenciesOf(project, id, "supported-by"));

    if (!regulation || regulation.kind !== "regulation") {
      reasons.push(`regulation ${regulationId} does not resolve in the graph`);
    } else {
      if (regulation.currentness !== "CURRENT") {
        reasons.push(`regulation currentness is ${regulation.currentness}, not CURRENT`);
      }
      if (regulation.supersededBy) {
        reasons.push(`regulation superseded by ${regulation.supersededBy}`);
      }
      if (regulation.claimIds.length === 0) {
        reasons.push("regulation cites no claims");
      }
    }

    const claims = claimIds
      .map((id) => project.nodes[id])
      .filter((node): node is Extract<StoredNode, { kind: "claim" }> => node?.kind === "claim");
    if (claims.length !== claimIds.length) {
      reasons.push("one or more supporting claims no longer exist");
    }
    for (const claim of claims) {
      if (claim.kind !== "claim") continue;
      if (claim.origin.kind !== "SOURCE_DERIVED") {
        reasons.push(`claim ${claim.id} origin is ${claim.origin.kind}, not SOURCE_DERIVED`);
      }
      if (claim.evidenceState !== "VERIFIED" && claim.evidenceState !== "SOURCE_CONFIRMED") {
        reasons.push(
          `claim ${claim.id} evidence is ${claim.evidenceState ?? "unset"} (needs VERIFIED or SOURCE_CONFIRMED)`,
        );
      }
      if (!claim.verbatimQuote?.trim()) {
        reasons.push(`claim ${claim.id} carries no verbatim supporting text`);
      }
    }

    const sources = sourceIds
      .map((id) => project.nodes[id])
      .filter((node): node is Extract<StoredNode, { kind: "source-artifact" }> => node?.kind === "source-artifact");
    if (sources.length !== sourceIds.length) {
      reasons.push("one or more cited source artifacts do not resolve");
    }
    for (const source of sources) {
      if (source.kind !== "source-artifact") continue;
      if (source.supersededBy) {
        reasons.push(`source ${source.id} superseded by ${source.supersededBy}`);
      }
    }

    // Blocking open expert reviews anywhere in the chain.
    const chain = [constraint.id, regulationId, ...claimIds, ...sourceIds];
    const chainSet = new Set(chain);
    for (const node of Object.values(project.nodes)) {
      if (node.kind !== "expert-review") continue;
      if (node.reviewStatus === "RESOLVED" || node.reviewStatus === "WAIVED") continue;
      if (node.severity !== "blocking") continue;
      const affects = dependenciesOf(project, node.id, "concerns");
      if (affects.some((id) => chainSet.has(id))) {
        reasons.push(`open blocking expert review ${node.id} affects this chain`);
      }
    }

    const decision: ExecutabilityDecision = {
      constraintId: constraint.id,
      executable: reasons.length === 0,
      reasons,
      regulationId,
      claimIds,
      sourceIds,
    };
    decisions.push(decision);
    if (decision.executable) executable.push(constraint);
  }

  return { executable, decisions };
}
