import { z } from "zod";

/**
 * StakeholderView — derived presentation configuration ONLY. It references a
 * scenario; it never copies feasibility metrics as truth. Views may rephrase
 * facts; they may not create new truth. Nothing in the computation layer
 * depends on a view, so editing a view cannot stale a certificate.
 */

export const StakeholderViewSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("stakeholder-view"),
    audience: z.enum(["board", "council", "neighbor", "pastoral", "professional"]),
    title: z.string().min(1),
    selectedScenarioId: z.string().optional(),
    narrativeNotes: z.string().optional(),
    visibleEvidenceDepth: z.enum(["summary", "standard", "full"]).default("standard"),
  })
  .strict();
export type StakeholderViewSemantic = z.infer<typeof StakeholderViewSemantic>;
