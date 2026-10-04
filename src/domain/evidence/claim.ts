import { z } from "zod";
import { EvidenceState, OriginKind, ClaimPredicate } from "../enums";
import { Quantity, QuantityRange } from "../units/quantity";

/**
 * A Claim is an atomic assertion grounded in sources (or explicitly declared by
 * a user/modeler). Claims are evidence — they are NOT executable rules.
 *
 * Origin (where it came from) and evidenceState (how well it is supported) are
 * separate axes. A mission input has origin USER_DECLARED and no evidence-state
 * masquerade; a sourced claim has origin SOURCE_DERIVED and an evidence state.
 *
 * Cross-field rules (e.g. SOURCE_DERIVED claims must cite sources) are enforced
 * at the command boundary, not here, so this schema stays a plain object that
 * composes with node metadata.
 */

export const ClaimValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quantity"), quantity: Quantity }).strict(),
  z.object({ type: z.literal("range"), range: QuantityRange }).strict(),
  z.object({ type: z.literal("qualitative"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("null"),
      /** Why there is no value — never silently default unknowns. */
      reason: z.enum(["unknown", "formula-only", "not-captured"]),
    })
    .strict(),
]);
export type ClaimValue = z.infer<typeof ClaimValue>;

export const Origin = z
  .object({
    kind: OriginKind,
    actorId: z.string().optional(),
    declaredAt: z.string().optional(), // timestamp: never semantic
  })
  .strict();
export type Origin = z.infer<typeof Origin>;

export const ClaimSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("claim"),
    subjectNodeId: z.string().min(1),
    predicate: ClaimPredicate,
    value: ClaimValue,
    origin: Origin,
    /** Required for SOURCE_DERIVED claims; empty for declared ones. */
    sourceIds: z.array(z.string()),
    evidenceState: EvidenceState.optional(),
    verbatimQuote: z.string().optional(),
    effectiveInterval: z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .strict()
      .optional(),
    notes: z.string().optional(),
  })
  .strict();
export type ClaimSemantic = z.infer<typeof ClaimSemantic>;

/** Cross-field evidence/origin rules, enforced by `recordClaim`. */
export function validateClaimRules(claim: ClaimSemantic): string[] {
  const problems: string[] = [];
  if (claim.origin.kind === "SOURCE_DERIVED") {
    if (claim.sourceIds.length === 0) {
      problems.push("SOURCE_DERIVED claims must reference at least one source artifact");
    }
    if (!claim.evidenceState) {
      problems.push("SOURCE_DERIVED claims must carry an evidence state");
    }
  } else if (claim.sourceIds.length > 0) {
    problems.push("declared claims must not reference source artifacts");
  }
  if (claim.origin.kind !== "SOURCE_DERIVED" && claim.evidenceState) {
    problems.push("declared claims must not carry an evidence state (origin is not evidence)");
  }
  return problems;
}
