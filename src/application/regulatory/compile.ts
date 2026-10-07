import type { CommandContext } from "../../commands";
import {
  addSourceArtifact,
  materializeConstraint,
  openExpertReviewItem,
  recordClaim,
  upsertRegulation,
} from "../../commands";
import type { ClaimValue, ClaimPredicate } from "../../domain";
import type { CandidateRule } from "./candidate-rule";
import type { SourceMetadata } from "./extraction";
import { decideConflicts, type ConflictRecord } from "./conflicts";
import { verifyCandidates } from "./verify";

/**
 * Canonical graph compilation (issue #5): verified, conflict-resolved
 * candidates become Claim -> Regulation -> Constraint through the TYPED
 * COMMAND BOUNDARY. Nothing here writes project.nodes directly.
 *
 * Idempotency: source artifacts replay exactly; claims/constraints/reviews
 * are create-only so the compiler skips ids that already exist; regulations
 * upsert with edge replacement. Running the same compile twice leaves the
 * semantic graph unchanged — no duplicate claims, regulations, constraints,
 * reviews, or conflict references.
 *
 * No uncited regulation enters the solver: only ACCEPT + EXECUTABLE
 * candidates reach materializeConstraint, and the executable gate
 * (selectExecutableConstraints) independently re-verifies the full chain.
 */

export type CandidateOutcome = {
  candidateId: string;
  predicate: ClaimPredicate;
  outcome: "compiled" | "unknown-recorded" | "conflict-recorded" | "rejected";
  reasons: string[];
  claimId?: string;
  regulationId?: string;
  constraintId?: string;
};

export type CompileResult = {
  outcomes: CandidateOutcome[];
  conflicts: ConflictRecord[];
  claimed: number;
  regulated: number;
  constrained: number;
};

