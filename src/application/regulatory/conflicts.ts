import type { CandidateRule } from "./candidate-rule";
import type { CanonicalVerifiedValue, VerifiedRule } from "./verified-rule";

/**
 * Conflict and currentness analysis (issue #5).
 *
 * Comparison semantics are VERIFIER-OWNED: grouping and disagreement use
 * CanonicalVerifiedValue (derived from captured evidence), never raw
 * `candidate.proposedValue` or extractor prose. Authority rank + date is
 * NOT a simplistic winner algorithm: AuthorityLevel is source authority,
 * not automatic legal precedence. Resolution reasons explicitly about
 * authority, currentness, supersession, and applicability:
 *
 *   same logical source, newer capture          -> SUPERSEDED (supersession machinery)
 *   adopted code vs older/lower source          -> lower EXCLUDED, discrepancy visible,
 *                                                  adopted stays executable if verified
 *   equal authority, incompatible, unresolved    -> BLOCKED + EXPERT_REQUIRED
 *   newer lower-authority vs adopted code        -> never silently overrides
 *
 * ABSTAINING rules (verifier could not derive executable semantics, or
 * deliberate UNKNOWN) never group as legal values — they cannot conflict
 * with, supersede, or outvote known evidence.
 *
 * Decisions are computed over sorted groups, so results are source-order
 * invariant: [55, 45] and [45, 55] decide identically.
 */

export type ConflictStatus = "EXECUTABLE" | "EXCLUDED" | "BLOCKED" | "SUPERSEDED";

export type ConflictDisposition = {
  candidateId: string;
  status: ConflictStatus;
  reasons: string[];
};

export type ConflictMember = {
  candidateId: string;
  semanticRuleKey: string;
  sourceRef: string;
  authority: CandidateRule["authority"];
  retrievedAt: string;
  valueSummary: string;
  normalizedLegalValue: string;
};

export type ConflictRecord = {
  conflictId: string;
  subjectNodeId: string;
  semanticRuleKey: string;
  predicate: string;
  members: ConflictMember[];
  resolution: "authority-resolved" | "blocked" | "superseded";
  explanation: string;
};

/** Normalized legal semantics of a VERIFIED value (verifier-owned). */
export function normalizedVerifiedLegalValue(value: CanonicalVerifiedValue): string {
  switch (value.kind) {
    case "quantity":
      return `q:${value.value} ${value.unit}`;
    case "permission":
      return `perm:${value.permission}`;
    case "prohibition":
      return `prohibits:${value.prohibits}@${value.overlay}`;
    case "parking-formula":
      return `f:${value.formula.replace(/\s+/g, " ").trim().toLowerCase()}`;
    case "density-tiers":
      return `tiers:${value.tiers.map((t) => `${t.firstSqFt}:${t.perUnit}`).join("|")}`;
    case "occupied-area-by-lot-type":
      return `occ:${value.intermediate ?? "-"}:${value.corner ?? "-"}`;
    case "side-yard-range":
      return `side:${value.min}-${value.max}`;
    case "bonus-tiers":
      return `bonus:${Object.entries(value.tiers).sort().map(([k, v]) => `${k}=${v}`).join("|")}`;
    case "contextual-setback":
      return `ctx:${value.face}:${value.ruleId}`;
    case "abstain":
      return "u:abstain";
  }
}

function valueSummary(value: CanonicalVerifiedValue): string {
  switch (value.kind) {
    case "quantity":
      return `${value.value} ${value.unit}`;
    case "permission":
      return value.permission;
    case "prohibition":
      return `${value.overlay} prohibits ${value.prohibits}`;
    case "parking-formula":
      return value.formula.slice(0, 60);
    case "density-tiers":
      return value.tiers.map((t) => `${t.perUnit}/${t.firstSqFt}`).join("+");
    case "occupied-area-by-lot-type":
      return `int ${value.intermediate ?? "?"}% / corner ${value.corner ?? "?"}%`;
    case "side-yard-range":
      return `${value.min}-${value.max} ft`;
    case "bonus-tiers":
      return Object.entries(value.tiers).map(([k, v]) => `${k} ${v}%`).join(", ");
    case "contextual-setback":
      return `contextual ${value.face}`;
    case "abstain":
      return "unknown";
  }
}

function memberOf(verified: VerifiedRule): ConflictMember {
  const candidate = verified.candidate;
  return {
    candidateId: candidate.candidateId,
    semanticRuleKey: candidate.semanticRuleKey,
    sourceRef: candidate.sourceRef,
    authority: candidate.authority,
    retrievedAt: candidate.retrievedAt,
    valueSummary: valueSummary(verified.verifiedValue),
    normalizedLegalValue: normalizedVerifiedLegalValue(verified.verifiedValue),
  };
}

/** Stable conflict id from the sorted member ids — order invariant. */
function conflictIdFor(members: VerifiedRule[]): string {
  const digest = members.map((m) => m.candidate.candidateId).sort().join("~");
  let hash = 0;
  for (let i = 0; i < digest.length; i += 1) {
    hash = (hash * 31 + digest.charCodeAt(i)) >>> 0;
  }
  return `conflict:${hash.toString(16)}`;
}

const EXECUTABLE_KINDS = new Set(["quantity", "permission", "prohibition", "parking-formula"]);

