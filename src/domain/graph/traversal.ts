import { AnyNode, Edge, Project } from "./project";
import { DependencyRef, ScenarioCertificateSemantic } from "../scenarios/entities";
import { FreshnessState } from "../enums";

/**
 * Typed traversal over explicit edges. Maps and arrays only — no graph database.
 * Edges always point dependent -> dependency.
 */

export function getDependencies(project: Project, nodeId: string): Edge[] {
  return project.edges.filter((edge) => edge.dependentId === nodeId);
}

export function getDependents(project: Project, nodeId: string): Edge[] {
  return project.edges.filter((edge) => edge.dependencyId === nodeId);
}

export type EvidenceChainNode = {
  nodeId: string;
  kind: AnyNode["kind"];
  role?: Edge["role"];
  rawEvidenceRef?: string;
  children: EvidenceChainNode[];
};

/**
 * Walk dependencies recursively from a node down to its SourceArtifacts.
 * Returns the layered provenance chain as data (Proof/Council consume this).
 */
export function getEvidenceChain(project: Project, nodeId: string): EvidenceChainNode {
  const seen = new Set<string>();
  const walk = (id: string, role: Edge["role"] | undefined): EvidenceChainNode => {
    const node = project.nodes[id];
    if (!node) {
      return { nodeId: id, kind: "claim", role, children: [] }; // missing node: surfaced by staleness
    }
    const current: EvidenceChainNode = {
      nodeId: id,
      kind: node.kind,
      role,
      rawEvidenceRef:
        node.kind === "source-artifact" ? (node as { rawEvidenceRef?: string }).rawEvidenceRef : undefined,
      children: [],
    };
    if (node.kind === "source-artifact" || seen.has(id)) return current;
    seen.add(id);
    current.children = getDependencies(project, id).map((edge) =>
      walk(edge.dependencyId, edge.role),
    );
    return current;
  };
  return walk(nodeId, undefined);
}

/**
 * Transitive closure of consequential dependencies, starting from the direct
 * inputs of a computation. Structurally excludes anything unreachable — views,
 * narrative, unused sources, unused constraints never enter.
 */
export function computeDependencyClosure(project: Project, directInputIds: string[]): string[] {
  const closure = new Set<string>();
  const queue = [...directInputIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (closure.has(id)) continue;
    closure.add(id);
    for (const edge of getDependencies(project, id)) {
      queue.push(edge.dependencyId);
    }
  }
  return [...closure].sort();
}

/**
 * BFS over dependents from changed nodes. Returns derived nodes whose trust may
 * be affected (scenario certificates today; certificates regrade themselves).
 */
export function getAffectedArtifacts(project: Project, changedNodeIds: string[]): string[] {
  const affected = new Set<string>();
  const queue = [...changedNodeIds];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of getDependents(project, id)) {
      queue.push(edge.dependentId);
      const node = project.nodes[edge.dependentId];
      if (node && node.kind === "scenario-certificate") {
        affected.add(edge.dependentId);
      }
    }
  }
  return [...affected].sort();
}

function dependencyRefFor(node: AnyNode): DependencyRef {
  return {
    nodeId: node.id,
    nodeKind: node.kind,
    revision: node.meta.revision,
    semanticHash: node.meta.semanticHash,
  };
}

/** Build the pinned dependency list for a certificate from its closure. */
export function buildCertificateDependencies(
  project: Project,
  directInputIds: string[],
): DependencyRef[] {
  return computeDependencyClosure(project, directInputIds)
    .map((id) => project.nodes[id])
    .filter((node): node is AnyNode => Boolean(node))
    .map(dependencyRefFor);
}

export type FreshnessGrade = {
  freshness: FreshnessState;
  /** Human-readable reasons — the "why is this stale?" answer. */
  reasons: string[];
};

/**
 * Dependency-aware staleness. The project revision alone is NEVER used.
 *
 * INVALIDATED — a pinned node is missing, a pinned source artifact was
 *   superseded, or a pinned regulation is conflicted/superseded: the proof's
 *   inputs were retracted, so recomputing from them is not allowed.
 * STALE — a pinned revision/semanticHash drifted: recompute may restore trust.
 * CURRENT — every pinned dependency matches exactly.
 */
