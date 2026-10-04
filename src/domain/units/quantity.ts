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
]);
export type Unit = z.infer<typeof Unit>;

const finiteNumber = z.number().finite();

export const Quantity = z.object({
  value: finiteNumber,
  unit: Unit,
});
export type Quantity = z.infer<typeof Quantity>;

export const QuantityRange = z.object({
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  unit: Unit,
});
export type QuantityRange = z.infer<typeof QuantityRange>;

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
