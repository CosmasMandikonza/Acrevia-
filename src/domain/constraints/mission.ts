import { z } from "zod";
import { FeetQuantity, SpacesQuantity, StoriesQuantity } from "../units/quantity";
import { Origin } from "../evidence/claim";

/**
 * MissionConstraint — a user-declared intention normalized into an executable
 * representation. Origin is USER_DECLARED; there is NO evidence state here.
 * Mission inputs are never mislabeled as external facts. The USER_DECLARED rule
 * is enforced by `confirmMissionConstraint` at the command boundary.
 */

export const MissionNormalized = z.discriminatedUnion("type", [
  z.object({ type: z.literal("min-parking"), spaces: SpacesQuantity }).strict(),
  z.object({ type: z.literal("preserve-structure"), structureId: z.string() }).strict(),
  z.object({ type: z.literal("max-stories"), stories: StoriesQuantity }).strict(),
  z.object({ type: z.literal("retain-ownership") }).strict(),
  z.object({ type: z.literal("max-height"), limit: FeetQuantity }).strict(),
]);
export type MissionNormalized = z.infer<typeof MissionNormalized>;

export const MissionConstraintSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("mission-constraint"),
    intentText: z.string().min(1),
    normalized: MissionNormalized,
    origin: Origin,
    confirmationState: z.enum(["DRAFT", "CONFIRMED"]),
    hardOrSoft: z.enum(["hard", "soft"]),
  })
  .strict();
export type MissionConstraintSemantic = z.infer<typeof MissionConstraintSemantic>;
