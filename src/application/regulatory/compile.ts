import type { CommandContext } from "../../commands";
import {
  addSourceArtifact,
  materializeConstraint,
  openExpertReviewItem,
  recordClaim,
  upsertRegulation,
} from "../../commands";
import { canonicalJson } from "../../domain/graph/serialization";
import { stripVolatile } from "../../domain/graph/node";
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
 * IDENTITY: candidateId/claimId are unique EVIDENCE OBSERVATIONS
 * (`<semanticRuleKey>:<sourceRef>`); regulationId/constraintId are the
 * SEMANTIC LEGAL RULE (`<semanticRuleKey>`). Different propositions never
 * collapse; duplicate candidate ids are rejected loudly.
 *
 * IDEMPOTENCY (true): source artifacts always replay through
 * addSourceArtifact so its immutability guard verifies exact replay; claims/
 * constraints/reviews are create-only with deterministic ids; regulations
 * are grouped ONE per semanticRuleKey and an exact semantic replay is
 * SKIPPED — re-compiling identical evidence runs zero commands (revision,
 * events, edges, semantic hashes, and encoded state all unchanged).
 *
 * CONFLICT LIFECYCLE: a previously-executable rule whose later evidence
 * conflicts irreducibly keeps its constraint for audit, but the regulation
 * is upserted to currentness STALE with conflictRefs, the solver gate
 * excludes it, and a deterministic expert review is opened whose
 * affectedNodeIds reference REAL graph nodes (claims, regulation, sources,
 * constraint) — never CandidateRule ids.
 *
 * No uncited regulation enters the solver: only ACCEPT + EXECUTABLE
 * candidates reach materializeConstraint, and the executable gate
 * independently re-verifies the full chain.
 */

