import type { CandidateRule } from "./candidate-rule";

/**
 * Conflict and currentness analysis (issue #5).
 *
 * Authority rank + date is NOT a simplistic winner algorithm: AuthorityLevel
 * is source authority, not automatic legal precedence. Candidates are
 * grouped by (jurisdiction, subject, predicate, applicability, normalized
 * dimension); only groups whose QUANTITY values genuinely disagree are in
 * conflict. Then the engine reasons explicitly about authority, currentness,
 * effective/supersession, and applicability:
 *
 *   same logical source, newer capture          -> SUPERSEDED (supersession machinery)
 *   adopted code vs older/lower source          -> lower EXCLUDED, discrepancy visible,
 *                                                  adopted stays executable if verified
 *   equal authority, incompatible, unresolved    -> BLOCKED + EXPERT_REQUIRED
 *   newer lower-authority vs adopted code        -> never silently overrides
 *
 * The decision function sees the group as a sorted whole, so results are
 * source-order invariant: [55, 45] and [45, 55] decide identically.
 */

export type ConflictStatus = "EXECUTABLE" | "EXCLUDED" | "BLOCKED" | "SUPERSEDED";

export type ConflictDisposition = {
  candidateId: string;
  status: ConflictStatus;
  reasons: string[];
};

export type ConflictMember = {
  candidateId: string;
  sourceRef: string;
  authority: CandidateRule["authority"];
  retrievedAt: string;
  valueSummary: string;
};

export type ConflictRecord = {
  conflictId: string;
  subjectNodeId: string;
  predicate: string;
  members: ConflictMember[];
  resolution: "authority-resolved" | "blocked";
  explanation: string;
};

function applicabilityKey(candidate: CandidateRule): string {
  const a = candidate.applicability;
  return JSON.stringify({
    district: a.district,
    use: a.use,
    overlay: a.overlay,
    lotType: a.lotType,
  });
}

function groupKey(candidate: CandidateRule): string {
  const dimension =
    candidate.proposedValue.kind === "quantity" ? candidate.proposedValue.unit : "qualitative";
  return [
    candidate.jurisdictionKey,
    candidate.subjectNodeId,
    candidate.predicate,
    applicabilityKey(candidate),
    dimension,
  ].join("|");
}

function valueSummary(candidate: CandidateRule): string {
  const value = candidate.proposedValue;
  if (value.kind === "quantity") return `${value.value} ${value.unit}`;
  if (value.kind === "qualitative") return value.text.slice(0, 60);
  return "unknown";
}

function memberOf(candidate: CandidateRule): ConflictMember {
  return {
    candidateId: candidate.candidateId,
    sourceRef: candidate.sourceRef,
    authority: candidate.authority,
    retrievedAt: candidate.retrievedAt,
    valueSummary: valueSummary(candidate),
  };
}

/** Stable conflict id from the sorted member ids — order invariant. */
function conflictIdFor(members: CandidateRule[]): string {
  const digest = members.map((m) => m.candidateId).sort().join("~");
  let hash = 0;
  for (let i = 0; i < digest.length; i += 1) {
    hash = (hash * 31 + digest.charCodeAt(i)) >>> 0;
  }
  return `conflict:${hash.toString(16)}`;
}

