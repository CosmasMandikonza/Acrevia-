/**
 * Deterministic quantity normalization for the regulatory compiler (issue #5).
 *
 * Raw captured text ("16 ft.", "5' to 12' based on number of families",
 * "Intermediate 75%; Corner 80%") is normalized into typed value+unit pairs
 * by explicit, documented rules. Anything that does not match a rule is
 * rejected — the compiler never guesses a unit or repairs a malformed value.
 */

export type NormalizedQuantity = { value: number; unit: string };

const FEET = /(-?\d+(?:\.\d+)?)\s*(?:ft\.?|feet|')(?![\w])/i;
const SQFT_COMMA = /(-?[\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sf)\b/i;
const PERCENT = /(-?\d+(?:\.\d+)?)\s*%/;
const BARE_NUMBER = /^(-?\d+(?:\.\d+)?)$/;

/** Feet ("38 ft.", "9 ft", "5'"). Returns null when no feet quantity reads. */
export function normalizeFeet(raw: string): NormalizedQuantity | null {
  const match = raw.match(FEET);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: "ft" };
}

/** Square feet with thousands separators ("1,440 sq. ft."). */
export function normalizeSqFt(raw: string): NormalizedQuantity | null {
  const match = raw.match(SQFT_COMMA);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value, unit: "sq_ft" };
}

/** Percent ("75%"). */
export function normalizePercent(raw: string): NormalizedQuantity | null {
  const match = raw.match(PERCENT);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: "percent" };
}

/**
 * A recorded numeric attribute whose unit is known from the layer/registry
 * schema (square_ft, gross_area) — the capture already typed it; we only
 * validate finiteness/positivity, never re-derive or coerce.
 */
export function normalizeRecordedNumber(raw: string | number, unit: "sq_ft" | "spaces"): NormalizedQuantity | null {
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(value)) return null;
  return { value, unit };
}

/** Whole count ("0", "3"). */
export function normalizeCount(raw: string): NormalizedQuantity | null {
  const match = raw.trim().match(BARE_NUMBER);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value)) return null;
  return { value, unit: "spaces" };
}

/**
 * The minimum numeric bound of a ranged expression ("5' to 12' ..."), used
 * where a code expresses a range and the benchmark records the governing
 * minimum. Only the explicitly-typed minimum is read — no interpolation.
 */
export function minimumFeetBound(raw: string): NormalizedQuantity | null {
  return normalizeFeet(raw);
}