export type CandidateOutcome = {
  candidateId: string;
  semanticRuleKey: string;
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

const REGULATION_ID = (key: string) => `phl:reg:${key}`;
const CONSTRAINT_ID = (key: string) => `phl:constraint:${key}`;
const CLAIM_ID = (key: string, sourceRef: string) => `phl:claim:${key}:${sourceRef}`;

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

/** Semantic-equality helper: compare stripped-volatile canonical JSON. */
function semanticEquals(a: unknown, b: unknown): boolean {
  return canonicalJson(stripVolatile(a)) === canonicalJson(stripVolatile(b));
}

export function compileRegulations(
  ctx: CommandContext,
  input: {
    candidates: CandidateRule[];
    sources: SourceMetadata[];
    subject: { district?: string };
  },
): CompileResult {
  // HARD duplicate-candidate check — evidence observations are unique.
  const seenCandidateIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (seenCandidateIds.has(candidate.candidateId)) {
      throw new Error(`duplicate CandidateRule id: ${candidate.candidateId} (evidence observations must be unique)`);
    }
    seenCandidateIds.add(candidate.candidateId);
  }

  const verification = verifyCandidates(input);
  const accepted = verification
    .filter((decision) => decision.status === "ACCEPT")
    .map((decision) => decision.candidate);
  const { dispositions, conflicts } = decideConflicts(accepted);
  const conflictsByKey = new Map<string, ConflictRecord[]>();
  for (const conflict of conflicts) {
    const list = conflictsByKey.get(conflict.semanticRuleKey) ?? [];
    list.push(conflict);
    list.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
    conflictsByKey.set(conflict.semanticRuleKey, list);
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

  // Source artifacts ALWAYS replay through the command so its immutability
  // guard verifies exact content — real hashes, never fabricated.
  const usedSources = new Set(ordered.filter((c) => accepted.includes(c)).map((c) => c.sourceRef));
  for (const source of input.sources) {
    if (!usedSources.has(source.sourceRef)) continue;
    addSourceArtifact(ctx, {
      id: source.sourceArtifactId,
      kind: "source-artifact",
      logicalSourceKey: source.logicalSourceKey,
      version: source.version,
      sourceType: source.sourceType as never,
      title: source.title,
      publisher: source.publisher,
      canonicalUrl: source.canonicalUrl,
      authority: source.authority,
      retrievedAt: source.retrievedAt,
      rawContentHash: source.rawContentHash,
    });
  }

  // Group accepted candidates by semantic rule for ONE regulation per rule.
  const groups = new Map<string, CandidateRule[]>();
  for (const candidate of accepted) {
    const list = groups.get(candidate.semanticRuleKey) ?? [];
    list.push(candidate);
    groups.set(candidate.semanticRuleKey, list);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  for (const candidate of ordered) {
    const decision = verification.find((d) => d.candidate.candidateId === candidate.candidateId);
    const disposition = dispositions.get(candidate.candidateId);
    const claimId = CLAIM_ID(candidate.semanticRuleKey, candidate.sourceRef);

    if (decision?.status === "REJECT") {
      outcomes.push({
        candidateId: candidate.candidateId,
        semanticRuleKey: candidate.semanticRuleKey,
        predicate: candidate.predicate,
        outcome: "rejected",
        reasons: decision.reasons,
      });
      continue;
    }

    // Claim — create-only; skip when the compiler already recorded it.
    const conflictReasons = disposition && disposition.status !== "EXECUTABLE" ? disposition.reasons : [];
    if (!ctx.project.nodes[claimId]) {
      const evidence =
        candidate.proposedValue.kind === "unknown"
          ? "UNKNOWN"
          : disposition?.status !== "EXECUTABLE" && disposition !== undefined
            ? "CONFLICT"
            : candidate.authority === "ADOPTED_CODE"
              ? "VERIFIED"
              : "SOURCE_CONFIRMED";
      recordClaim(ctx, {
        id: claimId,
        kind: "claim",
        subjectNodeId: candidate.subjectNodeId,
        predicate: candidate.predicate,
        value: claimValueFor(candidate),
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [candidate.sourceArtifactId],
        evidenceState: evidence,
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

    if (candidate.proposedValue.kind === "unknown") {
      outcomes.push({
        candidateId: candidate.candidateId,
        semanticRuleKey: candidate.semanticRuleKey,
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
        semanticRuleKey: candidate.semanticRuleKey,
        predicate: candidate.predicate,
        outcome: "conflict-recorded",
        reasons: conflictReasons,
        claimId,
      });
      // continue — regulation handling is per-GROUP below.
      continue;
    }
    outcomes.push({
      candidateId: candidate.candidateId,
      semanticRuleKey: candidate.semanticRuleKey,
      predicate: candidate.predicate,
      outcome: "compiled",
      reasons: [],
      claimId,
      regulationId: REGULATION_ID(candidate.semanticRuleKey),
      constraintId: CONSTRAINT_ID(candidate.semanticRuleKey),
    });
  }

  // ONE regulation per semanticRuleKey, desired-state computed then skipped
  // when semantically identical to the existing node (TRUE idempotency).
  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    const sortedGroup = [...group].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    const keyConflicts = conflictsByKey.get(key) ?? [];
    const hasBlocked = keyConflicts.some((c) => c.resolution === "blocked");
    const executableMembers = sortedGroup.filter(
      (c) => dispositions.get(c.candidateId)?.status === "EXECUTABLE",
    );
    const winner = executableMembers[0];

    const desired = {
      id: REGULATION_ID(key),
      kind: "regulation" as const,
      jurisdictionKey: (winner ?? sortedGroup[0]).jurisdictionKey,
      codeSection: (winner ?? sortedGroup[0]).codeSection ?? (winner ?? sortedGroup[0]).verbatimSupportingText.slice(0, 80),
      applicability: (winner ?? sortedGroup[0]).applicability,
      claimIds: (executableMembers.length > 0 ? executableMembers : sortedGroup)
        .map((c) => CLAIM_ID(key, c.sourceRef))
        .sort(),
      currentness: (hasBlocked || executableMembers.length === 0 ? ("STALE" as const) : ("CURRENT" as const)),
      conflictRefs: keyConflicts.map((c) => c.conflictId),
      notes: (winner ?? sortedGroup[0]).notes,
    };

    const existing = ctx.project.nodes[desired.id];
    if (existing && existing.kind === "regulation" && semanticEquals(existing, desired)) {
      // Exact semantic replay — skip; no revision/event/edge movement.
      continue;
    }
    upsertRegulation(ctx, desired);
    regulated += 1;

    // Constraint — only where an executable winner exists AND the domain has
    // a variant with deterministic semantics for this candidate's value.
    if (winner && !hasBlocked) {
      const materialized = materializeConstraintFor(ctx, winner, {
        regulationId: REGULATION_ID(key),
        constraintId: CONSTRAINT_ID(key),
      });
      if (materialized) constrained += 1;
    }

    // Deterministic expert review per BLOCKED conflict, referencing REAL
    // graph nodes only (claims, regulation, sources, constraint if present).
    if (hasBlocked) {
      const conflict = keyConflicts.find((c) => c.resolution === "blocked")!;
      const reviewId = `phl:review:${conflict.conflictId}`;
      if (!ctx.project.nodes[reviewId]) {
        const affected = [
          ...desired.claimIds,
          desired.id,
          ...sortedGroup.map((c) => c.sourceArtifactId),
          ...(ctx.project.nodes[CONSTRAINT_ID(key)] ? [CONSTRAINT_ID(key)] : []),
        ].sort();
        openExpertReviewItem(ctx, {
          id: reviewId,
          kind: "expert-review",
          question: conflict.explanation,
          whyItMatters:
            "Executable law cannot include this rule until a qualified professional resolves the conflict.",
          category: "regulatory-conflict",
          affectedNodeIds: affected,
          evidenceRefs: sortedGroup.map((c) => c.sourceRef).sort(),
          severity: "blocking",
          reviewStatus: "OPEN",
        });
      }
    }
  }

  return { outcomes, conflicts, claimed, regulated, constrained };
}

function materializeConstraintFor(
  ctx: CommandContext,
  candidate: CandidateRule,
  ids: { regulationId: string; constraintId: string },
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
          : /^N/i.test(value.text)
            ? ("PROHIBITED" as const)
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
      const adu =
        /accessory dwelling unit/i.test(value.text) ||
        /accessory dwelling unit/i.test(candidate.verbatimSupportingText);
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
