import { z } from "zod";
import { AuthorityLevel } from "../../domain/enums";
import { CandidateRule } from "./candidate-rule";

/**
 * The extraction boundary (issue #5).
 *
 * Extraction proposes; verification decides; the graph records; the solver
 * gate filters. An extraction adapter turns RAW CAPTURED EVIDENCE plus
 * source-manifest metadata into CandidateRule proposals. It is never the
 * source of truth, and its output never touches project.nodes directly.
 *
 * rules.expected.json is an ORACLE used only by tests — never an input here.
 * The deterministic benchmark adapter reads the actual captures under
 * docs/benchmarks/.../raw/. A model-backed extractor (Gloo/#10) can later
 * implement this exact interface and produce the same CandidateRule contract;
 * the verification, conflict, and compilation stages stay deterministic and
 * provider-independent either way.
 */

export const RawEvidenceDocument = z
  .object({
    documentId: z.string().min(1),
    sourceRef: z.string().min(1),
    kind: z.enum(["code-text", "gis-json"]),
    /** Markdown/text capture content (code-text documents). */
    text: z.string().optional(),
    /** Parsed JSON capture (gis-json documents). */
    json: z.unknown().optional(),
  })
  .strict();
export type RawEvidenceDocument = z.infer<typeof RawEvidenceDocument>;

/** Exact AuthorityLevel -> SourceArtifact.sourceType mapping. */
export const SOURCE_TYPE_FOR_AUTHORITY: Record<AuthorityLevel, string> = {
  ADOPTED_CODE: "adopted_code",
  OFFICIAL_GIS: "official_gis",
  OFFICIAL_CITY_TOOL: "official_city_tool",
  OFFICIAL_CITY_REFERENCE: "official_city_reference",
  PROPERTY_SELF_REPORTED: "property_self_reported",
  SECONDARY: "secondary",
};

export const SourceMetadata = z
  .object({
    sourceRef: z.string().min(1),
    /** Graph id of the artifact this source's captured bytes become. */
    sourceArtifactId: z.string().min(1),
    logicalSourceKey: z.string().min(1),
    version: z.number().int().min(1),
    sourceType: z.string().min(1),
    title: z.string().min(1),
    publisher: z.string().min(1),
    canonicalUrl: z.string().min(1),
    authority: AuthorityLevel,
    retrievedAt: z.string().min(1),
    effectiveDate: z.string().optional(),
    /** SHA-256 over the source's captured bytes (files combined
     *  deterministically). This IS the evidence — never fabricated. */
    rawContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** The capture files this source's hash covers, sorted. */
    rawEvidenceRefs: z.array(z.string().min(1)),
  })
  .strict();
export type SourceMetadata = z.infer<typeof SourceMetadata>;

export const RegulatoryExtractionInput = z
  .object({
    documents: z.array(RawEvidenceDocument),
    sources: z.array(SourceMetadata),
    subject: z
      .object({
        subjectNodeId: z.string().min(1),
        jurisdictionKey: z.string().min(1),
        district: z.string().optional(),
        lotType: z.enum(["intermediate", "corner", "undetermined"]).optional(),
      })
      .strict(),
  })
  .strict();
export type RegulatoryExtractionInput = z.infer<typeof RegulatoryExtractionInput>;

export const RegulatoryExtractionResult = z
  .object({
    candidates: z.array(CandidateRule),
    /** Non-fatal extraction observations (e.g. evidence gaps). */
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type RegulatoryExtractionResult = z.infer<typeof RegulatoryExtractionResult>;

export interface RegulatoryExtractionAdapter {
  extract(input: RegulatoryExtractionInput): Promise<RegulatoryExtractionResult>;
}