/** Abstaining values (unknown/undeducible/contextual) never conflict as numbers. */
function isConflictingValue(value: CanonicalVerifiedValue): boolean {
  return EXECUTABLE_KINDS.has(value.kind);
}

export function decideConflicts(verifiedRules: VerifiedRule[]): {
  dispositions: Map<string, ConflictDisposition>;
  conflicts: ConflictRecord[];
} {
  const dispositions = new Map<string, ConflictDisposition>();
  const conflicts: ConflictRecord[] = [];

  const groups = new Map<string, VerifiedRule[]>();
  for (const verified of verifiedRules) {
    dispositions.set(verified.candidate.candidateId, {
      candidateId: verified.candidate.candidateId,
      status: "EXECUTABLE",
      reasons: [],
    });
    const key = `${verified.candidate.jurisdictionKey}|${verified.candidate.subjectNodeId}|${verified.candidate.semanticRuleKey}`;
    const group = groups.get(key) ?? [];
    group.push(verified);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) =>
        a.candidate.sourceRef.localeCompare(b.candidate.sourceRef) ||
        a.candidate.retrievedAt.localeCompare(b.candidate.retrievedAt) ||
        a.candidate.candidateId.localeCompare(b.candidate.candidateId),
    );

    const conflicting = sorted.filter((v) => isConflictingValue(v.verifiedValue));
    const distinctValues = new Set(conflicting.map((v) => normalizedVerifiedLegalValue(v.verifiedValue)));
    if (conflicting.length < 2 || distinctValues.size < 2) continue;

    const sortedConflicting = conflicting;

    // Same logical source, different captures -> supersession by recency.
    const sourceRefs = new Set(sortedConflicting.map((v) => v.candidate.sourceRef));
    if (sourceRefs.size === 1) {
      const newest = sortedConflicting.reduce((a, b) =>
        b.candidate.retrievedAt > a.candidate.retrievedAt ? b : a,
      );
      for (const member of sortedConflicting) {
        if (member === newest) continue;
        dispositions.set(member.candidate.candidateId, {
          candidateId: member.candidate.candidateId,
          status: "SUPERSEDED",
          reasons: [
            `superseded by a newer capture of the same logical source (${member.candidate.sourceRef} at ${newest.candidate.retrievedAt})`,
          ],
        });
      }
      conflicts.push({
        conflictId: conflictIdFor(sortedConflicting),
        subjectNodeId: sortedConflicting[0].candidate.subjectNodeId,
        semanticRuleKey: sortedConflicting[0].candidate.semanticRuleKey,
        predicate: sortedConflicting[0].candidate.predicate,
        members: sortedConflicting.map(memberOf),
        resolution: "superseded",
        explanation: `Newer capture of ${sortedConflicting[0].candidate.sourceRef} supersedes the older value; supersession machinery invalidates dependents.`,
      });
      continue;
    }

    const adopted = sortedConflicting.filter((v) => v.candidate.authority === "ADOPTED_CODE");
    const adoptedValues = new Set(adopted.map((v) => normalizedVerifiedLegalValue(v.verifiedValue)));

    if (adopted.length >= 1 && adoptedValues.size === 1) {
      for (const member of sortedConflicting) {
        if (member.candidate.authority === "ADOPTED_CODE") continue;
        dispositions.set(member.candidate.candidateId, {
          candidateId: member.candidate.candidateId,
          status: "EXCLUDED",
          reasons: [
            `contradicts adopted code (${valueSummary(adopted[0].verifiedValue)} per ${adopted[0].candidate.sourceRef}); a ${member.candidate.authority} source never overrides adopted code`,
            ...(member.candidate.retrievedAt > adopted[0].candidate.retrievedAt
              ? ["newer lower-authority capture flagged for re-verification of the adopted text"]
              : []),
          ],
        });
      }
      conflicts.push({
        conflictId: conflictIdFor(sortedConflicting),
        subjectNodeId: sortedConflicting[0].candidate.subjectNodeId,
        semanticRuleKey: sortedConflicting[0].candidate.semanticRuleKey,
        predicate: sortedConflicting[0].candidate.predicate,
        members: sortedConflicting.map(memberOf),
        resolution: "authority-resolved",
        explanation: `Adopted code (${adopted[0].candidate.sourceRef}, ${valueSummary(adopted[0].verifiedValue)}) governs; the competing value is excluded from executable law but remains visible with full provenance.`,
      });
      continue;
    }

    for (const member of sortedConflicting) {
      dispositions.set(member.candidate.candidateId, {
        candidateId: member.candidate.candidateId,
        status: "BLOCKED",
        reasons: [
          `incompatible ${member.candidate.semanticRuleKey} values from sources of comparable authority (${sortedConflicting
            .map((m) => `${m.candidate.sourceRef}:${valueSummary(m.verifiedValue)}`)
            .join(", ")}); Acrevia does not pick a winner`,
        ],
      });
    }
    conflicts.push({
      conflictId: conflictIdFor(sortedConflicting),
      subjectNodeId: sortedConflicting[0].candidate.subjectNodeId,
      semanticRuleKey: sortedConflicting[0].candidate.semanticRuleKey,
      predicate: sortedConflicting[0].candidate.predicate,
      members: sortedConflicting.map(memberOf),
      resolution: "blocked",
      explanation:
        "Competing values with no reliable authority/currentness resolution; blocked from executable law pending expert review.",
    });
  }

  return { dispositions, conflicts };
}
