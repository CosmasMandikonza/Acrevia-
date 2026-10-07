import type { CandidateRule } from "./candidate-rule";
import type { RawEvidenceDocument, SourceMetadata } from "./extraction";
import {
  deriveIdentityFromEvidence,
  deriveVerifiedValue,
  type TrustedCompileContext,
  type VerifiedRule,
} from "./verified-rule";

/**
 * Deterministic candidate verification (issue #5, merge gate) — the
 * compiler's second pass. Verification decides; extraction only proposes.
 *
 * The verifier owns EVERYTHING capable of changing downstream truth:
 *   - identity (predicate + semanticRuleKey) re-derived from the anchor;
 *     a candidate claiming a different identity than the evidence shows is
 *     REJECTED (identity spoof);
 *   - applicability derived from capture + trusted subject context;
 *   - locator token-checked against the capture (fabricated locators are
 *     replaced by the anchor excerpt and flagged);
 *   - subject/jurisdiction must equal the TRUSTED compile context;
 *   - value semantics independently derived (quantity/permission/etc.);
 *   - source metadata (artifact id, authority, retrievedAt) cross-checked;
 *   - anchor existence in the captured bytes.
 *
 * Rules whose identity or semantics cannot be derived ABSTAIN — they stay
 * Claim-only and never execute.
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
  /** Verifier-owned canonical result. Absent on REJECT; on ACCEPT its
   *  absence or an abstain value means the rule does not execute. */
  verified?: VerifiedRule;
};

function quantityProblems(
  predicate: string,
  value: { kind: string; value?: number; unit?: string },
): string[] {
  if (value.kind !== "quantity") return [];
  const problems: string[] = [];
  const quantity = value.value ?? Number.NaN;
  if (!Number.isFinite(quantity)) {
    problems.push("value is not a finite number");
    return problems;
  }
  switch (predicate) {
    case "max-height":
    case "lot-width":
    case "lot-area":
      if (quantity <= 0) problems.push(`${predicate} must be greater than 0 ${value.unit}`);
      break;
    case "setback-side":
    case "setback-rear":
      if (quantity < 0) problems.push(`${predicate} cannot be negative`);
      break;
    case "occupied-area":
    case "density-bonus":
      if (quantity <= 0 || quantity > 100) {
        problems.push(`${predicate} must be a percent between 0 and 100`);
      }
      break;
    case "parking-requirement":
      if (quantity < 0 || !Number.isInteger(quantity)) {
        problems.push("parking requirement must be a whole number of spaces, at least 0");
      }
      break;
    default:
      break;
  }
  return problems;
}

function anchorExistsIn(document: RawEvidenceDocument, exactText: string): boolean {
  const haystack =
    document.kind === "code-text" ? document.text ?? "" : JSON.stringify(document.json ?? {});
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  return collapse(haystack).includes(collapse(exactText));
}

/** Locator is honest when its distinctive tokens appear in the capture. */
function locatorTokensAppear(document: RawEvidenceDocument, locator: string): boolean {
  const haystack =
    document.kind === "code-text"
      ? (document.text ?? "").toLowerCase()
      : JSON.stringify(document.json ?? "").toLowerCase();
  const tokens = locator
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) =>
        token.length >= 4 &&
        !/^(the|and|for|with|code|table|column|row|section|excerpt|quick|guide|official|structure|philadelphia)$/.test(token),
    );
  if (tokens.length === 0) return true;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length >= 0.5;
}

