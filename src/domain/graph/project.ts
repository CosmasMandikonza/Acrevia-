import { z } from "zod";
import { NodeMetaSchema, NodeMeta } from "./node";
import { DependencyRole } from "../enums";
import { SourceArtifactSemantic } from "../evidence/source-artifact";
import { ClaimSemantic } from "../evidence/claim";
import { RegulationSemantic } from "../evidence/regulation";
import { ConstraintSemantic, constraintVariants } from "../constraints/constraint";
import { MissionConstraintSemantic } from "../constraints/mission";
import { AssumptionSemantic } from "../constraints/assumption";
import {
  PropertySemantic,
  ParcelSemantic,
  StructureSemantic,
  JurisdictionSemantic,
} from "../property/entities";
import {
  ScenarioSemantic,
  ConstraintResultSemantic,
  ScenarioCertificateSemantic,
} from "../scenarios/entities";
import { ExpertReviewSemantic } from "../review/expert-review";
import { StakeholderViewSemantic } from "../views/stakeholder-view";
import { ProjectEventSchema, ProjectEvent } from "../events/project-event";

/**
 * Project aggregate and node registry.
 *
 * TypeScript types below are hand-written and are the narrowing source of
 * truth; the zod schemas next to them are the runtime validators used at
 * persistence/adapter boundaries. Deeply nested zod v4 inference is not
 * reliable enough to drive a 15-member union, so the two are bridged
 * explicitly rather than via z.infer.
 */

export const EdgeSchema = z
  .object({
    /** The node that depends on the other. Edges point dependent -> dependency. */
    dependentId: z.string().min(1),
    dependencyId: z.string().min(1),
    role: DependencyRole,
  })
  .strict();
export type Edge = z.infer<typeof EdgeSchema>;

/** Compose a full node schema (semantic fields + meta). */
const withMeta = (semantic: z.ZodObject<z.ZodRawShape>) =>
  semantic.extend({ meta: NodeMetaSchema });

const nodeSchemas = [
  withMeta(PropertySemantic),
  withMeta(ParcelSemantic),
  withMeta(StructureSemantic),
  withMeta(JurisdictionSemantic),
  withMeta(SourceArtifactSemantic),
  withMeta(ClaimSemantic),
  withMeta(RegulationSemantic),
  z.union(constraintVariants.map((variant) => withMeta(variant))),
  withMeta(MissionConstraintSemantic),
  withMeta(AssumptionSemantic),
  withMeta(ScenarioSemantic),
  withMeta(ConstraintResultSemantic),
  withMeta(ScenarioCertificateSemantic),
  withMeta(ExpertReviewSemantic),
  withMeta(StakeholderViewSemantic),
] as const;

export const AnyNodeSchema = z.union(nodeSchemas);

type WithMeta<Semantic> = Semantic & { meta: NodeMeta };

export type AnyNode =
  | WithMeta<PropertySemantic>
  | WithMeta<ParcelSemantic>
  | WithMeta<StructureSemantic>
  | WithMeta<JurisdictionSemantic>
  | WithMeta<SourceArtifactSemantic>
  | WithMeta<ClaimSemantic>
  | WithMeta<RegulationSemantic>
  | WithMeta<ConstraintSemantic>
  | WithMeta<MissionConstraintSemantic>
  | WithMeta<AssumptionSemantic>
  | WithMeta<ScenarioSemantic>
  | WithMeta<ConstraintResultSemantic>
  | WithMeta<ScenarioCertificateSemantic>
  | WithMeta<ExpertReviewSemantic>
  | WithMeta<StakeholderViewSemantic>;

export type Project = {
  projectId: string;
  schemaVersion: "acrevia.graph.v1";
  /** Monotonic audit/concurrency counter. NEVER used alone for staleness. */
  revision: number;
  propertyId: string;
  createdAt: string;
  updatedAt: string;
  nodes: Record<string, AnyNode>;
  edges: Edge[];
  events: ProjectEvent[];
};

/** Runtime validator for the persistence boundary. The hand-written `Project`
 *  type above is the compile-time source of truth; decode() bridges them. */
export const ProjectSchema = z
  .object({
    projectId: z.string().min(1),
    schemaVersion: z.literal("acrevia.graph.v1"),
    revision: z.number().int().nonnegative(),
    propertyId: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    nodes: z.record(z.string(), AnyNodeSchema),
    edges: z.array(EdgeSchema),
    events: z.array(ProjectEventSchema),
  })
  .strict();

export function createProject(input: {
  projectId: string;
  propertyId: string;
  now: string;
}): Project {
  return {
    projectId: input.projectId,
    schemaVersion: "acrevia.graph.v1",
    revision: 0,
    propertyId: input.propertyId,
    createdAt: input.now,
    updatedAt: input.now,
    nodes: {},
    edges: [],
    events: [],
  };
}

export function getNode(project: Project, nodeId: string): AnyNode | undefined {
  return project.nodes[nodeId];
}

export function requireNode(project: Project, nodeId: string): AnyNode;
export function requireNode<K extends AnyNode["kind"]>(
  project: Project,
  nodeId: string,
  expectedKind: K,
): Extract<AnyNode, { kind: K }>;
export function requireNode(
  project: Project,
  nodeId: string,
  expectedKind?: AnyNode["kind"],
): AnyNode {
  const node = project.nodes[nodeId];
  if (!node) throw new Error(`node not found: ${nodeId}`);
  if (expectedKind && node.kind !== expectedKind) {
    throw new Error(`node ${nodeId} is ${node.kind}, expected ${expectedKind}`);
  }
  return node;
}

export function nodesOfKind<K extends AnyNode["kind"]>(
  project: Project,
  kind: K,
): Extract<AnyNode, { kind: K }>[] {
  return Object.values(project.nodes).filter(
    (node): node is Extract<AnyNode, { kind: K }> => node.kind === kind,
  );
}

export function addEdge(project: Project, edge: Edge): void {
  const duplicate = project.edges.some(
    (existing) =>
      existing.dependentId === edge.dependentId &&
      existing.dependencyId === edge.dependencyId &&
      existing.role === edge.role,
  );
  if (!duplicate) project.edges.push(edge);
}
