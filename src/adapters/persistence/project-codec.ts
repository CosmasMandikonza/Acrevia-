import { ProjectSchema, type Project } from "../../domain/graph/project";
import { canonicalJson } from "../../domain/graph/serialization";
import { computeSemanticHash } from "../../domain/graph/node";
import { computeCertificateHash } from "../../domain/scenarios/entities";

/**
 * ProjectCodec — the single persistence boundary.
 *
 * encode: Project -> deterministic canonical JSON string.
 * decode: canonical JSON string -> runtime-validated Project. This is a TRUST
 *         boundary, not just a shape boundary: after Zod parsing, an integrity
 *         pass verifies that the persisted state is internally consistent —
 *         node keys match node ids, every semanticHash and certificateHash
 *         recomputes, every edge references existing nodes, and the project's
 *         property resolves. Malformed-but-schema-valid data fails HERE
 *         instead of poisoning staleness/provenance later.
 *
 * The production persistence decision (PostgreSQL/PostGIS) is deferred per
 * ADR 0001/0003; whatever persists later persists THIS representation.
 */

function assertIntegrity(project: Project): void {
  for (const [key, node] of Object.entries(project.nodes)) {
    if (node.id !== key) {
      throw new Error(`integrity: node map key '${key}' does not match node.id '${node.id}'`);
    }
    if (node.kind === "scenario-certificate") {
      // Proof hash first so its rejection is independently observable.
      const expected = computeCertificateHash({
        id: node.id,
        scenarioId: node.scenarioId,
        certificateVersion: node.certificateVersion,
        solverVersion: node.solverVersion,
        dependencies: node.dependencies,
        assumptionIds: node.assumptionIds,
        constraintResultIds: node.constraintResultIds,
        metricsSnapshot: node.metricsSnapshot,
      });
      if (expected !== node.certificateHash) {
        throw new Error(`integrity: certificateHash mismatch on ${node.id}`);
      }
    }
    const recomputed = computeSemanticHash(node);
    if (recomputed !== node.meta.semanticHash) {
      throw new Error(
        `integrity: semanticHash mismatch on ${node.id} (stored ${node.meta.semanticHash.slice(0, 8)}, recomputed ${recomputed.slice(0, 8)})`,
      );
    }
  }
  for (const edge of project.edges) {
    if (!project.nodes[edge.dependentId]) {
      throw new Error(`integrity: edge references missing dependent '${edge.dependentId}'`);
    }
    if (!project.nodes[edge.dependencyId]) {
      throw new Error(`integrity: edge references missing dependency '${edge.dependencyId}'`);
    }
  }
  const property = project.nodes[project.propertyId];
  if (!property || property.kind !== "property") {
    throw new Error(`integrity: propertyId '${project.propertyId}' does not resolve to a property node`);
  }
}

export const ProjectCodec = {
  encode(project: Project): string {
    return canonicalJson(project);
  },
  decode(json: string): Project {
    const parsed = ProjectSchema.parse(JSON.parse(json)) as unknown as Project;
    assertIntegrity(parsed);
    return parsed;
  },
};
