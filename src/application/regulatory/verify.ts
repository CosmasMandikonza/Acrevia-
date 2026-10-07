import type { CandidateRule } from "./candidate-rule";
import type { RawEvidenceDocument, SourceMetadata } from "./extraction";
import { normalizeFeet, normalizePercent, normalizeSqFt } from "./normalize";

/**
 * Deterministic candidate verification (issue #5) — the compiler's second
 * pass. Verification decides; extraction only proposes. The verifier NEVER
 * trusts extractor-supplied authority, dates, or quotes: every candidate is
 * independently BOUND to the captured evidence.
 *
 * Cross-checks against the source manifest:
 *   - sourceRef resolves; candidate.sourceArtifactId === source.sourceArtifactId
 *   - candidate.authority === source.authority   (spoofed authority → REJECT)
 *   - candidate.retrievedAt === source.retrievedAt (invented dates → REJECT)
 *
 * Cross-checks against the raw capture:
 *   - evidenceAnchor.documentId resolves to a captured document
 *   - that document's sourceRef matches the candidate's
 *   - evidenceAnchor.exactText EXISTS in the captured bytes (invented
 *     quotes → REJECT)
 *   - for deterministically-readable predicates, the proposed value must
 *     agree with a number INDEPENDENTLY parsed from the anchor text
 *     (anchor says 38 ft, proposal says 55 ft → REJECT)
 *
 * These are compiler-internal decisions (ACCEPT / REJECT), deliberately NOT
 * EvidenceState values: EvidenceState belongs to claims in the graph.
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

/** Predicates whose quantity the verifier can independently re-derive from
 *  the anchor text with the shared normalizers. */
/** Quantities read from table cells / formulas where a bare-number parse
 *  cannot apply: the proposed value must appear as a distinct numeric token
 *  in the anchor text. */
function tokenValue(expected: number): (text: string) => number | null {
  return (text: string) =>
    new RegExp(`(^|[^0-9.])${expected}(?![0-9.])`).test(text) ? expected : null;
}

const INDEPENDENTLY_VERIFIABLE: Record<string, (text: string, proposed: number) => number | null> = {
  "max-height": (t) => normalizeFeet(t)?.value ?? null,
  "lot-width": (t) => normalizeFeet(t)?.value ?? null,
  "setback-side": (t) => normalizeFeet(t)?.value ?? null,
  "setback-rear": (t) => normalizeFeet(t)?.value ?? null,
  "lot-area": (t) => normalizeSqFt(t)?.value ?? null,
  "density-bonus": (t) => normalizePercent(t)?.value ?? null,
  "parking-requirement": (t, proposed) => tokenValue(proposed)(t),
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

/** The captured text, normalized the way document readers see it. */
function anchorExistsIn(document: RawEvidenceDocument, exactText: string): boolean {
  const haystack =
    document.kind === "code-text"
      ? document.text ?? ""
      : JSON.stringify(document.json ?? "");
  // Anchor text is captured verbatim; compare against the normalized
  // whitespace of the capture so formatting drift cannot spoof or break it.
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  return collapse(haystack).includes(collapse(exactText));
}

export function verifyCandidates(input: {
  candidates: CandidateRule[];
  sources: SourceMetadata[];
  subject: { district?: string };
  documents?: RawEvidenceDocument[];
}): VerificationDecision[] {
  // Source binding prefers the CAPTURED VERSION (sourceArtifactId) so same-
  // logical-source versions (S5@v1, S5@v2) resolve to their own metadata;
  // sourceRef remains the human-facing fallback.
  const sourceByArtifact = new Map(input.sources.map((source) => [source.sourceArtifactId, source]));
  const sourceByRef = new Map(input.sources.map((source) => [source.sourceRef, source]));
  const documentById = new Map((input.documents ?? []).map((doc) => [doc.documentId, doc]));

  return input.candidates.map((candidate) => {
    const reasons: string[] = [];
    const source = sourceByArtifact.get(candidate.sourceArtifactId) ?? sourceByRef.get(candidate.sourceRef);

    // --- Independent binding to the captured source metadata ---
    if (!source) {
      reasons.push(
        `citation does not resolve to a captured source: sourceRef ${candidate.sourceRef} is not in the source manifest`,
      );
    } else {
      if (candidate.sourceArtifactId !== source.sourceArtifactId) {
        reasons.push(
          `candidate cites artifact ${candidate.sourceArtifactId} but source ${candidate.sourceRef} is captured as ${source.sourceArtifactId}`,
        );
      }
      if (candidate.authority !== source.authority) {
        reasons.push(
          `candidate claims authority ${candidate.authority} but source ${candidate.sourceRef} is captured as ${source.authority}`,
        );
      }
      if (candidate.retrievedAt !== source.retrievedAt) {
        reasons.push(
          `candidate claims retrievedAt ${candidate.retrievedAt} but source ${candidate.sourceRef} was captured at ${source.retrievedAt}`,
        );
      }
    }

    // --- Independent binding to the raw capture bytes ---
    const anchor = candidate.evidenceAnchor;
    const document = anchor ? documentById.get(anchor.documentId) : undefined;
    if (!anchor) {
      reasons.push("no evidence anchor into a raw capture");
    } else if (!document) {
      reasons.push(`evidence anchor document ${anchor.documentId} does not resolve to a captured document`);
    } else if (document.sourceRef !== candidate.sourceRef) {
      reasons.push(
        `evidence anchor document ${anchor.documentId} belongs to source ${document.sourceRef}, not ${candidate.sourceRef}`,
      );
    } else if (!anchorExistsIn(document, anchor.exactText)) {
      reasons.push("evidence anchor text does not exist in the captured bytes (invented quote)");
    }

    // --- Independent value re-derivation for deterministic predicates ---
    const rederive = INDEPENDENTLY_VERIFIABLE[candidate.predicate];
    if (rederive && anchor && candidate.proposedValue.kind === "quantity") {
      const derived = rederive(anchor.exactText, candidate.proposedValue.value);
      if (derived === null) {
        reasons.push(
          `verifier could not independently read a ${candidate.predicate} value from the evidence anchor`,
        );
      } else if (derived !== candidate.proposedValue.value) {
        reasons.push(
          `evidence anchor says ${derived} but the candidate proposes ${candidate.proposedValue.value} ${candidate.proposedValue.unit}`,
        );
      }
    }

    // --- Original structural checks ---
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