export function decideConflicts(accepted: CandidateRule[]): {
  dispositions: Map<string, ConflictDisposition>;
  conflicts: ConflictRecord[];
} {
  const dispositions = new Map<string, ConflictDisposition>();
  const conflicts: ConflictRecord[] = [];

  const groups = new Map<string, CandidateRule[]>();
  for (const candidate of accepted) {
    dispositions.set(candidate.candidateId, { candidateId: candidate.candidateId, status: "EXECUTABLE", reasons: [] });
    const key = groupKey(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    // Deterministic member order inside every decision.
    const sorted = [...group].sort(
      (a, b) => a.sourceRef.localeCompare(b.sourceRef) || a.retrievedAt.localeCompare(b.retrievedAt) || a.candidateId.localeCompare(b.candidateId),
    );

    const quantities = sorted.filter((c) => c.proposedValue.kind === "quantity");
    const distinctValues = new Set(
      quantities.map((c) =>
        c.proposedValue.kind === "quantity" ? `${c.proposedValue.value} ${c.proposedValue.unit}` : "",
      ),
    );
    if (quantities.length < 2 || distinctValues.size < 2) continue; // no disagreement

    // Same logical source, different captures -> supersession by recency.
    const sourceRefs = new Set(sorted.map((c) => c.sourceRef));
    if (sourceRefs.size === 1) {
      const newest = sorted.reduce((a, b) => (b.retrievedAt > a.retrievedAt ? b : a));
      for (const member of sorted) {
        if (member === newest) continue;
        dispositions.set(member.candidateId, {
          candidateId: member.candidateId,
          status: "SUPERSEDED",
          reasons: [
            `superseded by a newer capture of the same logical source (${member.sourceRef} at ${newest.retrievedAt})`,
          ],
        });
      }
      conflicts.push({
        conflictId: conflictIdFor(sorted),
        subjectNodeId: sorted[0].subjectNodeId,
        predicate: sorted[0].predicate,
        members: sorted.map(memberOf),
        resolution: "authority-resolved",
        explanation: `Newer capture of ${sorted[0].sourceRef} supersedes the older value; supersession machinery invalidates dependents.`,
      });
      continue;
    }

    // Cross-source disagreement: does ADOPTED_CODE settle it?
    const adopted = sorted.filter((c) => c.authority === "ADOPTED_CODE");
    const adoptedValues = new Set(
      adopted.map((c) => (c.proposedValue.kind === "quantity" ? `${c.proposedValue.value} ${c.proposedValue.unit}` : "")),
    );

    if (adopted.length >= 1 && adoptedValues.size === 1) {
      // Exactly one adopted-code position: lower-authority contradictions are
      // excluded and stay visible; they never silently override the code.
      for (const member of sorted) {
        if (member.authority === "ADOPTED_CODE") continue;
        dispositions.set(member.candidateId, {
          candidateId: member.candidateId,
          status: "EXCLUDED",
          reasons: [
            `contradicts adopted code (${valueSummary(adopted[0])} per ${adopted[0].sourceRef}); a ${member.authority} source never overrides adopted code`,
            ...(member.retrievedAt > adopted[0].retrievedAt
              ? ["newer lower-authority capture flagged for re-verification of the adopted text"]
              : []),
          ],
        });
      }
      conflicts.push({
        conflictId: conflictIdFor(sorted),
        subjectNodeId: sorted[0].subjectNodeId,
        predicate: sorted[0].predicate,
        members: sorted.map(memberOf),
        resolution: "authority-resolved",
        explanation: `Adopted code (${adopted[0].sourceRef}, ${valueSummary(adopted[0])}) governs; the competing value is excluded from executable law but remains visible with full provenance.`,
      });
      continue;
    }

    // Equal-authority (or multi-position adopted) incompatibility with no
    // reliable resolution: nothing executable, expert review required.
    for (const member of sorted) {
      dispositions.set(member.candidateId, {
        candidateId: member.candidateId,
        status: "BLOCKED",
        reasons: [
          `incompatible values from sources of comparable authority (${sorted
            .map((m) => `${m.sourceRef}:${valueSummary(m)}`)
            .join(", ")}); Acrevia does not pick a winner`,
        ],
      });
    }
    conflicts.push({
      conflictId: conflictIdFor(sorted),
      subjectNodeId: sorted[0].subjectNodeId,
      predicate: sorted[0].predicate,
      members: sorted.map(memberOf),
      resolution: "blocked",
      explanation:
        "Competing values with no reliable authority/currentness resolution; blocked from executable law pending expert review.",
    });
  }

  return { dispositions, conflicts };
}
