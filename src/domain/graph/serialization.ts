/**
 * Canonical JSON serialization.
 *
 * Deterministic by construction:
 * - object keys are recursively sorted
 * - arrays preserve order (order is semantic)
 * - `undefined` fields are omitted
 * - NaN/Infinity are rejected (non-finite numbers are a domain error)
 * - dates never appear: timestamps are ISO-8601 strings supplied by callers
 *
 * The same semantic content must always serialize to the same bytes.
 */

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return jsonString(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "object":
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value as Record<string, unknown>);
    default:
      throw new Error(`canonicalJson: unsupported value type '${typeof value}'`);
  }
}

function serializeObject(record: Record<string, unknown>): string {
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const parts = keys.map((key) => `${jsonString(key)}:${serialize(record[key])}`);
  return `{${parts.join(",")}}`;
}

function serializeArray(values: unknown[]): string {
  return `[${values.map((value) => serialize(value)).join(",")}]`;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`canonicalJson: non-finite number ${value}`);
  }
  // Preserve integer literals exactly; keep JSON's default decimal rendering
  // otherwise. Domain decimals (0.9, 1.5, 0.004) serialize stably.
  return JSON.stringify(value);
}

// JSON string escaping per spec; JSON.stringify is deterministic for strings.
function jsonString(value: string): string {
  return JSON.stringify(value);
}
