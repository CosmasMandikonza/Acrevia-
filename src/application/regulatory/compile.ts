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
import { stripVolatile } from "../../domain/graph/node";
import type { ClaimValue, ClaimPredicate } from "../../domain";
import type { CandidateRule } from "./candidate-rule";
import type { RawEvidenceDocument, SourceMetadata } from "./extraction";
import { decideConflicts, type ConflictRecord } from "./conflicts";
import type { VerificationDecision } from "./verify";
import { verifyCandidates } from "./verify";
import type { CanonicalVerifiedValue, VerifiedRule } from "./verified-rule";

/**
 * Canonical graph compilation (issue #5): verified, conflict-resolved rules
 * become Claim -> Regulation -> Constraint through the TYPED COMMAND
 * BOUNDARY. Nothing here writes project.nodes directly.
 *
 * ALL executable semantics are VERIFIER-OWNED: every value consumed below —
 * Claim.value, conflict comparison (in decideConflicts), Regulation
 * meaning, and the constraint payload — derives from
 * VerifiedRule.verifiedValue, which the second pass independently derived
 * from captured evidence. Raw candidate.proposedValue /
 * verbatimSupportingText never influence anything downstream.
 *
 * IDENTITY: candidateId/claimId are unique EVIDENCE OBSERVATIONS keyed by
 * the CAPTURED VERSION (`<semanticRuleKey>:<sourceArtifactId>`);
 * regulationId/constraintId are the SEMANTIC LEGAL RULE
 * (`<semanticRuleKey>`). Duplicate candidate ids are rejected loudly.
 *
 * ABSTENTION: rules whose semantics the verifier could not derive (FAR and
 * other unknowns) stay Claim-only — no Regulation, no Constraint, no
 * grouping as a legal value.
 *
 * IDEMPOTENCY (true): source artifacts always replay through
 * addSourceArtifact so its immutability guard verifies exact replay;
 * claims/constraints/reviews are create-only with deterministic ids;
 * regulations are grouped ONE per semanticRuleKey and an exact semantic
 * replay is SKIPPED — re-compiling identical evidence runs zero commands.
 *
 * CONFLICT LIFECYCLE: a previously-executable rule whose later evidence
 * conflicts irreducibly keeps its constraint for audit, the regulation is
 * upserted to currentness STALE with conflictRefs, the solver gate excludes
 * it, and a deterministic expert review is opened whose affectedNodeIds
 * reference REAL graph nodes.
 */

