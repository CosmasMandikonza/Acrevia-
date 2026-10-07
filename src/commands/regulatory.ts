import { z } from "zod";
import { touchNode, stripVolatile } from "../domain/graph/node";
import { ConstraintSemantic } from "../domain/constraints/constraint";
import { canonicalJson } from "../domain/graph/serialization";
import { refreshStaleness } from "../domain/graph/traversal";
import { ProjectEvent } from "../domain/events/project-event";
import type { CommandContext } from "./index";

/**
 * Typed regulatory-constraint replacement (PR #28 third review).
 *
 * When later, current evidence resolves the SAME semantic rule to a different
 * executable value (55 ft -> 45 ft), the executable constraint itself must
 * change — the solver gate must never serve stale law. This is a DEDICATED
 * typed command, not a generic JSON edit:
 *
 *   - node must exist and actually be a constraint;
 *   - regulationId must match (semantic identity is fixed per rule);
 *   - constraint kind must match, or the id is being reused for an
 *     impossible semantic identity -> rejected;
 *   - the full replacement payload passes ConstraintSemantic validation;
 *   - exact semantic replay is a no-op;
 *   - a real change is an audited typed update: payload replaced, node
 *     touched (semantic hash changes), event recorded, staleness refreshed —
 *     certificates pinning the old semantic hash go STALE.
 */

export const ReplaceExecutableConstraintInput = ConstraintSemantic;

export function replaceExecutableConstraint(
  ctx: CommandContext,
  input: z.infer<typeof ReplaceExecutableConstraintInput>,
): "no-op" | "updated" {
  const parsed = ReplaceExecutableConstraintInput.parse(input);
  const existing = ctx.project.nodes[parsed.id];
  if (!existing) {
    throw new Error(`replaceExecutableConstraint: node ${parsed.id} does not exist`);
  }
  if (existing.kind !== "constraint") {
    throw new Error(
      `replaceExecutableConstraint: node ${parsed.id} is a ${existing.kind}, not a constraint`,
    );
  }
  if (existing.regulationId !== parsed.regulationId) {
    throw new Error(
      `replaceExecutableConstraint: regulation id mismatch (${existing.regulationId} -> ${parsed.regulationId}); a constraint's semantic rule cannot move between regulations`,
    );
  }
  if (existing.constraintKind !== parsed.constraintKind) {
    throw new Error(
      `replaceExecutableConstraint: constraint kind mismatch (${existing.constraintKind} -> ${parsed.constraintKind}); semantic identity cannot be reused across rule types`,
    );
  }

  // Exact semantic replay: no-op (no revision/event movement).
  if (canonicalJson(stripVolatile(existing)) === canonicalJson(stripVolatile(parsed))) {
    return "no-op";
  }

  const now = ctx.now?.() ?? new Date().toISOString();
  const priorRevision = ctx.project.revision;
  Object.assign(existing, parsed);
  touchNode(existing, now);
  const nextRevision = priorRevision + 1;
  ctx.project.revision = nextRevision;
  ctx.project.updatedAt = now;
  const event: ProjectEvent = {
    eventId: `evt-${nextRevision}`,
    actor: ctx.actor,
    eventType: "constraint.replaced",
    occurredAt: now,
    affectedNodeIds: [parsed.id],
    priorProjectRevision: priorRevision,
    nextProjectRevision: nextRevision,
    commandSummary: `replace executable constraint ${parsed.id} (${parsed.constraintKind}) with newly resolved law`,
    correlationId: ctx.correlationId,
  };
  ctx.project.events.push(event);
  refreshStaleness(ctx.project);
  return "updated";
}
