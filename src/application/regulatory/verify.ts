import type { CandidateRule } from "./candidate-rule";
import type { SourceMetadata } from "./extraction";

/**
 * Deterministic candidate verification (issue #5) — the compiler's second
 * pass. Verification decides; extraction only proposes.
 *
 * These are compiler-internal decisions (ACCEPT / REJECT), deliberately NOT
 * EvidenceState values: EvidenceState belongs to claims in the graph.
 * A rejected candidate never reaches the graph at all.
 */

export const REGULATORY_PREDICATES = new Set<string>([
  "use-permission",
  "max-height",
  "setback-front",
  "setback-side",
  "setback-rear",
  "lot-width",
  "lot-area",
  "occupied-area",
  "density-formula",
  "far",
  "parking-requirement",
  "overlay-restriction",
  "density-bonus",
]);

export type VerificationDecision = {
  candidate: CandidateRule;
  status: "ACCEPT" | "REJECT";
  reasons: string[];
};

/** Positivity requirements by predicate: 0 parking spaces is VALID law;
 *  a 0 ft height or negative anything never is. */
function quantityProblems(candidate: CandidateRule): string[] {
  const value = candidate.proposedValue;
  if (value.kind !== "quantity") return [];
  const problems: string[] = [];
  const { value: quantity, unit } = value;
  if (!Number.isFinite(quantity)) {
    problems.push("value is not a finite number");
    return problems;
  }
  switch (candidate.predicate) {
    case "max-height":
    case "lot-width":
    case "lot-area":
      if (quantity <= 0) problems.push(`${candidate.predicate} must be greater than 0 ${unit}`);
      break;
    case "setback-side":
    case "setback-rear":
      if (quantity < 0) problems.push(`${candidate.predicate} cannot be negative`);
      break;
    case "occupied-area":
    case "density-bonus":
      if (quantity <= 0 || quantity > 100) {
        problems.push(`${candidate.predicate} must be a percent between 0 and 100`);
      }
      break;
    case "parking-requirement":
      if (quantity < 0 || !Number.isInteger(quantity)) {
        problems.push("parking requirement must be a whole number of spaces, at least 0");
      }
      break;
    case "parcel-area":
    case "building-footprint-area":
      if (quantity <= 0) problems.push(`${candidate.predicate} must be greater than 0`);
      break;
    default:
      break;
  }
  return problems;
}

export function verifyCandidates(input: {
  candidates: CandidateRule[];
  sources: SourceMetadata[];
  subject: { district?: string };
}): VerificationDecision[] {
  const knownSources = new Set(input.sources.map((source) => source.sourceRef));
  return input.candidates.map((candidate) => {
    const reasons: string[] = [];

    if (!knownSources.has(candidate.sourceRef)) {
      reasons.push(
        `citation does not resolve to a captured source: sourceRef ${candidate.sourceRef} is not in the source manifest`,
      );
    }
    if (!candidate.verbatimSupportingText.trim()) {
      reasons.push("no verbatim supporting text captured for the proposed value");
    }
    if (REGULATORY_PREDICATES.has(candidate.predicate) && !candidate.codeSection?.trim()) {
      reasons.push("no code section / source locator for a regulatory rule");
    }
    if (REGULATORY_PREDICATES.has(candidate.predicate)) {
      const district = candidate.applicability.district;
      if (input.subject.district && district && district !== input.subject.district) {
        reasons.push(
          `rule applies to district ${district}, not the subject district ${input.subject.district}`,
        );
      }
    }
    reasons.push(...quantityProblems(candidate));

    return { candidate, status: reasons.length === 0 ? "ACCEPT" : "REJECT", reasons };
  });
}
