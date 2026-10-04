import { z } from "zod";
import { ClaimValue, Origin } from "../evidence/claim";

/**
 * Assumption — an explicit modeling input that cannot currently be claimed as
 * fact (target unit mix, average unit size, cost basis, unknown parking-stall
 * baseline). Origin is MODELER_DECLARED, enforced at the command boundary.
 * Assumptions are first-class nodes so scenarios can pin them and certificates
 * can freeze them.
 */

export const AssumptionSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("assumption"),
    statement: z.string().min(1),
    value: ClaimValue,
    rationale: z.string().min(1),
    origin: Origin,
    active: z.boolean(),
    reviewTrigger: z.string().optional(),
  })
  .strict();
export type AssumptionSemantic = z.infer<typeof AssumptionSemantic>;
