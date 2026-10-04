import { z } from "zod";
import { AuthorityLevel } from "../enums";

/**
 * A SourceArtifact is one CAPTURED VERSION of a logical source.
 *
 *   logical source:   "The Philadelphia Code § 14-802"
 *   captured version: retrieved 2026-10-04, rawContentHash abc…
 *
 * Historical captured content and rawContentHash are immutable. A later,
 * materially different capture is a NEW SourceArtifact (next version id), never
 * an overwrite. `supersededBy` is lifecycle metadata and IS part of the semantic
 * view, so a supersession changes the artifact's semanticHash and staleness
 * propagates through certificate dependency closures.
 *
 * Version identity: `{logicalSourceKey}@v{version}` (optionally raw-hash
 * suffixed by the importer when multiple captures share a version).
 */

export const SourceType = z.enum([
  "adopted_code",
  "official_gis",
  "official_city_tool",
  "official_city_reference",
  "property_self_reported",
  "secondary",
]);
export type SourceType = z.infer<typeof SourceType>;

export const SourceArtifactSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("source-artifact"),
    logicalSourceKey: z.string().min(1),
    version: z.number().int().positive(),
    sourceType: SourceType,
    title: z.string().min(1),
    publisher: z.string().min(1),
    /** Plain string: official API URLs legitimately contain unencoded spaces
     *  in query strings, which strict URL validation would reject. */
    canonicalUrl: z.string().min(1),
    authority: AuthorityLevel,
    retrievedAt: z.string(), // ISO-8601 UTC — timestamps are never semantic (see graph/node.ts)
    effectiveDate: z.string().optional(),
    versionNote: z.string().optional(),
    /** SHA-256 of captured source bytes / normalized text. Immutable. */
    rawContentHash: z.string().optional(),
    /** Pointer to the cached evidence file, when one exists. */
    rawEvidenceRef: z.string().optional(),
    /** Lifecycle metadata; part of the semantic view on purpose. */
    supersededBy: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
// A re-capture of identical content is a semantically identical source version;
// distinguishing captures is version + rawContentHash identity, not retrievedAt.

export type SourceArtifactSemantic = z.infer<typeof SourceArtifactSemantic>;
