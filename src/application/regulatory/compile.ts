import type { CommandContext } from "../../commands";
import {
  addSourceArtifact,
  materializeConstraint,
  openExpertReviewItem,
  recordClaim,
  replaceExecutableConstraint,
  upsertRegulation,
} from "../../commands";
import { canonicalJson } from "../../domain/graph/serialization";
import { ConstraintSemantic } from "../../domain/constraints/constraint";
import type { z } from "zod";
import { stripVolatile } from "../../domain/graph/node";
import type { ClaimValue, ClaimPredicate } from "../../domain";
import type { CandidateRule } from "./candidate-rule";
import type { RawEvidenceDocument, SourceMetadata } from "./extraction";
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
/**
 * Observation identity uses the CAPTURED VERSION (sourceArtifactId), not the
 * logical sourceRef: S5@v1 and S5@v2 are distinct observations and distinct
 * claims, both retained for inspection.
 */
const CLAIM_ID = (key: string, sourceArtifactId: string) => `phl:claim:${key}:${sourceArtifactId}`;

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
    /** Raw captures, so the verifier can bind every candidate to evidence. */
    documents?: RawEvidenceDocument[];
    /**
     * Applicability proof from the accepted property's own signed GIS
     * session: the site's zoning-base and overlay claims (with their source
     * artifacts) that district- and overlay-scoped law MUST depend on.
     * Fail closed when a district-scoped rule has no base-zoning claim or an
     * overlay-scoped rule has no overlay claim.
     */
    applicabilityClaims?: {
      zoningBaseClaimId?: string;
      overlayClaimIds?: string[];
    };
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

  const verification = verifyCandidates({
    candidates: input.candidates,
    sources: input.sources,
    subject: input.subject,
    documents: input.documents ?? [],
  });
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
      sourceType: source.sourceType,
      title: source.title,
      publisher: source.publisher,
      canonicalUrl: source.canonicalUrl,
      authority: source.authority,
      retrievedAt: source.retrievedAt,
      rawContentHash: source.rawContentHash,
      // Deterministic joined representation of the backing captures.
      versionNote: source.rawEvidenceRefs.join(", "),
      ...(source.effectiveDate ? { effectiveDate: source.effectiveDate } : {}),
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
    const claimId = CLAIM_ID(candidate.semanticRuleKey, candidate.sourceArtifactId);

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
        // Canonical quote comes ONLY from the verifier-anchored capture
        // fragment — extractor commentary stays in notes and never
        // masquerades as verbatim source text.
        verbatimQuote: candidate.evidenceAnchor.exactText,
        notes: [
          candidate.verbatimSupportingText !== candidate.evidenceAnchor.exactText
            ? `extractor rendering: ${candidate.verbatimSupportingText}`
            : undefined,
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

    // Applicability proof: WHAT THE LAW SAYS + WHY IT APPLIES TO THIS
    // PARCEL. District-scoped law depends on the site's own zoning-base
    // claim; overlay-scoped law on the site's overlay claim. Fail closed
    // when the proof is missing.
    const anchor = winner ?? sortedGroup[0];
    const applicabilityClaimIds: string[] = [];
    const applicabilityProblems: string[] = [];
    const needsDistrict = Boolean(anchor.applicability.district);
    const needsOverlay = Boolean(anchor.applicability.overlay);
    if (needsDistrict) {
      const claimId = input.applicabilityClaims?.zoningBaseClaimId;
      const claim = claimId ? ctx.project.nodes[claimId] : undefined;
      const problems = claimId ? validateZoningBaseApplicability(claim, anchor, claimId) : ["missing"];
      if (problems[0] === "missing" || problems.length > 0) {
        applicabilityProblems.push(
          problems[0] === "missing"
            ? `district-scoped rule ${key} has no site zoning-base applicability claim; refusing to compile without proof the law applies to this parcel`
            : `zoning-base applicability claim rejected for rule ${key}: ${problems.join("; ")}`,
        );
      } else {
        applicabilityClaimIds.push(claimId!);
      }
    }
    if (needsOverlay) {
      const overlayClaims = input.applicabilityClaims?.overlayClaimIds ?? [];
      let proven = false;
      const overlayProblems: string[] = [];
      for (const claimId of overlayClaims) {
        const claim = ctx.project.nodes[claimId];
        const problems = validateOverlayApplicability(claim, anchor, claimId);
        if (problems.length === 0) {
          applicabilityClaimIds.push(claimId);
          proven = true;
          break;
        }
        overlayProblems.push(...problems);
      }
      if (!proven) {
        applicabilityProblems.push(
          overlayClaims.length === 0
            ? `overlay-scoped rule ${key} has no site overlay applicability claim; refusing to compile without proof the overlay applies to this parcel`
            : `overlay applicability claim rejected for rule ${key}: ${overlayProblems.join("; ")}`,
        );
      }
    }
    if (applicabilityProblems.length > 0) {
      throw new Error(applicabilityProblems.join("; "));
    }

    const desired = {
      id: REGULATION_ID(key),
      kind: "regulation" as const,
      jurisdictionKey: anchor.jurisdictionKey,
      codeSection: anchor.codeSection ?? anchor.verbatimSupportingText.slice(0, 80),
      applicability: anchor.applicability,
      claimIds: [
        ...new Set([
          ...(executableMembers.length > 0 ? executableMembers : sortedGroup)
            .map((c) => CLAIM_ID(key, c.sourceArtifactId)),
          ...applicabilityClaimIds,
        ]),
      ].sort(),
      currentness: (hasBlocked || executableMembers.length === 0 ? ("STALE" as const) : ("CURRENT" as const)),
      conflictRefs: keyConflicts.map((c) => c.conflictId),
      notes: anchor.notes,
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

/**
 * Build the desired typed constraint payload for the currently executable
 * law (or null where the domain has no variant with deterministic
 * semantics). Separated from application so the SAME payload builder serves
 * first materialization and later typed replacement.
 */
function desiredConstraintPayload(
  candidate: CandidateRule,
  ids: { regulationId: string; constraintId: string },
): z.infer<typeof ConstraintSemantic> | null {
  const base = {
    id: ids.constraintId,
    kind: "constraint" as const,
    regulationId: ids.regulationId,
  };
  const value = candidate.proposedValue;

  switch (candidate.predicate) {
    case "max-height":
      if (value.kind !== "quantity") return null;
      return {
        ...base,
        constraintKind: "height" as const,
        limit: { value: value.value, unit: "ft" as const },
        appliesTo: "principal-structure" as const,
      };
    case "setback-front":
      return {
        ...base,
        constraintKind: "setback" as const,
        face: "front" as const,
        spec: {
          type: "contextual" as const,
          ruleId: "adjacent-facades",
          description: "Front facade placement follows immediately adjacent / blockface buildings",
        },
      };
    case "setback-side": {
      if (value.kind !== "quantity") return null;
      const range = sideYardRange(candidate.verbatimSupportingText);
      return {
        ...base,
        constraintKind: "setback" as const,
        face: "side" as const,
        spec: range
          ? { type: "range" as const, range: { min: range.min, max: range.max, unit: "ft" as const } }
          : { type: "numeric" as const, min: { value: value.value, unit: "ft" as const } },
      };
    }
    case "setback-rear":
      if (value.kind !== "quantity") return null;
      return {
        ...base,
        constraintKind: "setback" as const,
        face: "rear" as const,
        spec: { type: "numeric" as const, min: { value: value.value, unit: "ft" as const } },
      };
    case "occupied-area": {
      if (value.kind !== "quantity") return null;
      const byLotType = occupiedAreaByLotType(candidate.verbatimSupportingText);
      return {
        ...base,
        constraintKind: "occupied-area" as const,
        byLotType: {
          intermediate: byLotType.intermediate ?? value.value,
          corner: byLotType.corner,
        },
        unit: "percent" as const,
      };
    }
    case "density-formula": {
      const text = value.kind === "qualitative" ? value.text : candidate.verbatimSupportingText;
      const tiers = densityTiers(text);
      if (!tiers) return null; // cannot parse tiers -> no fake constraint
      return {
        ...base,
        constraintKind: "density" as const,
        spec: { type: "tiered-min-lot-area-per-unit" as const, tiers, rounding: "down" as const },
        notes: "Second tier applies to lot area above the first 1,440 sq ft.",
      };
    }
    case "parking-requirement": {
      const use = candidate.applicability.use ?? "unscoped";
      if (value.kind === "quantity") {
        return {
          ...base,
          constraintKind: "parking-requirement" as const,
          use,
          requirement: { type: "fixed" as const, spaces: { value: value.value, unit: "spaces" as const } },
        };
      }
      if (value.kind === "qualitative") {
        return {
          ...base,
          constraintKind: "parking-requirement" as const,
          use,
          requirement: { type: "formula" as const, formulaId: use, text: value.text },
        };
      }
      return null;
    }
    case "use-permission": {
      if (value.kind !== "qualitative") return null;
      const permission = /^Y/i.test(value.text)
        ? ("BY_RIGHT" as const)
        : /^S/i.test(value.text)
          ? ("SPECIAL_EXCEPTION" as const)
          : /^N/i.test(value.text)
            ? ("PROHIBITED" as const)
            : null;
      if (!permission) return null;
      return {
        ...base,
        constraintKind: "use-permission" as const,
        use: candidate.applicability.use ?? "unscoped",
        permission,
      };
    }
    case "overlay-restriction": {
      if (value.kind !== "qualitative") return null;
      const overlay = candidate.applicability.overlay;
      const adu =
        /accessory dwelling unit/i.test(value.text) ||
        /accessory dwelling unit/i.test(candidate.verbatimSupportingText);
      if (!overlay || !adu) return null; // no deterministic prohibits reading
      return {
        ...base,
        constraintKind: "overlay-prohibition" as const,
        overlay,
        prohibits: "accessory-dwelling-units",
      };
    }
    case "density-bonus": {
      if (value.kind !== "quantity") return null;
      const low = candidate.verbatimSupportingText.match(/low income:\s*(\d+)%/i);
      return {
        ...base,
        constraintKind: "density-bonus" as const,
        percentIncreaseByTier: {
          moderate: value.value,
          ...(low ? { low: Number(low[1]) } : {}),
        },
        geographicRestriction: "unknown" as const,
      };
    }
    default:
      // lot-width / lot-area and GIS-layer facts stay claim+regulation only
      // until #7 defines their executable participation.
      return null;
  }
}

/**
 * Materialize OR replace the executable constraint for the currently
 * resolved law. First materialization uses the create-only command; a later
 * resolved change to the SAME semantic rule goes through the typed
 * replaceExecutableConstraint command — the executable law itself changes,
 * never silently serving the old value.
 */
function materializeConstraintFor(
  ctx: CommandContext,
  candidate: CandidateRule,
  ids: { regulationId: string; constraintId: string },
): boolean {
  const desired = desiredConstraintPayload(candidate, ids);
  if (!desired) return false;
  const existing = ctx.project.nodes[ids.constraintId];
  if (!existing) {
    materializeConstraint(ctx, desired);
    return true;
  }
  replaceExecutableConstraint(ctx, desired);
  return true;
}


/** Require a claim's value to canonically contain a district token. */
function claimTextOf(claim: unknown): string {
  if (!claim || typeof claim !== "object") return "";
  const value = (claim as { value?: { text?: string } }).value;
  return value?.text ?? "";
}

function sourceIdsOf(claim: unknown): string[] {
  if (!claim || typeof claim !== "object") return [];
  return (claim as { sourceIds?: string[] }).sourceIds ?? [];
}

/**
 * Validate the site's zoning-base applicability claim for a district-scoped
 * rule: kind/subject/origin/evidence/predicate, value canonically matching
 * the candidate's district, and a resolving source artifact. Returns
 * problems (empty = proven).
 */
function validateZoningBaseApplicability(
  claim: unknown,
  anchor: CandidateRule,
  claimId: string,
): string[] {
  const problems: string[] = [];
  if (!claim || typeof claim !== "object") return [`claim ${claimId} does not exist`];
  const c = claim as {
    kind?: string;
    subjectNodeId?: string;
    origin?: { kind?: string };
    evidenceState?: string;
    predicate?: string;
  };
  if (c.kind !== "claim") problems.push(`node ${claimId} is not a claim`);
  if (c.subjectNodeId !== anchor.subjectNodeId)
    problems.push(`claim subject ${c.subjectNodeId} is not this parcel (${anchor.subjectNodeId})`);
  if (c.origin?.kind !== "SOURCE_DERIVED") problems.push("origin is not SOURCE_DERIVED");
  if (c.evidenceState !== "VERIFIED" && c.evidenceState !== "SOURCE_CONFIRMED")
    problems.push(`evidence is ${c.evidenceState ?? "unset"}`);
  if (c.predicate !== "zoning-district") problems.push(`predicate is ${c.predicate}, not zoning-district`);
  const canonical = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/gi, "");
  const text = canonical(claimTextOf(claim));
  const district = canonical(anchor.applicability.district ?? "");
  if (!district || !text.includes(district)) {
    problems.push(`claim value "${claimTextOf(claim)}" does not prove district ${anchor.applicability.district}`);
  }
  const sources = sourceIdsOf(claim);
  if (sources.length === 0) problems.push("claim cites no source artifact");
  return problems;
}

/**
 * Validate the site's overlay applicability claim for an overlay-scoped
 * rule: same structural checks plus the claim value actually proving THIS
 * overlay (by canonical token containment, e.g. "/SIX" or "Sixth District").
 */
function validateOverlayApplicability(
  claim: unknown,
  anchor: CandidateRule,
  claimId: string,
): string[] {
  const structural = validateZoningBaseApplicability(claim, anchor, claimId)
    .filter((p) => !p.includes("zoning-district") && !p.includes("does not prove district"));
  const problems = [...structural];
  if (problems.some((p) => p.includes("not a claim") || p.includes("does not exist"))) return problems;
  const c = claim as { predicate?: string };
  if (c.predicate !== "zoning-overlays") problems.push(`predicate is ${c.predicate}, not zoning-overlays`);
  const overlay = anchor.applicability.overlay ?? "";
  const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const overlayToken = canonical(overlay.replace(/^\/+/, "").split(/\s+/)[0] ?? "");
  const text = canonical(claimTextOf(claim));
  if (!overlayToken || !text.includes(overlayToken)) {
    problems.push(`claim value "${claimTextOf(claim)}" does not prove overlay ${overlay}`);
  }
  return problems;
}
