import { z } from "zod";
import { createSha256 } from "./hashing";
import { canonicalJson } from "./serialization";
import { NodeKind } from "../enums";

/**
 * Every material node is { id, kind, ...semanticFields, meta }.
 *
 * `meta` carries volatile bookkeeping and is EXCLUDED from the semantic hash:
 *   revision        — per-node mutation counter (audit/concurrency)
 *   semanticHash    — SHA-256 of the node's canonical semantic view
 *   createdAt       — ISO-8601 UTC
 *   lastModifiedAt  — ISO-8601 UTC
 *
 * TIMESTAMPS AND DERIVED STATE ARE NEVER SEMANTIC. In addition to `meta`,
 * the following key names are stripped at any depth before hashing, by
 * convention enforced here and by tests:
 *   retrievedAt, generatedAt, declaredAt, occurredAt, createdAt, updatedAt,
 *   lastModifiedAt, freshness (certificate freshness is derived cache state)
 *
 * Consequence: changing only a capture/declaration timestamp never changes a
 * node's semanticHash. Node identity and drift are decided by semantic content
 * plus version/raw hashes — never by when something happened to be fetched.
 *
 * semanticHash answers: "has this Acrevia domain object changed?"
 * It is distinct from a SourceArtifact's rawContentHash, which answers
 * "did the captured external source content change?".
 */

export const NodeMetaSchema = z.object({
  revision: z.number().int().nonnegative(),
  semanticHash: z.string(),
  createdAt: z.string(),
  lastModifiedAt: z.string(),
});
export type NodeMeta = z.infer<typeof NodeMetaSchema>;

const VOLATILE_KEYS = new Set([
  "meta",
  "retrievedAt",
  "generatedAt",
  "declaredAt",
  "occurredAt",
  "createdAt",
  "updatedAt",
  "lastModifiedAt",
  "freshness",
]);

export type SemanticNodeFields = Record<string, unknown> & {
  id: string;
  kind: z.infer<typeof NodeKind>;
};

export function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = stripVolatile(child);
    }
    return out;
  }
  return value;
}

export function semanticView<Semantic extends SemanticNodeFields>(
  node: Semantic & { meta: NodeMeta },
): unknown {
  return stripVolatile(node);
}

export function computeSemanticHash<Semantic extends SemanticNodeFields>(
  node: Semantic & { meta: NodeMeta },
): string {
  return createSha256(canonicalJson(semanticView(node)));
}

export function nodeWithMeta<Semantic extends SemanticNodeFields>(
  semantic: Semantic,
  now: string,
): Semantic & { meta: NodeMeta } {
  const base: Semantic & { meta: NodeMeta } = {
    ...semantic,
    meta: {
      revision: 1,
      semanticHash: "pending",
      createdAt: now,
      lastModifiedAt: now,
    },
  };
  base.meta.semanticHash = computeSemanticHash(base);
  return base;
}

/** Recompute hash + bump revision after a semantic mutation. */
export function touchNode<Semantic extends SemanticNodeFields>(
  node: Semantic & { meta: NodeMeta },
  now: string,
): void {
  node.meta.revision += 1;
  node.meta.lastModifiedAt = now;
  node.meta.semanticHash = computeSemanticHash(node);
}

/**
 * Canonical semantic JSON for an entire project: identical for projects whose
 * semantic content is identical, regardless of when nodes were created or
 * mutated. Use for comparisons and future Watch diffing; ProjectCodec remains
 * the lossless persistence representation.
 */
export function canonicalSemanticJson(project: unknown): string {
  return canonicalJson(stripVolatile(project));
}
