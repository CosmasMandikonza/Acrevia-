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

/**
 * Executable-semantics validation (issue #6). Typed units alone do not make a
 * quantity meaningful as a mission constraint: a negative, zero, fractional, or
 * non-finite parking/stories/height value must never become an active rule.
 * Large-but-positive values REMAIN valid — without the #7 solver Acrevia
 * cannot prove physical infeasibility, so "impossible" is not ours to claim.
 */
export const MissionNormalizedChecked = MissionNormalized.superRefine((normalized, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  if (normalized.type === "min-parking") {
    if (!Number.isInteger(normalized.spaces.value) || normalized.spaces.value < 1) {
      reject("minimum parking must be a whole number of spaces, at least 1");
    }
  } else if (normalized.type === "max-stories") {
    if (!Number.isInteger(normalized.stories.value) || normalized.stories.value < 1) {
      reject("maximum stories must be a whole number, at least 1");
    }
  } else if (normalized.type === "max-height") {
    if (normalized.limit.value <= 0) {
      reject("maximum height must be greater than 0 ft");
    }
  }
});
export type MissionNormalizedChecked = z.infer<typeof MissionNormalizedChecked>;

export const MissionConstraintSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("mission-constraint"),
    intentText: z.string().min(1),
    normalized: MissionNormalizedChecked,
    origin: Origin,
    confirmationState: z.enum(["DRAFT", "CONFIRMED"]),
    hardOrSoft: z.enum(["hard", "soft"]),
  })
  .strict();
export type MissionConstraintSemantic = z.infer<typeof MissionConstraintSemantic>;

/**
 * The confirm-command input (issue #6 review): a MissionConstraint becomes
 * canonical ONLY through explicit confirmation. A DRAFT payload must never
 * pass the command boundary no matter who sends it — interpretation and
 * proposals are not project state until a human confirms.
 */
export const MissionConstraintConfirmation = MissionConstraintSemantic.extend({
  confirmationState: z.literal("CONFIRMED"),
}).strict();
export type MissionConstraintConfirmation = z.infer<typeof MissionConstraintConfirmation>;
