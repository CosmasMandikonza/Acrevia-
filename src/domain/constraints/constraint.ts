import { z } from "zod";
import { Quantity, QuantityRange } from "../units/quantity";

/**
 * The executable computational restriction layer. A discriminated union — never
 * a free-form blob. Every constraint materializes from exactly one regulation
 * (edge role "materializes"), so it traces to claims and sources.
 *
 * UNKNOWN dimensions produce NO constraint here (e.g. Philadelphia FAR).
 * Contextual/formula rules stay declarative: the solver (#7) evaluates them
 * against geometry/use inputs later; nothing is pre-coerced into a number.
 *
 * Variants are exported individually so the project schema can compose each
 * with node metadata (discriminated unions do not compose via .extend).
 */

const base = {
  id: z.string().min(1),
  kind: z.literal("constraint"),
  regulationId: z.string().min(1),
  notes: z.string().optional(),
};

export const usePermissionVariant = z
  .object({
    ...base,
    constraintKind: z.literal("use-permission"),
    use: z.string(),
    permission: z.enum(["BY_RIGHT", "SPECIAL_EXCEPTION", "PROHIBITED"]),
  })
  .strict();

export const heightVariant = z
  .object({
    ...base,
    constraintKind: z.literal("height"),
    limit: Quantity,
    appliesTo: z.string().default("principal-structure"),
  })
  .strict();

export const setbackVariant = z
  .object({
    ...base,
    constraintKind: z.literal("setback"),
    face: z.enum(["front", "side", "rear"]),
    spec: z.discriminatedUnion("type", [
      z.object({ type: z.literal("numeric"), min: Quantity }).strict(),
      z.object({ type: z.literal("range"), range: QuantityRange }).strict(),
      z
        .object({
          type: z.literal("contextual"),
          ruleId: z.string(),
          description: z.string().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const occupiedAreaVariant = z
  .object({
    ...base,
    constraintKind: z.literal("occupied-area"),
    byLotType: z
      .object({
        intermediate: z.number().finite().optional(),
        corner: z.number().finite().optional(),
      })
      .strict(),
    unit: z.literal("percent"),
  })
  .strict();

export const densityVariant = z
  .object({
    ...base,
    constraintKind: z.literal("density"),
    spec: z
      .object({
        type: z.literal("tiered-min-lot-area-per-unit"),
        tiers: z
          .array(
            z
              .object({
                firstSqFt: z.number().finite(),
                perUnit: z.number().finite(),
              })
              .strict(),
          )
          .min(1),
        rounding: z.enum(["down"]),
      })
      .strict(),
  })
  .strict();

export const parkingRequirementVariant = z
  .object({
    ...base,
    constraintKind: z.literal("parking-requirement"),
    use: z.string(),
    requirement: z.discriminatedUnion("type", [
      z.object({ type: z.literal("fixed"), spaces: Quantity }).strict(),
      z
        .object({
          type: z.literal("formula"),
          formulaId: z.string(),
          text: z.string(),
        })
        .strict(),
    ]),
  })
  .strict();

export const overlayProhibitionVariant = z
  .object({
    ...base,
    constraintKind: z.literal("overlay-prohibition"),
    overlay: z.string(),
    prohibits: z.string(),
  })
  .strict();

export const densityBonusVariant = z
  .object({
    ...base,
    constraintKind: z.literal("density-bonus"),
    percentIncreaseByTier: z.record(z.string(), z.number().finite()),
    geographicRestriction: z.enum(["none", "unknown"]),
    statuteRef: z.string().optional(),
  })
  .strict();

export const constraintVariants = [
  usePermissionVariant,
  heightVariant,
  setbackVariant,
  occupiedAreaVariant,
  densityVariant,
  parkingRequirementVariant,
  overlayProhibitionVariant,
  densityBonusVariant,
] as const;

export const ConstraintSemantic = z.discriminatedUnion("constraintKind", [
  usePermissionVariant,
  heightVariant,
  setbackVariant,
  occupiedAreaVariant,
  densityVariant,
  parkingRequirementVariant,
  overlayProhibitionVariant,
  densityBonusVariant,
]);
export type ConstraintSemantic = z.infer<typeof ConstraintSemantic>;
