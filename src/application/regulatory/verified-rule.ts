import { z } from "zod";
import {
  CandidateRule as CandidateRuleSchema,
  type CandidateApplicability,
} from "./candidate-rule";
import { ClaimPredicate as ClaimPredicateSchema, type ClaimPredicate } from "../../domain/enums";

/**
 * VerifiedRule — the verifier-owned canonical semantic result (PR #28 merge
 * gate). The extractor may PROPOSE anything; only evidence-derived semantics
 * AND identity AND applicability can execute or be shown as legal
 * provenance. Everything capable of changing Regulation identity,
 * applicability, Constraint semantics, conflict grouping, solver output, or
 * user-visible provenance is verifier-owned here:
 *
 *   verifiedPredicate / verifiedSemanticRuleKey — re-derived from the anchor
 *     content (row labels, code text, table shape), cross-checked against
 *     the candidate's claim; mismatch REJECTS.
 *   verifiedApplicability — derived from the capture and the TRUSTED
 *     compile subject context, never copied from the candidate.
 *   verifiedLocator — token-checked against the capture; fabricated
 *     locators are replaced by the anchor excerpt.
 *   verifiedSubjectNodeId / verifiedJurisdictionKey — must equal the
 *     trusted caller/project context or the candidate is rejected.
 *
 * When identity or applicability cannot be independently established, the
 * rule ABSTAINS — never invented to preserve coverage.
 */

export const CanonicalVerifiedValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quantity"), value: z.number().finite(), unit: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("permission"), permission: z.enum(["BY_RIGHT", "SPECIAL_EXCEPTION", "PROHIBITED"]) }).strict(),
  z.object({ kind: z.literal("prohibition"), overlay: z.string().min(1), prohibits: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("parking-formula"), use: z.string().min(1), formula: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("density-tiers"),
      tiers: z.array(z.object({ firstSqFt: z.number().finite(), perUnit: z.number().finite() }).strict()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("occupied-area-by-lot-type"),
      intermediate: z.number().finite().optional(),
      corner: z.number().finite().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("side-yard-range"), min: z.number().finite(), max: z.number().finite() }).strict(),
  z.object({ kind: z.literal("bonus-tiers"), tiers: z.record(z.string(), z.number().finite()) }).strict(),
  z.object({ kind: z.literal("contextual-setback"), face: z.enum(["front"]), ruleId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("abstain"), reason: z.string().min(1) }).strict(),
]);
export type CanonicalVerifiedValue = z.infer<typeof CanonicalVerifiedValue>;

export const VerifiedRule = z
  .object({
    /** The original proposal, retained verbatim for audit. */
    candidate: CandidateRuleSchema,
    /** Verifier-owned identity — derived from captured evidence. */
    verifiedPredicate: ClaimPredicateSchema,
    verifiedSemanticRuleKey: z.string().min(1),
    /** Capture-backed excerpt (the verified anchor itself). */
    verifiedExcerpt: z.string().min(1),
    /** Verifier-owned locator — token-checked or anchor-derived. */
    verifiedLocator: z.string().min(1),
    /** Verifier-owned semantics — never extractor-owned. */
    verifiedValue: CanonicalVerifiedValue,
    /** Verifier-owned applicability — derived from capture + trusted subject. */
    verifiedApplicability: CandidateRuleSchema.shape.applicability,
    /** Trusted project context (cross-checked, then used downstream). */
    verifiedSubjectNodeId: z.string().min(1),
    verifiedJurisdictionKey: z.string().min(1),
    verificationNotes: z.array(z.string()).default([]),
  })
  .strict();
export type VerifiedRule = z.infer<typeof VerifiedRule>;

/** The trusted compile context the caller supplies (project truth). */
export type TrustedCompileContext = {
  subjectNodeId: string;
  jurisdictionKey: string;
  district?: string;
};

