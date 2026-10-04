import { z } from "zod";

/**
 * Event-sourcing-LITE. Materialized project state remains primary; every
 * consequential mutation appends an audit event. Events are NOT the only way to
 * reconstruct state, and the event log is excluded from node semantic hashes.
 */

export const ProjectEventSchema = z
  .object({
    eventId: z.string().min(1),
    actor: z.string().min(1),
    eventType: z.string().min(1),
    occurredAt: z.string(), // timestamp: never semantic
    affectedNodeIds: z.array(z.string()),
    priorProjectRevision: z.number().int().nonnegative(),
    nextProjectRevision: z.number().int().nonnegative(),
    commandSummary: z.string(),
    /** Ties multiple node changes from one user action together. */
    correlationId: z.string().optional(),
  })
  .strict();
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;

export const ProjectEventType = z.enum([
  "project.created",
  "benchmark.imported",
  "source.artifact.added",
  "source.artifact.superseded",
  "claim.recorded",
  "regulation.upserted",
  "constraint.materialized",
  "mission.constraint.confirmed",
  "assumption.set",
  "scenario.recorded",
  "expert-review.opened",
  "expert-review.updated",
  "stakeholder-view.updated",
  // GIS typed-commit events (issue #4)
  "property.created",
  "parcel.created",
  "structure.created",
  "jurisdiction.created",
  "gis.site.resolved",
]);
export type ProjectEventType = z.infer<typeof ProjectEventType>;
