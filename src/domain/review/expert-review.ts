import { z } from "zod";
import { ReviewState } from "../enums";

/**
 * ExpertReviewItem — the honest boundary of what Acrevia cannot resolve.
 * Unknown information stays unknown; professional-judgment questions are
 * surfaced, never silently answered.
 */

export const ExpertReviewSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("expert-review"),
    question: z.string().min(1),
    whyItMatters: z.string().min(1),
    category: z.string().min(1),
    affectedNodeIds: z.array(z.string()).default([]),
    evidenceRefs: z.array(z.string()).default([]),
    severity: z.enum(["blocking", "non-blocking"]),
    reviewStatus: ReviewState,
    resolution: z
      .object({
        resolvedAt: z.string(),
        resolvedBy: z.string(),
        note: z.string().min(1),
        sourceId: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ExpertReviewSemantic = z.infer<typeof ExpertReviewSemantic>;