function slugFor(candidate: CandidateRule): string {
  switch (candidate.predicate) {
    case "use-permission":
    case "parking-requirement":
      return `${candidate.predicate}:${candidate.applicability.use ?? "unscoped"}`;
    case "overlay-restriction": {
      const overlay = candidate.applicability.overlay;
      if (overlay) return `overlay-restriction:${overlay.replace(/^\/+/, "").toLowerCase()}`;
      return `overlay-restriction:${(candidate.codeSection ?? "uncited").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    }
    default:
      return candidate.predicate;
  }
}

function claimValueFor(candidate: CandidateRule): ClaimValue {
  const value = candidate.proposedValue;
  if (value.kind === "quantity") {
    return { type: "quantity", quantity: { value: value.value, unit: value.unit } };
  }
  if (value.kind === "qualitative") {
    return { type: "qualitative", text: value.text };
  }
  return { type: "null", reason: "unknown" };
}

/** Parse the tiered density structure from the captured note text. */
function densityTiers(text: string): Array<{ firstSqFt: number; perUnit: number }> | null {
  const match = text.match(
    /(\d[\d,]*)\s*sq\s*ft(?:\.|\b)[\s\S]*?first\s+(\d[\d,]*)\s*sq\s*ft[\s\S]*?(\d[\d,]*)\s*sq\s*ft[\s\S]*?(?:above|in excess of)/i,
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

/** Occupied-area by-lot-type from a captured "Intermediate 75%; Corner 80%". */
function occupiedAreaByLotType(text: string): { intermediate?: number; corner?: number } {
  const intermediate = text.match(/intermediate\s+(\d+(?:\.\d+)?)%/i);
  const corner = text.match(/corner\s+(\d+(?:\.\d+)?)%/i);
  return {
    intermediate: intermediate ? Number(intermediate[1]) : undefined,
    corner: corner ? Number(corner[1]) : undefined,
  };
}

function sideYardRange(text: string): { min: number; max: number } | null {
  const match = text.match(/(\d+(?:\.\d+)?)'\s*to\s*(\d+(?:\.\d+)?)'/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

export function compileRegulations(
  ctx: CommandContext,
  input: {
    candidates: CandidateRule[];
    sources: SourceMetadata[];
    subject: { district?: string };
  },
): CompileResult {
  const verification = verifyCandidates(input);
  const accepted = verification
    .filter((decision) => decision.status === "ACCEPT")
    .map((decision) => decision.candidate);
  const { dispositions, conflicts } = decideConflicts(accepted);
  const conflictsByPredicate = new Map<string, ConflictRecord[]>();
  for (const conflict of conflicts) {
    const list = conflictsByPredicate.get(conflict.predicate) ?? [];
    list.push(conflict);
    conflictsByPredicate.set(conflict.predicate, list);
  }

  const sourceById = new Map<string, SourceMetadata>();
  for (const source of input.sources) {
    sourceById.set(source.sourceRef, source);
  }

  const outcomes: CandidateOutcome[] = [];
  let claimed = 0;
  let regulated = 0;
  let constrained = 0;

  // Deterministic order regardless of ingestion order.
  const ordered = [...input.candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));

  for (const candidate of ordered) {
    const decision = verification.find((d) => d.candidate.candidateId === candidate.candidateId);
    const disposition = dispositions.get(candidate.candidateId);
    const slug = slugFor(candidate);
    // Claims are per EVIDENCE OBSERVATION (predicate + source): the excluded
    // 55 ft memo and the winning 45 ft code each keep their own claim, so
    // the discrepancy stays visible while the regulation cites only the
    // executable evidence.
    const claimId = `phl:claim:${slug}:${candidate.sourceRef}`;
    const regulationId = `phl:reg:${slug}`;
    const constraintId = `phl:constraint:${slug}`;

    if (decision?.status === "REJECT") {
      outcomes.push({
        candidateId: candidate.candidateId,
        predicate: candidate.predicate,
        outcome: "rejected",
        reasons: decision.reasons,
      });
      continue;
    }

    // 1. Source artifact — exact replay is an idempotent no-op.
    const meta = sourceById.get(candidate.sourceRef);
    if (meta && !ctx.project.nodes[candidate.sourceArtifactId]) {
      addSourceArtifact(ctx, {
        id: candidate.sourceArtifactId,
        kind: "source-artifact",
        logicalSourceKey: `phl:src:${meta.sourceRef}`,
        version: 1,
        sourceType: meta.authority === "OFFICIAL_GIS" ? "official_gis" : meta.authority === "ADOPTED_CODE" ? "adopted_code" : "official_city_reference",
        title: meta.title,
        publisher: meta.publisher,
        canonicalUrl: meta.canonicalUrl,
        authority: meta.authority,
        retrievedAt: meta.retrievedAt,
        rawContentHash: `raw:${meta.sourceRef}`.padEnd(64, "0").slice(0, 64),
      });
    }

    const evidence =
      candidate.proposedValue.kind === "unknown"
        ? "UNKNOWN"
        : candidate.authority === "ADOPTED_CODE"
          ? "VERIFIED"
          : "SOURCE_CONFIRMED";

    // 2. Claim — create-only; skip when the compiler already recorded it.
    const conflictReasons =
      disposition && disposition.status !== "EXECUTABLE"
        ? disposition.reasons
        : [];
    if (!ctx.project.nodes[claimId]) {
      recordClaim(ctx, {
        id: claimId,
        kind: "claim",
        subjectNodeId: candidate.subjectNodeId,
        predicate: candidate.predicate,
        value: claimValueFor(candidate),
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [candidate.sourceArtifactId],
        evidenceState: disposition?.status === "EXECUTABLE" || disposition?.status === undefined ? evidence : "CONFLICT",
        verbatimQuote: candidate.verbatimSupportingText,
        notes: [
          candidate.notes,
          candidate.codeSection ? `locator: ${candidate.codeSection}` : undefined,
          `retrievedAt: ${candidate.retrievedAt}`,
          `extraction: ${candidate.extractionMethod}`,
          conflictReasons.length > 0 ? `conflict: ${conflictReasons.join("; ")}` : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      });
      claimed += 1;
    }

    // Non-executable paths: conflict claims stay visible; UNKNOWN claims
    // record the deliberate abstention. No regulation, no constraint.
    if (candidate.proposedValue.kind === "unknown") {
      outcomes.push({
        candidateId: candidate.candidateId,
        predicate: candidate.predicate,
        outcome: "unknown-recorded",
        reasons: ["no value established by captured evidence; recorded UNKNOWN, never coerced"],
        claimId,
      });
      continue;
    }
    if (disposition && disposition.status !== "EXECUTABLE") {
      outcomes.push({
        candidateId: candidate.candidateId,
        predicate: candidate.predicate,
        outcome: "conflict-recorded",
        reasons: conflictReasons,
        claimId,
      });
      continue;
    }

    // 3. Regulation — upsert (idempotent, replaces evidence edges). When
    // several executable candidates corroborate the same rule, cite them all
    // in a deterministic order.
    const predicateConflicts = (conflictsByPredicate.get(candidate.predicate) ?? []).map((c) => c.conflictId);
    const corroborating = accepted
      .filter(
        (other) =>
          slugFor(other) === slug &&
          dispositions.get(other.candidateId)?.status === "EXECUTABLE",
      )
      .map((other) => `phl:claim:${slug}:${other.sourceRef}`)
      .sort();
    upsertRegulation(ctx, {
      id: regulationId,
      kind: "regulation",
      jurisdictionKey: candidate.jurisdictionKey,
      codeSection: candidate.codeSection ?? candidate.verbatimSupportingText.slice(0, 80),
      applicability: candidate.applicability,
      claimIds: corroborating.length > 0 ? corroborating : [claimId],
      currentness: "CURRENT",
      conflictRefs: predicateConflicts,
      notes: candidate.notes,
    });
    regulated += 1;

    // 4. Constraint — only where the domain has an executable variant with
    //    deterministic semantics for this candidate's value.
    const materialized = materializeConstraintFor(ctx, candidate, {
      claimId,
      regulationId,
      constraintId,
    });
    if (materialized) constrained += 1;

    outcomes.push({
      candidateId: candidate.candidateId,
      predicate: candidate.predicate,
      outcome: "compiled",
      reasons: [],
      claimId,
      regulationId,
      constraintId: materialized ? constraintId : undefined,
    });
  }

  // 5. One deterministic expert-review item per BLOCKED conflict (idempotent).
  for (const conflict of conflicts) {
    if (conflict.resolution !== "blocked") continue;
    const reviewId = `phl:review:${conflict.conflictId}`;
    if (ctx.project.nodes[reviewId]) continue;
    openExpertReviewItem(ctx, {
      id: reviewId,
      kind: "expert-review",
      question: `Conflicting ${conflict.predicate} values require professional resolution`,
      whyItMatters:
        "Executable law cannot include either value until a qualified professional resolves the conflict.",
      category: "regulatory-conflict",
      affectedNodeIds: conflict.members.map((member) => member.candidateId),
      evidenceRefs: conflict.members.map((member) => member.sourceRef),
      severity: "blocking",
      reviewStatus: "OPEN",
    });
  }

  return { outcomes, conflicts, claimed, regulated, constrained };
}

function materializeConstraintFor(
  ctx: CommandContext,
  candidate: CandidateRule,
  ids: { claimId: string; regulationId: string; constraintId: string },
): boolean {
  if (ctx.project.nodes[ids.constraintId]) return true; // already materialized
  const base = {
    id: ids.constraintId,
    kind: "constraint" as const,
    regulationId: ids.regulationId,
  };
  const value = candidate.proposedValue;

  switch (candidate.predicate) {
    case "max-height":
      if (value.kind !== "quantity") return false;
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "height",
        limit: { value: value.value, unit: "ft" },
        appliesTo: "principal-structure",
      });
      return true;
    case "setback-front":
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "setback",
        face: "front",
        spec: {
          type: "contextual",
          ruleId: "adjacent-facades",
          description: "Front facade placement follows immediately adjacent / blockface buildings",
        },
      });
      return true;
    case "setback-side": {
      if (value.kind !== "quantity") return false;
      const range = sideYardRange(candidate.verbatimSupportingText);
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "setback",
        face: "side",
        spec: range
          ? { type: "range", range: { min: range.min, max: range.max, unit: "ft" } }
          : { type: "numeric", min: { value: value.value, unit: "ft" } },
      });
      return true;
    }
    case "setback-rear":
      if (value.kind !== "quantity") return false;
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "setback",
        face: "rear",
        spec: { type: "numeric", min: { value: value.value, unit: "ft" } },
      });
      return true;
    case "occupied-area": {
      if (value.kind !== "quantity") return false;
      const byLotType = occupiedAreaByLotType(candidate.verbatimSupportingText);
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "occupied-area",
        byLotType: {
          intermediate: byLotType.intermediate ?? value.value,
          corner: byLotType.corner,
        },
        unit: "percent",
      });
      return true;
    }
    case "density-formula": {
      const text = value.kind === "qualitative" ? value.text : candidate.verbatimSupportingText;
      const tiers = densityTiers(text);
      if (!tiers) return false; // cannot parse tiers -> no fake constraint
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "density",
        spec: { type: "tiered-min-lot-area-per-unit", tiers, rounding: "down" },
        notes: "Second tier applies to lot area above the first 1,440 sq ft.",
      });
      return true;
    }
    case "parking-requirement": {
      const use = candidate.applicability.use ?? "unscoped";
      if (value.kind === "quantity") {
        materializeConstraint(ctx, {
          ...base,
          constraintKind: "parking-requirement",
          use,
          requirement: { type: "fixed", spaces: { value: value.value, unit: "spaces" } },
        });
        return true;
      }
      if (value.kind === "qualitative") {
        materializeConstraint(ctx, {
          ...base,
          constraintKind: "parking-requirement",
          use,
          requirement: { type: "formula", formulaId: use, text: value.text },
        });
        return true;
      }
      return false;
    }
    case "use-permission": {
      if (value.kind !== "qualitative") return false;
      const permission = /^Y/i.test(value.text)
        ? ("BY_RIGHT" as const)
        : /^S/i.test(value.text)
          ? ("SPECIAL_EXCEPTION" as const)
          : null;
      if (!permission) return false;
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "use-permission",
        use: candidate.applicability.use ?? "unscoped",
        permission,
      });
      return true;
    }
    case "overlay-restriction": {
      if (value.kind !== "qualitative") return false;
      const overlay = candidate.applicability.overlay;
      const adu = /accessory dwelling unit/i.test(value.text) || /accessory dwelling unit/i.test(candidate.verbatimSupportingText);
      if (!overlay || !adu) return false; // no deterministic prohibits reading
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "overlay-prohibition",
        overlay,
        prohibits: "accessory-dwelling-units",
      });
      return true;
    }
    case "density-bonus": {
      if (value.kind !== "quantity") return false;
      const low = candidate.verbatimSupportingText.match(/low income:\s*(\d+)%/i);
      materializeConstraint(ctx, {
        ...base,
        constraintKind: "density-bonus",
        percentIncreaseByTier: {
          moderate: value.value,
          ...(low ? { low: Number(low[1]) } : {}),
        },
        geographicRestriction: "unknown",
      });
      return true;
    }
    default:
      // lot-width / lot-area and GIS-layer facts stay claim+regulation only
      // until #7 defines their executable participation.
      return false;
  }
}