export function verifyCandidates(input: {
  candidates: CandidateRule[];
  sources: SourceMetadata[];
  subject: { district?: string };
  documents?: RawEvidenceDocument[];
  /** Trusted project truth; candidates must match it. */
  trustedContext?: TrustedCompileContext;
}): VerificationDecision[] {
  const sourceByArtifact = new Map(input.sources.map((source) => [source.sourceArtifactId, source]));
  const sourceByRef = new Map(input.sources.map((source) => [source.sourceRef, source]));
  const documentById = new Map((input.documents ?? []).map((doc) => [doc.documentId, doc]));
  const trusted: TrustedCompileContext =
    input.trustedContext ??
    ({ subjectNodeId: "", jurisdictionKey: "" } as TrustedCompileContext);

  return input.candidates.map((candidate) => {
    const reasons: string[] = [];
    const source = sourceByArtifact.get(candidate.sourceArtifactId) ?? sourceByRef.get(candidate.sourceRef);
    const anchor = candidate.evidenceAnchor;
    const document = anchor ? documentById.get(anchor.documentId) : undefined;

    // --- Trusted project context: subject + jurisdiction must match ---
    if (trusted.subjectNodeId && candidate.subjectNodeId !== trusted.subjectNodeId) {
      reasons.push(
        `candidate subject ${candidate.subjectNodeId} does not match the trusted project parcel ${trusted.subjectNodeId}`,
      );
    }
    if (trusted.jurisdictionKey && candidate.jurisdictionKey !== trusted.jurisdictionKey) {
      reasons.push(
        `candidate jurisdiction ${candidate.jurisdictionKey} does not match the trusted project jurisdiction ${trusted.jurisdictionKey}`,
      );
    }

    // --- Source metadata binding ---
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

    // --- Anchor binding ---
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

    // --- Structural checks ---
    if (!candidate.verbatimSupportingText.trim()) {
      reasons.push("no verbatim supporting text captured for the proposed value");
    }
    if (REGULATORY_PREDICATES.has(candidate.predicate) && !candidate.codeSection?.trim()) {
      reasons.push("no code section / source locator for a regulatory rule");
    }
    reasons.push(...quantityProblems(candidate.predicate, candidate.proposedValue));
    if (input.subject.district && candidate.applicability.district && candidate.applicability.district !== input.subject.district) {
      reasons.push(
        `rule applies to district ${candidate.applicability.district}, not the subject district ${input.subject.district}`,
      );
    }

    if (reasons.length > 0) return { candidate, status: "REJECT", reasons };

    // ---- Verifier-owned identity + semantics from the capture ----
    const captureText =
      document?.kind === "code-text" ? document.text ?? "" : JSON.stringify(document?.json ?? "");
    const notes: string[] = [];

    // Locator: fabricated locators never reach the graph/UI.
    let verifiedLocator = candidate.codeSection ?? anchor.exactText.slice(0, 80);
    if (
      candidate.codeSection &&
      document &&
      !locatorTokensAppear(document, candidate.codeSection)
    ) {
      notes.push(
        `candidate locator failed capture token check; replaced with verifier-derived locator`,
      );
      verifiedLocator = anchor.exactText.slice(0, 80);
    }

    const unknownValue = candidate.proposedValue.kind === "unknown";
    const identity = deriveIdentityFromEvidence(anchor.exactText, captureText, {
      subjectNodeId: trusted.subjectNodeId || candidate.subjectNodeId,
      jurisdictionKey: trusted.jurisdictionKey || candidate.jurisdictionKey,
      district: input.subject.district,
    });

    if (!identity && !unknownValue) {
      // Identity cannot be independently established from the capture.
      notes.push("verifier could not derive semantic identity from captured evidence; abstaining");
      return {
        candidate,
        status: "ACCEPT",
        reasons: [],
        verified: {
          candidate,
          verifiedPredicate: candidate.predicate,
          verifiedSemanticRuleKey: candidate.semanticRuleKey,
          verifiedExcerpt: anchor.exactText,
          verifiedLocator,
          verifiedValue: { kind: "abstain", reason: "identity not derivable from capture" },
          verifiedApplicability: candidate.applicability,
          verifiedSubjectNodeId: trusted.subjectNodeId || candidate.subjectNodeId,
          verifiedJurisdictionKey: trusted.jurisdictionKey || candidate.jurisdictionKey,
          verificationNotes: notes,
        },
      };
    }

    if (identity && !unknownValue) {
      // IDENTITY SPOOF check: the evidence says what rule this is; a
      // candidate claiming a different rule is rejected outright.
      if (identity.predicate !== candidate.predicate) {
        return {
          candidate,
          status: "REJECT",
          reasons: [
            `evidence identity is ${identity.predicate} (${identity.semanticRuleKey}) but the candidate claims ${candidate.predicate} (${candidate.semanticRuleKey})`,
          ],
        };
      }
      if (identity.semanticRuleKey !== candidate.semanticRuleKey) {
        return {
          candidate,
          status: "REJECT",
          reasons: [
            `evidence identity is ${identity.semanticRuleKey} but the candidate claims ${candidate.semanticRuleKey}`,
          ],
        };
      }
    }

    if (unknownValue) {
      // Unknown proposals execute nothing; the audit identity stays the
      // candidate's own label (e.g. far:max) with no executable impact.
      return {
        candidate,
        status: "ACCEPT",
        reasons: [],
        verified: {
          candidate,
          verifiedPredicate: candidate.predicate,
          verifiedSemanticRuleKey: candidate.semanticRuleKey,
          verifiedExcerpt: anchor.exactText,
          verifiedLocator,
          verifiedValue: { kind: "abstain", reason: "evidence establishes no value; recorded UNKNOWN" },
          verifiedApplicability: identity?.applicability ?? candidate.applicability,
          verifiedSubjectNodeId: trusted.subjectNodeId || candidate.subjectNodeId,
          verifiedJurisdictionKey: trusted.jurisdictionKey || candidate.jurisdictionKey,
          verificationNotes: notes,
        },
      };
    }

    const derived = deriveVerifiedValue(identity!, anchor.exactText, captureText);
    if (!derived) {
      notes.push("verifier could not derive executable semantics from captured evidence; abstaining");
      return {
        candidate,
        status: "ACCEPT",
        reasons: [],
        verified: {
          candidate,
          verifiedPredicate: identity!.predicate,
          verifiedSemanticRuleKey: identity!.semanticRuleKey,
          verifiedExcerpt: anchor.exactText,
          verifiedLocator,
          verifiedValue: { kind: "abstain", reason: "semantics not derivable from capture" },
          verifiedApplicability: identity!.applicability,
          verifiedSubjectNodeId: trusted.subjectNodeId || candidate.subjectNodeId,
          verifiedJurisdictionKey: trusted.jurisdictionKey || candidate.jurisdictionKey,
          verificationNotes: notes,
        },
      };
    }

    // Candidate proposal cross-checks (drift -> reject).
    if (derived.kind === "quantity" && candidate.proposedValue.kind === "quantity" && derived.value !== candidate.proposedValue.value) {
      return {
        candidate,
        status: "REJECT",
        reasons: [
          `evidence anchor says ${derived.value} but the candidate proposes ${candidate.proposedValue.value} ${candidate.proposedValue.unit}`,
        ],
      };
    }
    if (derived.kind === "permission" && candidate.proposedValue.kind === "qualitative") {
      const proposed =
        /^Y/i.test(candidate.proposedValue.text.trim())
          ? "BY_RIGHT"
          : /^S/i.test(candidate.proposedValue.text.trim())
            ? "SPECIAL_EXCEPTION"
            : /^N/i.test(candidate.proposedValue.text.trim())
              ? "PROHIBITED"
              : null;
      if (proposed && proposed !== derived.permission) {
        return {
          candidate,
          status: "REJECT",
          reasons: [`evidence anchor reads ${derived.permission} but the candidate claims ${proposed}`],
        };
      }
    }

    return {
      candidate,
      status: "ACCEPT",
      reasons: [],
      verified: {
        candidate,
        verifiedPredicate: identity!.predicate,
        verifiedSemanticRuleKey: identity!.semanticRuleKey,
        verifiedExcerpt: anchor.exactText,
        verifiedLocator,
        verifiedValue: derived,
        verifiedApplicability: identity!.applicability,
        verifiedSubjectNodeId: trusted.subjectNodeId || candidate.subjectNodeId,
        verifiedJurisdictionKey: trusted.jurisdictionKey || candidate.jurisdictionKey,
        verificationNotes: notes,
      },
    };
  });
}
