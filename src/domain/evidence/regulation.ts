import { z } from "zod";
import { RegulationCurrentness } from "../enums";

/**
 * A Regulation is Acrevia's INTERPRETED regulatory meaning of one or more
 * claims. A source claim is not automatically executable; the regulation is the
 * interpretation layer, and constraints materialize from it.
 */

export const RegulationSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("regulation"),
    jurisdictionKey: z.string().min(1),
    codeSection: z.string().min(1),
    applicability: z
      .object({
        district: z.string().optional(),
        use: z.string().optional(),
        overlay: z.string().optional(),
        lotType: z.enum(["intermediate", "corner", "undetermined"]).optional(),
      })
      .strict(),
    claimIds: z.array(z.string()).min(1),
    /** Currency of the underlying sources, as best known. */
    currentness: RegulationCurrentness,
    conflictRefs: z.array(z.string()),
    supersedes: z.string().optional(),
    supersededBy: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type RegulationSemantic = z.infer<typeof RegulationSemantic>;