export type CandidateOutcome = {
  candidateId: string;
  semanticRuleKey: string;
  predicate: ClaimPredicate;
  outcome: "compiled" | "unknown-recorded" | "conflict-recorded" | "rejected" | "abstained";
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
const CLAIM_ID = (key: string, sourceArtifactId: string) => `phl:claim:${key}:${sourceArtifactId}`;

/** Canonical Claim.value from the VERIFIER-OWNED semantics. */
function claimValueFromVerified(verified: VerifiedRule): ClaimValue {
  const value = verified.verifiedValue;
  switch (value.kind) {
    case "quantity":
      return { type: "quantity", quantity: { value: value.value, unit: value.unit as never } };
    case "permission":
      return { type: "qualitative", text: value.permission };
    case "prohibition":
      return { type: "qualitative", text: `${value.overlay} prohibits ${value.prohibits}` };
    case "parking-formula":
      return { type: "qualitative", text: value.formula };
    case "density-tiers":
      return {
        type: "qualitative",
        text: `Tiered minimum lot area per dwelling unit: ${value.tiers
          .map((t) => `${t.perUnit} sq ft per unit at ${t.firstSqFt} sq ft`)
          .join("; ")}`,
      };
    case "occupied-area-by-lot-type":
      return {
        type: "qualitative",
        text: `Max occupied area — intermediate ${value.intermediate ?? "?"}%; corner ${value.corner ?? "?"}%`,
      };
    case "side-yard-range":
      return { type: "quantity", quantity: { value: value.min, unit: "ft" as never } };
    case "bonus-tiers":
      return {
        type: "qualitative",
        text: `Density bonus tiers: ${Object.entries(value.tiers)
          .map(([k, v]) => `${k} ${v}%`)
          .join(", ")}`,
      };
    case "contextual-setback":
      return { type: "null", reason: "formula-only" };
    case "abstain":
      return { type: "null", reason: "unknown" };
  }
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

  // Source artifacts ALWAYS replay through the command so its immutability
  // guard verifies exact content — real hashes, never fabricated.
  const usedSources = new Set(
    input.candidates
      .filter((c) => verification.find((d) => d.candidate.candidateId === c.candidateId)?.status === "ACCEPT")
      .map((c) => c.sourceArtifactId),
  );
  for (const source of input.sources) {
    if (!usedSources.has(source.sourceArtifactId)) continue;
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
      versionNote: source.rawEvidenceRefs.join(", "),
      ...(source.rawEvidenceRefs.length === 1 ? { rawEvidenceRef: source.rawEvidenceRefs[0] } : {}),
      ...(source.effectiveDate ? { effectiveDate: source.effectiveDate } : {}),
    });
  }


  // Only ACCEPT + verifier-owned semantics proceed. ABSTAINING rules stay
  // Claim-only; UNKNOWN rules stay Claim-only — neither groups as a legal
  // value nor materializes a Regulation.
  const verifiedRules: VerifiedRule[] = [];
  const outcomes: CandidateOutcome[] = [];
  for (const decision of verification) {
    const candidate = decision.candidate;
    const claimId = CLAIM_ID(candidate.semanticRuleKey, candidate.sourceArtifactId);
    if (decision.status === "REJECT") {
      outcomes.push({
        candidateId: candidate.candidateId,
        semanticRuleKey: candidate.semanticRuleKey,
        predicate: candidate.predicate,
        outcome: "rejected",
        reasons: decision.reasons,
      });
      continue;
    }
    const verified = decision.verified;
    if (!verified || verified.verifiedValue.kind === "abstain") {
      const isUnknown = candidate.proposedValue.kind === "unknown";
      outcomes.push({
        candidateId: candidate.candidateId,
        semanticRuleKey: candidate.semanticRuleKey,
        predicate: candidate.predicate,
        outcome: isUnknown ? "unknown-recorded" : "abstained",
        reasons: verified
          ? [verified.verifiedValue.kind === "abstain" ? verified.verifiedValue.reason : "abstained"]
          : ["no verifier-owned semantics"],
      });
      // ABSTAIN path: record the sourced Claim (create-only) and STOP —
      // no Regulation, no Constraint, no conflict participation.
      recordAbstainingClaim(ctx, verified ?? null, decision, claimId);
      continue;
    }
    verifiedRules.push(verified);
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

  const { dispositions, conflicts } = decideConflicts(verifiedRules);
  const conflictsByKey = new Map<string, ConflictRecord[]>();
  for (const conflict of conflicts) {
    const list = conflictsByKey.get(conflict.semanticRuleKey) ?? [];
    list.push(conflict);
    list.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
    conflictsByKey.set(conflict.semanticRuleKey, list);
  }

  // Demote outcomes whose dispositions lost.
  for (const verified of verifiedRules) {
    const disposition = dispositions.get(verified.candidate.candidateId);
    if (disposition && disposition.status !== "EXECUTABLE") {
      const outcome = outcomes.find((o) => o.candidateId === verified.candidate.candidateId);
      if (outcome) {
        outcome.outcome = "conflict-recorded";
        outcome.reasons = disposition.reasons;
        outcome.constraintId = undefined;
      }
    }
  }

  const sourceById = new Map<string, SourceMetadata>();
  for (const source of input.sources) {
    sourceById.set(source.sourceArtifactId, source);
  }

  let claimed = 0;
  let regulated = 0;
  let constrained = 0;

  // Verified claims (executable or conflict-visible) — create-only.
  for (const verified of verifiedRules) {
    const candidate = verified.candidate;
    const claimId = CLAIM_ID(candidate.semanticRuleKey, candidate.sourceArtifactId);
    if (ctx.project.nodes[claimId]) continue;
    const disposition = dispositions.get(candidate.candidateId);
    const evidence =
      disposition?.status !== "EXECUTABLE" && disposition !== undefined
        ? "CONFLICT"
        : candidate.authority === "ADOPTED_CODE"
          ? "VERIFIED"
          : "SOURCE_CONFIRMED";
    recordClaim(ctx, {
      id: claimId,
      kind: "claim",
      subjectNodeId: candidate.subjectNodeId,
      predicate: candidate.predicate,
      value: claimValueFromVerified(verified),
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [candidate.sourceArtifactId],
      evidenceState: evidence,
      // Canonical quote: the verifier-anchored capture fragment ONLY.
      verbatimQuote: verified.verifiedExcerpt,
      notes: [
        candidate.verbatimSupportingText !== verified.verifiedExcerpt
          ? `extractor rendering: ${candidate.verbatimSupportingText}`
          : undefined,
        candidate.notes,
        verified.verifiedLocator ? `locator: ${verified.verifiedLocator}` : undefined,
        `retrievedAt: ${candidate.retrievedAt}`,
        `extraction: ${candidate.extractionMethod}`,
        ...(verified.verificationNotes ?? []),
        ...(disposition && disposition.status !== "EXECUTABLE"
          ? [`conflict: ${disposition.reasons.join("; ")}`]
          : []),
      ]
        .filter(Boolean)
        .join(" | "),
    });
    claimed += 1;
  }

  // ONE regulation per semanticRuleKey over VERIFIED semantics; exact
  // semantic replay skipped (TRUE idempotency).
  const groups = new Map<string, VerifiedRule[]>();
  for (const verified of verifiedRules) {
    const list = groups.get(verified.candidate.semanticRuleKey) ?? [];
    list.push(verified);
    groups.set(verified.candidate.semanticRuleKey, list);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    const sortedGroup = [...group].sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId));
    const keyConflicts = conflictsByKey.get(key) ?? [];
    const hasBlocked = keyConflicts.some((c) => c.resolution === "blocked");
    const executableMembers = sortedGroup.filter(
      (v) => dispositions.get(v.candidate.candidateId)?.status === "EXECUTABLE",
    );
    const winner = executableMembers[0];
    const anchor = winner ?? sortedGroup[0];

    // Applicability proof: WHAT THE LAW SAYS + WHY IT APPLIES TO THIS
    // PARCEL — semantically validated, fail closed.
    const applicabilityClaimIds: string[] = [];
    const applicabilityProblems: string[] = [];
    const needsDistrict = Boolean(anchor.candidate.applicability.district);
    const needsOverlay = Boolean(anchor.candidate.applicability.overlay);
    if (needsDistrict) {
      const claimId = input.applicabilityClaims?.zoningBaseClaimId;
      const claim = claimId ? ctx.project.nodes[claimId] : undefined;
      const problems = claimId ? validateZoningBaseApplicability(claim, anchor.candidate, claimId, ctx) : ["missing"];
      if (problems.length > 0) {
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
        const problems = validateOverlayApplicability(claim, anchor.candidate, claimId, ctx);
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
      jurisdictionKey: anchor.candidate.jurisdictionKey,
      codeSection: anchor.verifiedLocator,
      applicability: anchor.candidate.applicability,
      claimIds: [
        ...new Set([
          ...(executableMembers.length > 0 ? executableMembers : sortedGroup)
            .map((v) => CLAIM_ID(key, v.candidate.sourceArtifactId)),
          ...applicabilityClaimIds,
        ]),
      ].sort(),
      currentness: (hasBlocked || executableMembers.length === 0 ? ("STALE" as const) : ("CURRENT" as const)),
      conflictRefs: keyConflicts.map((c) => c.conflictId),
      notes: anchor.candidate.notes,
    };

    const existing = ctx.project.nodes[desired.id];
    if (existing && existing.kind === "regulation" && semanticEquals(existing, desired)) {
      continue; // exact semantic replay — no command runs
    }
    upsertRegulation(ctx, desired);
    regulated += 1;

    // Constraint from VERIFIER-OWNED semantics only.
    if (winner && !hasBlocked) {
      const materialized = materializeVerifiedConstraint(ctx, winner, {
        regulationId: REGULATION_ID(key),
        constraintId: CONSTRAINT_ID(key),
      });
      if (materialized) constrained += 1;
    }

    if (hasBlocked) {
      const conflict = keyConflicts.find((c) => c.resolution === "blocked")!;
      const reviewId = `phl:review:${conflict.conflictId}`;
      if (!ctx.project.nodes[reviewId]) {
        const affected = [
          ...desired.claimIds,
          desired.id,
          ...sortedGroup.map((v) => v.candidate.sourceArtifactId),
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
          evidenceRefs: sortedGroup.map((v) => v.candidate.sourceRef).sort(),
          severity: "blocking",
          reviewStatus: "OPEN",
        });
      }
    }
  }

  return { outcomes, conflicts, claimed, regulated, constrained };
}