export type VerifiedIdentity = {
  predicate: ClaimPredicate;
  semanticRuleKey: string;
  applicability: CandidateApplicability;
};

/**
 * Derive semantic identity from the ANCHOR text (what the capture actually
 * says) plus the trusted subject district. This is the evidence's own claim
 * about which rule it is — independent of what the extractor labeled it.
 */
export function deriveIdentityFromEvidence(
  anchor: string,
  captureText: string,
  subject: TrustedCompileContext,
): VerifiedIdentity | null {
  const combined = `${anchor}\n${captureText}`;
  const district = subject.district ? { district: subject.district } : {};

  // Overlay tokens appear in adopted-code anchors themselves (/SIX, ...).
  const overlayToken =
    /\/([A-Z]{2,4})(?=[\s,.:'])/.exec(anchor)?.[0] ??
    /\/([A-Z]{2,4})(?=[\s,.:'])/.exec(captureText.slice(0, 400))?.[0] ??
    null;

  if (/accessory dwelling units?\s+(shall not be permitted|are not permitted|not permitted)/i.test(anchor)) {
    if (overlayToken) {
      return {
        predicate: "overlay-restriction",
        semanticRuleKey: `overlay:${overlayToken.toLowerCase()}:adu-prohibition`,
        applicability: { overlay: overlayToken },
      };
    }
  }
  if (/Applicability\.\s+The\s+\S+\s+Overlay District applies to/i.test(anchor)) {
    if (overlayToken) {
      return {
        predicate: "overlay-restriction",
        semanticRuleKey: `overlay:${overlayToken.toLowerCase()}:applicability`,
        applicability: { overlay: overlayToken },
      };
    }
  }

  if (/Multi-Family\s+—/.test(anchor)) {
    return {
      predicate: "parking-requirement",
      semanticRuleKey: "parking:multi-family:minimum",
      applicability: { ...district, use: "household-living-multi-family" },
    };
  }
  if (/Religious Assembly\s+—\s*"/.test(anchor)) {
    return {
      predicate: "parking-requirement",
      semanticRuleKey: "parking:religious-assembly:minimum",
      applicability: { use: "religious-assembly" },
    };
  }

  const useRow = /\|\s*([^|]+)\|\s*(Y|S|N)\[?\d?\]?[^|]*\|?\s*$/i.exec(anchor.trim());
  if (useRow) {
    const use = slugFromUseLabel(useRow[1].trim());
    if (use) {
      return {
        predicate: "use-permission",
        semanticRuleKey: `use:${use}:permission`,
        applicability: { ...district, use },
      };
    }
  }

  // Prose height (adopted-code sentence shape).
  if (/maximum building height[\s\S]*?\d+\s*ft/i.test(anchor)) {
    return {
      predicate: "max-height",
      semanticRuleKey: "height:max:principal",
      applicability: { ...district },
    };
  }

  const dimensional: Array<[RegExp, string, string]> = [
    [/Min\.\s*Lot\s*Width/i, "lot-width", "lot:width:min"],
    [/Min\.\s*Lot\s*Area/i, "lot-area", "lot:area:min"],
    [/Max\.\s*Occupied\s*Area/i, "occupied-area", "bulk:occupied-area:max"],
    [/Min\.\s*Front\s*Setback/i, "setback-front", "setback:front"],
    [/Side\s*Yard\s*Width/i, "setback-side", "setback:side:min"],
    [/Rear\s*Yard\s*Depth/i, "setback-rear", "setback:rear:min"],
    [/Max\.\s*Height\s*\/\s*FAR/i, "max-height", "height:max:principal"],
  ];
  for (const [pattern, predicate, key] of dimensional) {
    if (pattern.test(anchor)) {
      const applicability: CandidateApplicability = { ...district };
      if (predicate === "occupied-area") applicability.lotType = "intermediate";
      return { predicate: predicate as ClaimPredicate, semanticRuleKey: key, applicability };
    }
  }

  if (/minimum (?:[\d,.]+ sq\.?\s*ft\.?(?:\s+of)?\s+)?lot area (?:is )?required per dwelling unit/i.test(anchor)) {
    return {
      predicate: "density-formula",
      semanticRuleKey: "density:min-lot-area-per-unit",
      applicability: { ...district },
    };
  }

  if (/Mixed Income Housing/i.test(anchor) && /Moderate Income/i.test(combined)) {
    return {
      predicate: "density-bonus",
      semanticRuleKey: "bonus:mixed-income:percent",
      applicability: { ...district, use: "mixed-income-housing" },
    };
  }

  return null;
}

function slugFromUseLabel(label: string): string | null {
  if (/Multi-Family/i.test(label)) return "multi-family";
  if (/Religious\s*Assembly/i.test(label)) return "religious-assembly";
  if (/Child Care Center/i.test(label)) return "child-care";
  return null;
}

// ---------------------------------------------------------------------------
// Verifier-owned value derivation (identity + trusted subject only)
// ---------------------------------------------------------------------------

function permissionFromText(text: string): "BY_RIGHT" | "SPECIAL_EXCEPTION" | "PROHIBITED" | null {
  const cells = text.split("|").map((c) => c.trim()).filter(Boolean);
  const cell = cells[cells.length - 1] ?? text.trim();
  const probe = cell.replace(/\[\d+\]/g, "").trim();
  if (/^Y(?!e)/i.test(probe)) return "BY_RIGHT";
  if (/^S(?!a)/i.test(probe) || /^Special/i.test(probe)) return "SPECIAL_EXCEPTION";
  if (/^N(?!e)/i.test(probe) || /^Not allowed/i.test(probe)) return "PROHIBITED";
  return null;
}

function parkingFormulaFromExcerpt(excerpt: string): string | null {
  const quoted = /"([^"]*(?:seats|sq\.?\s*ft|spaces)[^"]*)"/i.exec(excerpt);
  if (quoted) return quoted[1];
  const afterDash = /—\s*([^|"]*(?:seats|sq\.?\s*ft|spaces)[^|"]*)/i.exec(excerpt);
  if (afterDash) return afterDash[1].trim();
  return null;
}

function densityTiersFromText(text: string): Array<{ firstSqFt: number; perUnit: number }> | null {
  const match = text.match(
    /(\d[\d,]*)\s*sq\.?\s*ft(?:\.|\b)[\s\S]*?first\s+(\d[\d,]*)\s*sq\.?\s*ft[\s\S]*?(\d[\d,]*)\s*sq\.?\s*ft[\s\S]*?(?:above|in excess of)/i,
  );
  if (!match) return null;
  const firstTier = Number(match[2].replace(/,/g, ""));
  const firstPerUnit = Number(match[1].replace(/,/g, ""));
  const abovePerUnit = Number(match[3].replace(/,/g, ""));
  if (![firstTier, firstPerUnit, abovePerUnit].every(Number.isFinite)) return null;
  return [
    { firstSqFt: firstTier, perUnit: firstPerUnit },
    { firstSqFt: firstTier, perUnit: abovePerUnit },
  ];
}

function occupiedAreaFromText(text: string): { intermediate?: number; corner?: number } | null {
  const intermediate = /intermediate\s+(\d+(?:\.\d+)?)%/i.exec(text);
  const corner = /corner\s+(\d+(?:\.\d+)?)%/i.exec(text);
  if (!intermediate && !corner) return null;
  return {
    intermediate: intermediate ? Number(intermediate[1]) : undefined,
    corner: corner ? Number(corner[1]) : undefined,
  };
}

function sideYardRangeFromText(text: string): { min: number; max: number } | null {
  const match = /(\d+(?:\.\d+)?)'\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)'/.exec(text);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function bonusTiersFromText(text: string): Record<string, number> | null {
  const tiers: Record<string, number> = {};
  const moderate = /moderate income:?\s*(\d+)%/i.exec(text);
  const low = /low income:?\s*(\d+)%/i.exec(text);
  if (moderate) tiers.moderate = Number(moderate[1]);
  if (low) tiers.low = Number(low[1]);
  return Object.keys(tiers).length > 0 ? tiers : null;
}

function normalizeFeet(text: string): { value: number } | null {
  const match = /(\d+(?:\.\d+)?)\s*(?:ft\.?|feet|')(?![\w])/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value } : null;
}

function normalizeSqFt(text: string): { value: number } | null {
  const match = /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sf)\b/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { value } : null;
}

/**
 * Derive verifier-owned semantics using ONLY evidence-derived identity +
 * trusted subject context — never candidate applicability/identity.
 */
export function deriveVerifiedValue(
  identity: VerifiedIdentity,
  verifiedExcerpt: string,
  captureText: string,
): CanonicalVerifiedValue | null {
  const anchor = verifiedExcerpt;
  switch (identity.predicate) {
    case "max-height":
    case "lot-width":
    case "setback-rear": {
      const feet = normalizeFeet(anchor) ?? normalizeFeet(verifiedExcerpt);
      return feet ? { kind: "quantity", value: feet.value, unit: "ft" } : null;
    }
    case "setback-side": {
      const range = sideYardRangeFromText(anchor) ?? sideYardRangeFromText(captureText);
      if (range) return { kind: "side-yard-range", ...range };
      const min = normalizeFeet(anchor);
      return min ? { kind: "side-yard-range", min: min.value, max: min.value } : null;
    }
    case "setback-front":
      return { kind: "contextual-setback", face: "front", ruleId: "adjacent-facades" };
    case "occupied-area": {
      const byLot = occupiedAreaFromText(anchor) ?? occupiedAreaFromText(captureText);
      if (!byLot || (byLot.intermediate === undefined && byLot.corner === undefined)) return null;
      return { kind: "occupied-area-by-lot-type", ...byLot };
    }
    case "density-formula": {
      const tiers = densityTiersFromText(anchor) ?? densityTiersFromText(captureText);
      return tiers ? { kind: "density-tiers", tiers } : null;
    }
    case "parking-requirement": {
      const cells = anchor.split("|").map((c) => c.trim());
      if (cells.length >= 3 && /Multi-Family/i.test(cells[0]) && /^\d+$/.test(cells[1])) {
        return { kind: "quantity", value: Number(cells[1]), unit: "spaces" };
      }
      const single = /^\s*(\d+)\s*$/.exec(anchor.trim());
      if (single) return { kind: "quantity", value: Number(single[1]), unit: "spaces" };
      const formula = parkingFormulaFromExcerpt(anchor) ?? parkingFormulaFromExcerpt(verifiedExcerpt);
      if (formula) {
        return { kind: "parking-formula", use: identity.applicability.use ?? "unscoped", formula };
      }
      return null;
    }
    case "use-permission": {
      const permission = permissionFromText(anchor);
      return permission ? { kind: "permission", permission } : null;
    }
    case "overlay-restriction": {
      if (/accessory dwelling units?\s+(shall not be permitted|are not permitted|not permitted)/i.test(anchor)) {
        return {
          kind: "prohibition",
          overlay: identity.applicability.overlay ?? "",
          prohibits: "accessory-dwelling-units",
        };
      }
      return null;
    }
    case "density-bonus": {
      const tiers = bonusTiersFromText(anchor) ?? bonusTiersFromText(captureText);
      return tiers ? { kind: "bonus-tiers", tiers } : null;
    }
    case "lot-area": {
      const sqft = normalizeSqFt(anchor) ?? normalizeSqFt(verifiedExcerpt);
      return sqft ? { kind: "quantity", value: sqft.value, unit: "sq_ft" } : null;
    }
    case "far":
    default:
      return null;
  }
}

export type { CandidateApplicability };
