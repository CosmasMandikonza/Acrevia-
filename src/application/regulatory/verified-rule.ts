import { z } from "zod";
import { CandidateRule as CandidateRuleSchema, type CandidateRule } from "./candidate-rule";
import { normalizeFeet, normalizeSqFt } from "./normalize";

/**
 * VerifiedRule — the verifier-owned canonical semantic result (PR #28 final
 * closeout). The model/extractor can PROPOSE meaning; only evidence-derived
 * semantics can execute. Everything downstream of the verifier — conflict
 * comparison, canonical Claim values, Regulation construction, and the
 * executable constraint payload — consumes THIS type, never raw
 * `candidate.proposedValue` or `candidate.verbatimSupportingText`.
 *
 * A VerifiedRule exists only when the second pass independently established
 * ALL consequential semantics from the captured evidence:
 *
 *   quantity rules     — value (already) + every secondary number (ranges,
 *                        tier breakpoints, by-lot-type percentages, bonus
 *                        tiers) re-parsed from the verified anchor/capture;
 *   use-permission     — permission letter re-read from the anchor row;
 *   parking formula    — formula text taken from the capture span, with the
 *                        candidate's rendering required to agree;
 *   overlay rules      — prohibition subject re-read from the anchor;
 *   density tiers      — all three tier numbers from the anchor;
 *   contextual setback — the ONLY extractor-informed shape left, and it is
 *                        NON-EXECUTABLE-VALUE by design (no number derives
 *                        from prose; the constraint carries a contextual
 *                        rule id that #7 evaluates against geometry).
 *
 * Predicates whose semantics cannot be fully derived (FAR, GIS site facts,
 * lot width/area) never produce a VerifiedRule with an executable value —
 * they abstain (Claim/Regulation only or Claim only).
 */

export const CanonicalVerifiedValue = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("quantity"),
      value: z.number().finite(),
      unit: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("permission"),
      permission: z.enum(["BY_RIGHT", "SPECIAL_EXCEPTION", "PROHIBITED"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("prohibition"),
      overlay: z.string().min(1),
      prohibits: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("parking-formula"),
      use: z.string().min(1),
      formula: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("density-tiers"),
      tiers: z
        .array(
          z
            .object({ firstSqFt: z.number().finite(), perUnit: z.number().finite() })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("occupied-area-by-lot-type"),
      intermediate: z.number().finite().optional(),
      corner: z.number().finite().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("side-yard-range"),
      min: z.number().finite(),
      max: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bonus-tiers"),
      tiers: z.record(z.string(), z.number().finite()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contextual-setback"),
      face: z.enum(["front"]),
      ruleId: z.string().min(1),
    })
    .strict(),
  /** Deliberate abstention — evidence establishes no executable value. */
  z.object({ kind: z.literal("abstain"), reason: z.string().min(1) }).strict(),
]);
export type CanonicalVerifiedValue = z.infer<typeof CanonicalVerifiedValue>;

export const VerifiedRule = z
  .object({
    /** The original proposal, retained verbatim for audit. */
    candidate: CandidateRuleSchema,
    /** Capture-backed excerpt (the verified anchor itself). */
    verifiedExcerpt: z.string().min(1),
    verifiedLocator: z.string().min(1),
    /** Verifier-owned semantics — never extractor-owned. */
    verifiedValue: CanonicalVerifiedValue,
    verifiedApplicability: CandidateRuleSchema.shape.applicability ?? z.never().optional(),
    verificationNotes: z.array(z.string()).default([]),
  })
  .strict();
export type VerifiedRule = z.infer<typeof VerifiedRule>;

/**
 * Independently derive the canonical semantics for a candidate from its
 * VERIFIED anchor text (already proven to exist in the captured bytes).
 * Returns null when the predicate's consequential semantics cannot be fully
 * derived from evidence — callers must abstain then, not fall back to the
 * extractor's rendering.
 */

function permissionFromText(text: string): "BY_RIGHT" | "SPECIAL_EXCEPTION" | "PROHIBITED" | null {
  // Use-permission anchors are table rows: the permission cell is the LAST
  // pipe-delimited cell ("| Multi-Family | Y[1] |") or the whole span.
  const cells = text.split("|").map((c) => c.trim()).filter(Boolean);
  const cell = cells[cells.length - 1] ?? text.trim();
  const probe = cell.replace(/\[\d+\]/g, "").trim();
  if (/^Y(?!e)/i.test(probe)) return "BY_RIGHT";
  if (/^S(?!a)/i.test(probe) || /^Special/i.test(probe)) return "SPECIAL_EXCEPTION";
  if (/^N(?!e)/i.test(probe) || /^Not allowed/i.test(probe)) return "PROHIBITED";
  return null;
}