/** Record the sourced Claim for abstaining/unknown rules — nothing more. */
function recordAbstainingClaim(
  ctx: CommandContext,
  verified: VerifiedRule | null,
  decision: VerificationDecision,
  claimId: string,
): void {
  if (ctx.project.nodes[claimId]) return;
  const candidate = decision.candidate;
  const isUnknown = candidate.proposedValue.kind === "unknown";
  recordClaim(ctx, {
    id: claimId,
    kind: "claim",
    subjectNodeId: candidate.subjectNodeId,
    predicate: candidate.predicate,
    value: verified ? claimValueFromVerified(verified) : { type: "null", reason: "unknown" },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: [candidate.sourceArtifactId],
    evidenceState: isUnknown ? "UNKNOWN" : "UNKNOWN",
    verbatimQuote: verified ? verified.verifiedExcerpt : candidate.evidenceAnchor.exactText,
    notes: [
      candidate.notes,
      candidate.codeSection ? `locator: ${candidate.codeSection}` : undefined,
      `retrievedAt: ${candidate.retrievedAt}`,
      `extraction: ${candidate.extractionMethod}`,
      "no executable semantics derivable from captured evidence; claim-only by design",
    ]
      .filter(Boolean)
      .join(" | "),
  });
}

/** Constraint payload built ONLY from verifier-owned semantics. */
function materializeVerifiedConstraint(
  ctx: CommandContext,
  verified: VerifiedRule,
  ids: { regulationId: string; constraintId: string },
): boolean {
  const payload = verifiedConstraintPayload(verified, ids);
  if (!payload) return false;
  const existing = ctx.project.nodes[ids.constraintId];
  if (!existing) {
    materializeConstraint(ctx, payload);
    return true;
  }
  replaceExecutableConstraint(ctx, payload);
  return true;
}

