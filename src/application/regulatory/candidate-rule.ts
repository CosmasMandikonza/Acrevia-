import { z } from "zod";
import { AuthorityLevel, ClaimPredicate } from "../../domain/enums";
import { Unit } from "../../domain/units/quantity";

/**
 * CandidateRule — the regulatory compiler's proposed interpretation of one
 * captured piece of evidence (issue #5).
 *
 * A candidate is NOT canonical graph truth: nothing in this shape writes to
 * project.nodes. Candidates flow through deterministic verification and
 * conflict analysis; only then does the compiler record Claim → Regulation →
 * Constraint through the typed command boundary.
 *
 * A candidate carries everything an independent checker needs to re-verify
 * it without trusting the extractor: exact source identity, the verbatim
 * supporting text, the locator, retrieval/effective metadata, the normalized
 * value with its unit, applicability, and how the value was extracted.
 */

export const CandidateValue = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("quantity"),
      value: z.number().finite(),
      unit: Unit,
    })
    .strict(),
  z.object({ kind: z.literal("qualitative"), text: z.string().min(1) }).strict(),
  /** Deliberate abstention: the evidence establishes no value (e.g. FAR).
   *  NEVER coerced to 0 or "not applicable" — that would fabricate law. */
  z.object({ kind: z.literal("unknown") }).strict(),
]);
export type CandidateValue = z.infer<typeof CandidateValue>;

export const CandidateApplicability = z
  .object({
    district: z.string().optional(),
    use: z.string().optional(),
    overlay: z.string().optional(),
    lotType: z.enum(["intermediate", "corner", "undetermined"]).optional(),
  })
  .strict();
export type CandidateApplicability = z.infer<typeof CandidateApplicability>;

export const CandidateRule = z
  .object({
    /** UNIQUE EVIDENCE OBSERVATION id (semanticRuleKey + source). */
    candidateId: z.string().min(1),
    /**
     * The SEMANTIC LEGAL RULE this candidate observes — e.g.
     * `height:max:principal`, `use:multi-family:permission`,
     * `overlay:/six:adu-prohibition`. Different legal propositions must
     * never share a key; the regulation/constraint identity derives from it.
     */
    semanticRuleKey: z.string().min(1),
    /** Graph id of the source artifact this candidate was extracted from. */
    sourceArtifactId: z.string().min(1),
    /** Manifest source reference (e.g. "S5") for human-facing provenance. */
    sourceRef: z.string().min(1),
    subjectNodeId: z.string().min(1),
    jurisdictionKey: z.string().min(1),
    predicate: ClaimPredicate,
    proposedValue: CandidateValue,
    applicability: CandidateApplicability,
    /** Locator into the source (section/table/layer). Required for a rule to
     *  become executable; absent locators are rejected by verification. */
    codeSection: z.string().optional(),
    verbatimSupportingText: z.string().min(1),
    authority: AuthorityLevel,
    retrievedAt: z.string().min(1),
    effectiveDate: z.string().optional(),
    /** How the value was read — deterministic method description. */
    extractionMethod: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();
export type CandidateRule = z.infer<typeof CandidateRule>;