function parkingFormulaFromExcerpt(excerpt: string): string | null {
  // Adopted-code formula rows carry the ratio text in quotes or after the
  // em-dash in the anchor span; extract the formula-shaped fragment.
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

function prohibitionFromText(text: string, overlay: string | undefined): { overlay: string; prohibits: string } | null {
  if (!overlay) return null;
  if (/accessory dwelling units?\s+(shall not be permitted|are not permitted|not permitted)/i.test(text)) {
    return { overlay, prohibits: "accessory-dwelling-units" };
  }
  return null;
}

/**
 * Derive verifier-owned semantics. `captureText` is the document text the
 * anchor was proven against — some secondary numbers (tier breakpoints,
 * by-lot-type percentages) legitimately live in adjacent captured lines, so
 * the verifier reads them from the CAPTURE, never from candidate prose.
 */
export function deriveVerifiedValue(
  candidate: CandidateRule,
  verifiedExcerpt: string,
  captureText: string,
): CanonicalVerifiedValue | null {
  const anchor = candidate.evidenceAnchor.exactText;
  switch (candidate.predicate) {
    case "max-height":
    case "lot-width":
    case "setback-rear": {
      const feet = normalizeFeet(anchor) ?? normalizeFeet(verifiedExcerpt);
      return feet ? { kind: "quantity", value: feet.value, unit: "ft" } : null;
    }
    case "setback-side": {
      // Range semantics (5–12) must BOTH come from the capture.
      const range = sideYardRangeFromText(anchor) ?? sideYardRangeFromText(captureText);
      if (range) return { kind: "side-yard-range", ...range };
      const min = normalizeFeet(anchor);
      return min ? { kind: "side-yard-range", min: min.value, max: min.value } : null;
    }
    case "setback-front": {
      // Contextual rule: the executable semantic is the RULE ID, not any
      // number. The rule id names the guide's notes [5],[6] mechanism which
      // #7 evaluates against blockface geometry — no prose value executes.
      return { kind: "contextual-setback", face: "front", ruleId: "adjacent-facades" };
    }
    case "occupied-area": {
      const byLot = occupiedAreaFromText(anchor) ?? occupiedAreaFromText(captureText);
      if (!byLot) return null;
      if (byLot.intermediate === undefined && byLot.corner === undefined) return null;
      return { kind: "occupied-area-by-lot-type", ...byLot };
    }
    case "density-formula": {
      const tiers = densityTiersFromText(anchor) ?? densityTiersFromText(captureText);
      return tiers ? { kind: "density-tiers", tiers } : null;
    }
    case "parking-requirement": {
      // Adopted-code parking anchors are pipe-delimited district-group rows
      // ("Multi-Family — 1 | 0 | 3/10 units"): column group 2 is the RM-1
      // value. The verifier reads the SECOND numeric cell — never the
      // extractor's claim — so the correct district's requirement executes.
      const cells = anchor.split("|").map((c) => c.trim());
      if (cells.length >= 3 && /Multi-Family/i.test(cells[0]) && /^\d+$/.test(cells[1])) {
        return { kind: "quantity", value: Number(cells[1]), unit: "spaces" };
      }
      const single = /^\s*(\d+)\s*$/.exec(anchor.trim());
      if (single) {
        return { kind: "quantity", value: Number(single[1]), unit: "spaces" };
      }
      const formula = parkingFormulaFromExcerpt(anchor) ?? parkingFormulaFromExcerpt(verifiedExcerpt);
      if (formula) {
        return { kind: "parking-formula", use: candidate.applicability.use ?? "unscoped", formula };
      }
      return null;
    }
    case "use-permission": {
      const permission = permissionFromText(anchor);
      return permission ? { kind: "permission", permission } : null;
    }
    case "overlay-restriction": {
      const prohibition = prohibitionFromText(anchor, candidate.applicability.overlay);
      return prohibition ? { kind: "prohibition", ...prohibition } : null;
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
      // FAR and GIS site facts: no executable semantics derivable — abstain.
      return null;
  }
}