export function gradeCertificate(project: Project, certificateId: string): FreshnessGrade {
  const node = project.nodes[certificateId];
  if (!node || node.kind !== "scenario-certificate") {
    throw new Error(`not a scenario certificate: ${certificateId}`);
  }
  const certificate = node as unknown as { dependencies: DependencyRef[]; freshness: FreshnessState };
  const reasons: string[] = [];

  for (const ref of certificate.dependencies) {
    const current = project.nodes[ref.nodeId];
    if (!current) {
      return { freshness: "INVALIDATED", reasons: [`dependency ${ref.nodeId} no longer exists`] };
    }
    if (current.kind === "source-artifact" && "supersededBy" in current && current.supersededBy) {
      reasons.push(`source artifact ${ref.nodeId} superseded by ${current.supersededBy}`);
    }
    if (current.kind === "regulation") {
      const regulation = current as unknown as { conflictRefs: string[]; supersededBy?: string };
      if (regulation.conflictRefs.length > 0) {
        reasons.push(`regulation ${ref.nodeId} in conflict with ${regulation.conflictRefs.join(", ")}`);
      }
      if (regulation.supersededBy) {
        reasons.push(`regulation ${ref.nodeId} superseded by ${regulation.supersededBy}`);
      }
    }
    if (current.meta.revision !== ref.revision || current.meta.semanticHash !== ref.semanticHash) {
      reasons.push(
        `dependency ${ref.nodeId} changed (pinned r${ref.revision}/${ref.semanticHash.slice(0, 8)}, ` +
          `now r${current.meta.revision}/${current.meta.semanticHash.slice(0, 8)})`,
      );
    }
  }

  if (reasons.some((reason) => reason.includes("superseded") || reason.includes("conflict") || reason.includes("no longer exists"))) {
    return { freshness: "INVALIDATED", reasons };
  }
  if (reasons.length > 0) return { freshness: "STALE", reasons };
  return { freshness: "CURRENT", reasons };
}

export function isArtifactStale(
  project: Project,
  certificate: { id: string },
): boolean {
  const grade = gradeCertificate(project, certificate.id);
  return grade.freshness !== "CURRENT";
}

/** Re-grade every certificate. Unaffected certificates stay CURRENT because
 *  their pins still match — this is what makes invalidation dependency-aware. */
export function refreshStaleness(project: Project): void {
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== "scenario-certificate") continue;
    const grade = gradeCertificate(project, node.id);
    (node as unknown as { freshness: FreshnessState }).freshness = grade.freshness;
  }
}

export type MetricExplanation = {
  metricId: string;
  scenarioId?: string;
  certificateId?: string;
  certificateFreshness?: FreshnessState;
  contributions: EvidenceChainNode[];
};

/** metric -> scenario -> certificate -> constraints -> ... -> sources. */
export function explainMetric(project: Project, metricId: string): MetricExplanation {
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== "scenario") continue;
    const scenario = node as unknown as {
      id: string;
      metrics: Array<{ metricId: string }>;
      certificateId?: string;
    };
    if (!scenario.metrics.some((metric) => metric.metricId === metricId)) continue;

    const explanation: MetricExplanation = { metricId, scenarioId: scenario.id, contributions: [] };
    if (scenario.certificateId) {
      explanation.certificateId = scenario.certificateId;
      const cert = project.nodes[scenario.certificateId];
      if (cert && cert.kind === "scenario-certificate") {
        explanation.certificateFreshness = (cert as unknown as ScenarioCertificateSemantic).freshness;
        for (const ref of (cert as unknown as ScenarioCertificateSemantic).dependencies) {
          if (ref.nodeKind === "constraint" || ref.nodeKind === "mission-constraint" || ref.nodeKind === "parcel") {
            explanation.contributions.push(getEvidenceChain(project, ref.nodeId));
          }
        }
      }
    }
    return explanation;
  }
  throw new Error(`metric not found: ${metricId}`);
}
