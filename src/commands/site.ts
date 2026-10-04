import { z } from "zod";
import {
  Project,
  addEdge,
  requireNode,
  createProject,
} from "../domain/graph/project";
import { nodeWithMeta } from "../domain/graph/node";
import { ProjectEvent, ProjectEventType } from "../domain/events/project-event";
import { refreshStaleness } from "../domain/graph/traversal";
import { GeometryRecord } from "../domain/property/entities";
import { validatePropertyRules } from "../domain/property/entities";
import { ClaimSemantic } from "../domain/evidence/claim";
import { addSourceArtifact, recordClaim, type CommandContext } from "./index";
import { ProjectCodec } from "../adapters/persistence/project-codec";

/**
 * Typed site-commit boundary (issue #4). Live GIS code never mutates graph
 * nodes benchmark-style; it goes through these commands, which preserve every
 * issue-#3 invariant: runtime validation, unused-id/kind integrity, provenance
 * references, edges, semantic hashing, ProjectEvents.
 *
 * commitResolvedSite is ATOMIC from the caller's perspective: the entire
 * mutation set is staged into a codec-cloned project, integrity-validated as a
 * whole, and only then written back. Any late failure leaves the canonical
 * project byte-for-byte unchanged.
 */

export const CreateParcelInput = z
  .object({
    id: z.string().min(1),
    parcelIdSystem: z.string().min(1),
    parcelNumber: z.string().min(1),
    geometry: GeometryRecord,
    recordedArea: z
      .object({ value: z.number().finite(), unit: z.literal("sq_ft") })
      .strict()
      .optional(),
    computedAreas: z
      .array(z.object({ method: z.string().min(1), valueSqFt: z.number().finite() }).strict())
      .default([]),
    claimIds: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();
export type CreateParcelInput = z.infer<typeof CreateParcelInput>;

export const CreateExistingStructureInput = z
  .object({
    id: z.string().min(1),
    parcelId: z.string().min(1),
    footprint: GeometryRecord.optional(),
    attributeClaimIds: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();
export type CreateExistingStructureInput = z.infer<typeof CreateExistingStructureInput>;

export const CreateJurisdictionAssignmentInput = z
  .object({
    id: z.string().min(1),
    jurisdiction: z
      .object({ city: z.string(), state: z.string(), country: z.string() })
      .strict(),
    method: z.string().min(1),
    claimIds: z.array(z.string()).default([]),
  })
  .strict();
export type CreateJurisdictionAssignmentInput = z.infer<typeof CreateJurisdictionAssignmentInput>;

export function createParcel(ctx: CommandContext, input: CreateParcelInput): void {
  const parsed = CreateParcelInput.parse(input);
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`createParcel: node id ${parsed.id} already exists; ids must be unused`);
  }
  for (const claimId of [parsed.geometry.sourceClaimId, ...parsed.claimIds]) {
    if (claimId && !ctx.project.nodes[claimId]) {
      throw new Error(`createParcel: referenced claim ${claimId} does not exist`);
    }
  }
  applySiteEvent(ctx, "parcel.created", [parsed.id], `create parcel ${parsed.id} (${parsed.parcelIdSystem} ${parsed.parcelNumber})`, (now) => {
    ctx.project.nodes[parsed.id] = nodeWithMeta(
      { ...parsed, kind: "parcel" as const },
      now,
    );
    for (const claimId of parsed.claimIds) {
      addEdge(ctx.project, { dependentId: parsed.id, dependencyId: claimId, role: "grounded-in" });
    }
  });
}


/** createParcel without grounding-edge pass — used by the staged commit where
 *  claims that parcels ground in are recorded after parcels exist. Validation
 *  of those claim ids still happens before the commit returns (integrity gate
 *  plus the explicit edge pass above). */
function createParcelLoose(ctx: CommandContext, parsed: CreateParcelInput): void {
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`createParcel: node id ${parsed.id} already exists; ids must be unused`);
  }
  applySiteEvent(ctx, "parcel.created", [parsed.id], `create parcel ${parsed.id} (${parsed.parcelIdSystem} ${parsed.parcelNumber})`, (now) => {
    ctx.project.nodes[parsed.id] = nodeWithMeta({ ...parsed, kind: "parcel" as const }, now);
  });
}

