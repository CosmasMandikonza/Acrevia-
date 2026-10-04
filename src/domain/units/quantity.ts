import { z } from "zod";

/**
 * Minimal typed-unit system. No bare numbers for domain quantities, no
 * general-purpose units framework. Values that are not numeric truths stay
 * qualitative or explicitly null — never coerced.
 */

export const Unit = z.enum([
  "ft",
  "sq_ft",
  "percent",
  "spaces",
  "dwelling_units",
  "seats",
  "usd",
  "ratio",
  "sq_ft_per_unit",
  "stories",
]);
export type Unit = z.infer<typeof Unit>;

const finiteNumber = z.number().finite();

export const Quantity = z.object({
  value: finiteNumber,
  unit: Unit,
});
export type Quantity = z.infer<typeof Quantity>;

export const QuantityRange = z
  .object({
    min: finiteNumber.optional(),
    max: finiteNumber.optional(),
    unit: Unit,
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.min === undefined && range.max === undefined) {
      ctx.addIssue({ code: "custom", message: "a range needs at least one bound" });
    }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      ctx.addIssue({ code: "custom", message: "range min exceeds max" });
    }
  });
export type QuantityRange = z.infer<typeof QuantityRange>;

/**
 * Dimension-specific quantity schemas for the places where the domain knows
 * the dimension. Minimal by design: no generic units framework, just enough
 * typing to make "height = 38 USD" impossible.
 */
export const FeetQuantity = Quantity.extend({ unit: z.literal("ft") }).strict();
export type FeetQuantity = z.infer<typeof FeetQuantity>;
export const SqFtQuantity = Quantity.extend({ unit: z.literal("sq_ft") }).strict();
export type SqFtQuantity = z.infer<typeof SqFtQuantity>;
export const PercentQuantity = Quantity.extend({ unit: z.literal("percent") }).strict();
export type PercentQuantity = z.infer<typeof PercentQuantity>;
export const SpacesQuantity = Quantity.extend({ unit: z.literal("spaces") }).strict();
export type SpacesQuantity = z.infer<typeof SpacesQuantity>;
export const StoriesQuantity = Quantity.extend({ unit: z.literal("stories") }).strict();
export type StoriesQuantity = z.infer<typeof StoriesQuantity>;
export const DwellingUnitsQuantity = Quantity.extend({ unit: z.literal("dwelling_units") }).strict();
export type DwellingUnitsQuantity = z.infer<typeof DwellingUnitsQuantity>;

export function quantity(value: number, unit: Unit): Quantity {
  return Quantity.parse({ value, unit });
}

/** Explicit, rounding-explicit conversions. No silent coercion anywhere. */
export function sqFtToAcres(sqFt: number): number {
  return sqFt / 43_560;
}

export function m2ToSqFt(m2: number): number {
  return m2 * 10.7639;
}