function verifiedConstraintPayload(
  verified: VerifiedRule,
  ids: { regulationId: string; constraintId: string },
): Parameters<typeof materializeConstraint>[1] | null {
  const base = {
    id: ids.constraintId,
    kind: "constraint" as const,
    regulationId: ids.regulationId,
  };
  const value: CanonicalVerifiedValue = verified.verifiedValue;
  const candidate = verified.candidate;

  switch (value.kind) {
    case "quantity":
      switch (candidate.predicate) {
        case "max-height":
          return {
            ...base,
            constraintKind: "height",
            limit: { value: value.value, unit: "ft" },
            appliesTo: "principal-structure",
          };
        case "setback-rear":
          return {
            ...base,
            constraintKind: "setback",
            face: "rear",
            spec: { type: "numeric", min: { value: value.value, unit: "ft" } },
          };
        case "parking-requirement":
          return {
            ...base,
            constraintKind: "parking-requirement",
            use: candidate.applicability.use ?? "unscoped",
            requirement: { type: "fixed", spaces: { value: value.value, unit: "spaces" } },
          };
        default:
          return null;
      }
    case "permission":
      return {
        ...base,
        constraintKind: "use-permission",
        use: candidate.applicability.use ?? "unscoped",
        permission: value.permission,
      };
    case "prohibition":
      return {
        ...base,
        constraintKind: "overlay-prohibition",
        overlay: value.overlay,
        prohibits: value.prohibits,
      };
    case "parking-formula":
      return {
        ...base,
        constraintKind: "parking-requirement",
        use: value.use,
        requirement: { type: "formula", formulaId: value.use, text: value.formula },
      };
    case "density-tiers":
      return {
        ...base,
        constraintKind: "density",
        spec: { type: "tiered-min-lot-area-per-unit", tiers: value.tiers, rounding: "down" },
        notes: "Second tier applies to lot area above the first breakpoint.",
      };
    case "occupied-area-by-lot-type":
      if (value.intermediate === undefined) return null;
      return {
        ...base,
        constraintKind: "occupied-area",
        byLotType: { intermediate: value.intermediate, corner: value.corner },
        unit: "percent",
      };
    case "side-yard-range":
      return {
        ...base,
        constraintKind: "setback",
        face: "side",
        spec: { type: "range", range: { min: value.min, max: value.max, unit: "ft" } },
      };
    case "bonus-tiers":
      return {
        ...base,
        constraintKind: "density-bonus",
        percentIncreaseByTier: value.tiers,
        geographicRestriction: "unknown",
      };
    case "contextual-setback":
      return {
        ...base,
        constraintKind: "setback",
        face: "front",
        spec: {
          type: "contextual",
          ruleId: value.ruleId,
          description: "Front facade placement follows blockface geometry (guide notes [5],[6])",
        },
      };
    case "abstain":
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Applicability-claim validation (fail closed, semantically)
// ---------------------------------------------------------------------------

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
 * the candidate's district, and EVERY cited source resolving to a
 * non-superseded source artifact in the current project.
 */
function validateZoningBaseApplicability(
  claim: unknown,
  anchor: CandidateRule,
  claimId: string,
  ctx: CommandContext,
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
  const canonical = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/gi, "");
  const text = canonical(claimTextOf(claim));
  const district = canonical(anchor.applicability.district ?? "");
  if (!district || !text.includes(district)) {
    problems.push(`claim value "${claimTextOf(claim)}" does not prove district ${anchor.applicability.district}`);
  }
  const sources = sourceIdsOf(claim);
  if (sources.length === 0) problems.push("claim cites no source artifact");
  for (const sourceId of sources) {
    const source = ctx.project.nodes[sourceId];
    if (!source || source.kind !== "source-artifact") {
      problems.push(`cited source ${sourceId} does not resolve to a source artifact`);
    } else if (source.supersededBy) {
      problems.push(`cited source ${sourceId} is already superseded`);
    }
  }
  return problems;
}

function validateOverlayApplicability(
  claim: unknown,
  anchor: CandidateRule,
  claimId: string,
  ctx: CommandContext,
): string[] {
  const structural = validateZoningBaseApplicability(claim, anchor, claimId, ctx)
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