export function createExistingStructure(
  ctx: CommandContext,
  input: CreateExistingStructureInput,
): void {
  const parsed = CreateExistingStructureInput.parse(input);
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`createExistingStructure: node id ${parsed.id} already exists; ids must be unused`);
  }
  requireNode(ctx.project, parsed.parcelId, "parcel");
  for (const claimId of parsed.footprint?.sourceClaimId
    ? [parsed.footprint.sourceClaimId, ...parsed.attributeClaimIds]
    : parsed.attributeClaimIds) {
    if (!ctx.project.nodes[claimId]) {
      throw new Error(`createExistingStructure: referenced claim ${claimId} does not exist`);
    }
  }
  applySiteEvent(ctx, "structure.created", [parsed.id], `create structure ${parsed.id} on ${parsed.parcelId}`, (now) => {
    ctx.project.nodes[parsed.id] = nodeWithMeta(
      { ...parsed, kind: "structure" as const },
      now,
    );
    addEdge(ctx.project, { dependentId: parsed.id, dependencyId: parsed.parcelId, role: "located-on" });
    for (const claimId of parsed.attributeClaimIds) {
      addEdge(ctx.project, { dependentId: parsed.id, dependencyId: claimId, role: "grounded-in" });
    }
  });
}


/** createExistingStructure with grounding edges deferred (staged commit). */
function createExistingStructureLoose(ctx: CommandContext, parsed: CreateExistingStructureInput): void {
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`createExistingStructure: node id ${parsed.id} already exists; ids must be unused`);
  }
  requireNode(ctx.project, parsed.parcelId, "parcel");
  applySiteEvent(ctx, "structure.created", [parsed.id], `create structure ${parsed.id} on ${parsed.parcelId}`, (now) => {
    ctx.project.nodes[parsed.id] = nodeWithMeta({ ...parsed, kind: "structure" as const }, now);
  });
  addEdge(ctx.project, { dependentId: parsed.id, dependencyId: parsed.parcelId, role: "located-on" });
}

export function createJurisdictionAssignment(
  ctx: CommandContext,
  input: CreateJurisdictionAssignmentInput,
): void {
  const parsed = CreateJurisdictionAssignmentInput.parse(input);
  if (ctx.project.nodes[parsed.id]) {
    throw new Error(`createJurisdictionAssignment: node id ${parsed.id} already exists; ids must be unused`);
  }
  for (const claimId of parsed.claimIds) {
    if (!ctx.project.nodes[claimId]) {
      throw new Error(`createJurisdictionAssignment: referenced claim ${claimId} does not exist`);
    }
  }
  applySiteEvent(ctx, "jurisdiction.created", [parsed.id], `create jurisdiction assignment ${parsed.id} (${parsed.method})`, (now) => {
    ctx.project.nodes[parsed.id] = nodeWithMeta(
      { ...parsed, kind: "jurisdiction" as const },
      now,
    );
    for (const claimId of parsed.claimIds) {
      addEdge(ctx.project, { dependentId: parsed.id, dependencyId: claimId, role: "grounded-in" });
    }
  });
}

function applySiteEvent(
  ctx: CommandContext,
  eventType: ProjectEventType,
  affectedNodeIds: string[],
  commandSummary: string,
  mutate: (now: string) => void,
): void {
  const now = ctx.now ? ctx.now() : new Date().toISOString();
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
// Atomic site commit
// ---------------------------------------------------------------------------

export type StagedSourceArtifact = z.infer<typeof import("./index").AddSourceArtifactInput>;
export type StagedClaim = ClaimSemantic;

export const CommitResolvedSiteInput = z
  .object({
    projectId: z.string().min(1),
    property: z
      .object({
        id: z.string().min(1),
        displayName: z.string().min(1),
        primaryParcelId: z.string().min(1),
        parcelIds: z.array(z.string()).min(1),
        addressText: z.string().optional(),
      })
      .strict(),
    /** May be undefined when the caller starts a brand-new project. */
    baseProject: z.instanceof(Object as unknown as new () => Project).optional(),
    sourceArtifacts: z.array(z.any()).default([]),
    claims: z.array(z.any()).default([]),
    parcels: z.array(CreateParcelInput).min(1),
    structures: z.array(CreateExistingStructureInput).default([]),
    jurisdictions: z.array(CreateJurisdictionAssignmentInput).default([]),
    ownerOfRecordClaimId: z.string().optional(),
    summary: z.string().min(1),
    actor: z.string().min(1),
    now: z.string().min(1),
    correlationId: z.string().optional(),
  })
  .strict();
export type CommitResolvedSiteInput = z.infer<typeof CommitResolvedSiteInput>;

/**
 * Atomic commit: stage every mutation into a codec-round-tripped clone of the
 * base project (or a fresh project), integrity-validate the complete staged
 * result, then return the committed project. On any failure the original
 * project is untouched — the caller keeps its reference; nothing partial is
 * ever produced.
 */
export function commitResolvedSite(input: CommitResolvedSiteInput): Project {
  const parsed = CommitResolvedSiteInput.parse(input);

  // 1. Stage: clone the base project through the codec (deep clone + a first
  //    integrity check of the starting state).
  const staged: Project = parsed.baseProject
    ? ProjectCodec.decode(ProjectCodec.encode(parsed.baseProject as Project))
    : createProject({ projectId: parsed.projectId, propertyId: parsed.property.id, now: parsed.now });

  const ctx: CommandContext = {
    project: staged,
    actor: parsed.actor,
    correlationId: parsed.correlationId,
    now: () => parsed.now,
  };

  // 2. Apply the full mutation set to the staging copy only. Claims come in
  //    two waves: parcel-subject claims first (so parcels can ground in them),
  //    then the remainder — the property node is created before any claim whose
  //    subject is the property.
  for (const artifact of parsed.sourceArtifacts as StagedSourceArtifact[]) {
    addSourceArtifact(ctx, artifact);
  }
  const property = parsed.property;
  // Property first: claims may reference it as their subject.
  {
    if (staged.nodes[property.id]) {
      throw new Error(`commitResolvedSite: property id ${property.id} already exists`);
    }
    const propertyNode = {
      id: property.id,
      kind: "property" as const,
      displayName: property.displayName,
      parcelIds: property.parcelIds,
      primaryParcelId: property.primaryParcelId,
      address: property.addressText
        ? { text: property.addressText, note: "display-only; not project identity" as const }
        : undefined,
      ownerOfRecordClaimId: parsed.ownerOfRecordClaimId,
    };
    const propertyProblems = validatePropertyRules(propertyNode);
    if (propertyProblems.length > 0) throw new Error(propertyProblems.join("; "));
    applySiteEvent(ctx, "property.created", [property.id], `create property ${property.id} (${property.displayName})`, (now) => {
      staged.nodes[property.id] = nodeWithMeta(propertyNode, now);
    });
  }
  // Claims about parcels need parcel subjects to exist first for subject
  // validation; parcel grounding needs geometry claims. The commit plan
  // guarantees claims precede parcels in id references, so run claims first
  // with subjects relaxed? No — keep the strict rule: record claims whose
  // subjects already exist, create parcels, then re-run remaining claims.
  // Claims whose subject exists now are recorded first; claims about parcels
  // wait for their parcels. Parcel grounding edges attach after both exist —
  // the integrity gate at the end verifies every reference resolves.
  const deferred: StagedClaim[] = [];
  for (const claim of parsed.claims as StagedClaim[]) {
    if (staged.nodes[claim.subjectNodeId]) recordClaim(ctx, claim);
    else deferred.push(claim);
  }
  for (const parcel of parsed.parcels) {
    createParcelLoose(ctx, parcel);
  }
  for (const structure of parsed.structures) {
    createExistingStructureLoose(ctx, structure);
  }
  // Deferred claims (parcel/structure subjects) now resolve; a second wave
  // catches claims whose subjects still do not exist — a plan bug, not a
  // recoverable state, so it fails the whole atomic commit.
  const stillDeferred: StagedClaim[] = [];
  for (const claim of deferred) {
    if (staged.nodes[claim.subjectNodeId]) recordClaim(ctx, claim);
    else stillDeferred.push(claim);
  }
  if (stillDeferred.length > 0) {
    throw new Error(
      `commitResolvedSite: claims reference nonexistent subjects: ${stillDeferred.map((c) => c.id).join(", ")}`,
    );
  }
  for (const parcel of parsed.parcels) {
    for (const claimId of parcel.claimIds) {
      addEdge(staged, { dependentId: parcel.id, dependencyId: claimId, role: "grounded-in" });
    }
    if (parcel.geometry.sourceClaimId) {
      addEdge(staged, { dependentId: parcel.id, dependencyId: parcel.geometry.sourceClaimId, role: "grounded-in" });
    }
  }
  for (const structure of parsed.structures) {
    for (const claimId of structure.attributeClaimIds) {
      addEdge(staged, { dependentId: structure.id, dependencyId: claimId, role: "grounded-in" });
    }
    if (structure.footprint?.sourceClaimId) {
      addEdge(staged, { dependentId: structure.id, dependencyId: structure.footprint.sourceClaimId, role: "grounded-in" });
    }
  }
  // Link property -> parcels now that parcels exist.
  for (const parcelId of property.parcelIds) {
    addEdge(staged, { dependentId: property.id, dependencyId: parcelId, role: "comprises" });
  }
  for (const jurisdiction of parsed.jurisdictions) {
    createJurisdictionAssignment(ctx, jurisdiction);
  }

  applySiteEvent(ctx, "gis.site.resolved", Object.keys(staged.nodes), parsed.summary, () => {
    // validation-only step: every parcel the property references must exist
    for (const parcelId of parsed.property.parcelIds) {
      requireNode(staged, parcelId, "parcel");
    }
  });

  // 3. Whole-result integrity gate (schema + keys + hashes + edges + property).
  ProjectCodec.encode(staged);

  // 4. Commit: the staged project IS the new canonical state. Caller replaces
  //    its reference and saves through the repository with optimistic revision.
  return staged;
}
