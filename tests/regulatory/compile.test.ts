import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileRegulations } from "../../src/application/regulatory/compile";
import { selectExecutableConstraints } from "../../src/application/regulatory/executable";
import { verifyCandidates } from "../../src/application/regulatory/verify";
import { decideConflicts } from "../../src/application/regulatory/conflicts";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import { normalizeFeet } from "../../src/application/regulatory/normalize";
import { contextFor } from "../domain/helpers";
import type { Project } from "../../src/domain/graph/project";

/**
 * Compiler pipeline tests (issue #5): deterministic verification, conflict
 * analysis, canonical compilation, and the executable solver gate — including
 * the hero adversarial case (older favorable 55 ft vs newer authoritative
 * adopted 45 ft) driven from the first-class fixture under
 * docs/benchmarks/adversarial/height-conflict/.
 */

const ADVERSARIAL_DIR = join(import.meta.dirname, "../../docs/benchmarks/adversarial/height-conflict");
const PARCEL = "phl:parcel:778273000";

function bareProject(): Project {
  return {
    projectId: "test:regulatory",
    revision: 0,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    nodes: {
      [PARCEL]: {
        id: PARCEL,
        kind: "parcel",
        parcelIdSystem: "test",
        parcelNumber: "778273000",
        geometry: {
          geojson: {
            type: "Polygon",
            coordinates: [
              [
                [-75.056, 40.043],
                [-75.055, 40.043],
                [-75.055, 40.044],
                [-75.056, 40.044],
                [-75.056, 40.043],
              ],
            ],
          },
          crs: "EPSG:4326",
          validity: "unchecked",
          derived: false,
        },
        claimIds: [],
        meta: { revision: 1, semanticHash: "x", createdAt: "2026-10-08T00:00:00.000Z", lastModifiedAt: "2026-10-08T00:00:00.000Z" },
      },
    },
    edges: [],
    events: [],
  } as unknown as Project;
}

const TEST_SOURCES = [
  {
    sourceRef: "S5",
    title: "Quick Guide",
    publisher: "City Planning Commission",
    canonicalUrl: "https://test.example/guide",
    authority: "OFFICIAL_CITY_REFERENCE" as const,
    retrievedAt: "2026-10-04T03:55:00Z",
  },
  {
    sourceRef: "S7",
    title: "Adopted Code",
    publisher: "City",
    canonicalUrl: "https://test.example/code",
    authority: "ADOPTED_CODE" as const,
    retrievedAt: "2026-10-04T04:21:00Z",
  },
  {
    sourceRef: "A1",
    title: "Older favorable planning memo",
    publisher: "Test City Planning Commission",
    canonicalUrl: "https://test.example/older-planning-memo",
    authority: "OFFICIAL_CITY_REFERENCE" as const,
    retrievedAt: "2025-01-15T00:00:00Z",
  },
  {
    sourceRef: "A2",
    title: "Current adopted code",
    publisher: "Test City, codified",
    canonicalUrl: "https://test.example/adopted-code-14-999",
    authority: "ADOPTED_CODE" as const,
    retrievedAt: "2026-06-01T00:00:00Z",
  },
];

function heightCandidate(sourceRef: string, feet: number, overrides: Partial<CandidateRule> = {}): CandidateRule {
  return {
    candidateId: `cand:max-height:${sourceRef}`,
    sourceArtifactId: `phl:src:${sourceRef}@v1`,
    sourceRef,
    subjectNodeId: PARCEL,
    jurisdictionKey: "philadelphia-pa",
    predicate: "max-height",
    proposedValue: { kind: "quantity", value: feet, unit: "ft" },
    applicability: { district: "RM-1" },
    codeSection: "§ test-1",
    verbatimSupportingText: `maximum building height ... ${feet} ft`,
    authority: sourceRef === "A2" || sourceRef === "S7" ? "ADOPTED_CODE" : "OFFICIAL_CITY_REFERENCE",
    retrievedAt: TEST_SOURCES.find((s) => s.sourceRef === sourceRef)?.retrievedAt ?? "2026-01-01T00:00:00Z",
    extractionMethod: "test",
    ...overrides,
  };
}

/** Parse the adversarial fixture captures into candidates (deterministic). */
function adversarialHeightCandidates(): CandidateRule[] {
  const older = readFileSync(join(ADVERSARIAL_DIR, "older-favorable-height.md"), "utf-8");
  const newer = readFileSync(join(ADVERSARIAL_DIR, "newer-adopted-height.md"), "utf-8");
  const olderFeet = normalizeFeet(older.match(/maximum building height[^]*?(\d+)\s*ft/i)?.[0] ?? "");
  const newerFeet = normalizeFeet(newer.match(/maximum building height is[^]*?(\d+)\s*ft/i)?.[0] ?? "");
  if (!olderFeet || !newerFeet) throw new Error("adversarial fixture failed to parse");
  return [
    heightCandidate("A1", olderFeet.value, {
      verbatimSupportingText: "Maximum building height in the RM-1 district: 55 ft.",
    }),
    heightCandidate("A2", newerFeet.value, {
      verbatimSupportingText: "(.1) In the RM-1 zoning district, the maximum building height is 45 ft.",
    }),
  ];
}

describe("verification (candidate -> accepted/rejected)", () => {
  it("rejects a candidate whose sourceRef is not in the manifest (hallucinated citation)", () => {
    const decisions = verifyCandidates({
      candidates: [heightCandidate("S99", 38)],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });
    expect(decisions[0].status).toBe("REJECT");
    expect(decisions[0].reasons.join(" ")).toContain("does not resolve");
  });

  it("rejects missing supporting quote and missing locator for regulatory rules", () => {
    const noQuote = heightCandidate("S5", 38, { verbatimSupportingText: "   " });
    const noSection = heightCandidate("S5", 38, { codeSection: undefined });
    const decisions = verifyCandidates({
      candidates: [noQuote, noSection],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });
    expect(decisions[0].status).toBe("REJECT");
    expect(decisions[0].reasons.join(" ")).toContain("supporting text");
    expect(decisions[1].status).toBe("REJECT");
    expect(decisions[1].reasons.join(" ")).toContain("locator");
  });

  it("rejects malformed quantities (0 height) and incompatible districts", () => {
    const zero = heightCandidate("S5", 0);
    const wrongDistrict = heightCandidate("S5", 38, { applicability: { district: "RSA-5" } });
    const decisions = verifyCandidates({
      candidates: [zero, wrongDistrict],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });
    expect(decisions[0].status).toBe("REJECT");
    expect(decisions[0].reasons.join(" ")).toContain("greater than 0");
    expect(decisions[1].status).toBe("REJECT");
    expect(decisions[1].reasons.join(" ")).toContain("not the subject district");
  });
});

describe("conflict engine (order-invariant, authority-aware)", () => {
  it("HERO: older favorable 55 ft loses to newer authoritative adopted 45 ft", () => {
    const [a1, a2] = adversarialHeightCandidates();
    expect(a1.proposedValue).toEqual({ kind: "quantity", value: 55, unit: "ft" });
    expect(a2.proposedValue).toEqual({ kind: "quantity", value: 45, unit: "ft" });

    const { dispositions, conflicts } = decideConflicts([a1, a2]);
    expect(dispositions.get(a1.candidateId)?.status).toBe("EXCLUDED");
    expect(dispositions.get(a1.candidateId)?.reasons.join(" ")).toContain("never overrides adopted code");
    expect(dispositions.get(a2.candidateId)?.status).toBe("EXECUTABLE");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("authority-resolved");
  });

  it("SOURCE-ORDER INVARIANCE: [55, 45] and [45, 55] decide identically", () => {
    const [a1, a2] = adversarialHeightCandidates();
    const forward = decideConflicts([a1, a2]);
    const backward = decideConflicts([a2, a1]);
    expect(forward.dispositions).toEqual(backward.dispositions);
    expect(forward.conflicts).toEqual(backward.conflicts);
  });

  it("equal-authority incompatible values BLOCK with nothing executable", () => {
    const gisA = heightCandidate("G1", 38, { authority: "OFFICIAL_GIS" });
    const gisB = heightCandidate("G2", 45, { authority: "OFFICIAL_GIS" });
    const sources = [
      ...TEST_SOURCES,
      { sourceRef: "G1", title: "GIS A", publisher: "City", canonicalUrl: "https://t", authority: "OFFICIAL_GIS" as const, retrievedAt: "2026-01-01T00:00:00Z" },
      { sourceRef: "G2", title: "GIS B", publisher: "City", canonicalUrl: "https://t", authority: "OFFICIAL_GIS" as const, retrievedAt: "2026-01-02T00:00:00Z" },
    ];
    const decisions = verifyCandidates({ candidates: [gisA, gisB], sources, subject: { district: "RM-1" } });
    expect(decisions.every((d) => d.status === "ACCEPT")).toBe(true);

    const { dispositions, conflicts } = decideConflicts([gisA, gisB]);
    expect(dispositions.get(gisA.candidateId)?.status).toBe("BLOCKED");
    expect(dispositions.get(gisB.candidateId)?.status).toBe("BLOCKED");
    expect(conflicts[0].resolution).toBe("blocked");
  });

  it("same logical source, newer capture supersedes the older one", () => {
    const older = heightCandidate("S5", 55, {
      retrievedAt: "2025-01-01T00:00:00Z",
      candidateId: "cand:max-height:S5:v1",
      sourceArtifactId: "phl:src:S5@v1",
    });
    const newer = heightCandidate("S5", 45, {
      retrievedAt: "2026-06-01T00:00:00Z",
      candidateId: "cand:max-height:S5:v2",
      sourceArtifactId: "phl:src:S5@v2",
    });
    const { dispositions } = decideConflicts([older, newer]);
    expect(dispositions.get(older.candidateId)?.status).toBe("SUPERSEDED");
    expect(dispositions.get(newer.candidateId)?.status).toBe("EXECUTABLE");
  });
});

describe("canonical compilation + executable gate", () => {
  it("compiles verified rules to claim/regulation/constraint and traverses to sources", () => {
    const project = bareProject();
    const result = compileRegulations(contextFor(project), {
      candidates: [
        heightCandidate("S5", 38),
        {
          ...heightCandidate("S7", 0, { candidateId: "cand:parking:S7", predicate: "parking-requirement" }),
          applicability: { district: "RM-1", use: "multi-family" },
          proposedValue: { kind: "quantity", value: 0, unit: "spaces" },
          verbatimSupportingText: "Multi-Family — 0 (RM-1 group)",
        },
        {
          ...heightCandidate("S5", 0, { candidateId: "cand:far:S5", predicate: "far" }),
          proposedValue: { kind: "unknown" },
          verbatimSupportingText: "no FAR value in the captured RM-1 evidence",
        },
        {
          ...heightCandidate("S5", 16, { candidateId: "cand:lot-width:S5", predicate: "lot-width" }),
          verbatimSupportingText: "Min. Lot Width ... 16 ft.",
        },
      ],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });

    // Height compiled through the full chain.
    const height = result.outcomes.find((o) => o.predicate === "max-height");
    expect(height?.outcome).toBe("compiled");
    expect(project.nodes["phl:claim:max-height:S5"]).toBeDefined();
    expect(project.nodes["phl:reg:max-height"]).toBeDefined();
    expect(project.nodes["phl:constraint:max-height"]).toBeDefined();

    // UNKNOWN (FAR) -> claim only; no regulation, no constraint, never 0.
    const far = result.outcomes.find((o) => o.predicate === "far");
    expect(far?.outcome).toBe("unknown-recorded");
    const farClaim = project.nodes["phl:claim:far:S5"];
    expect(farClaim?.kind === "claim" && farClaim.evidenceState === "UNKNOWN").toBe(true);
    expect(project.nodes["phl:reg:far"]).toBeUndefined();
    expect(project.nodes["phl:constraint:far"]).toBeUndefined();

    // lot-width: claim + regulation, NO fake constraint (deferred to #7).
    expect(project.nodes["phl:claim:lot-width:S5"]).toBeDefined();
    expect(project.nodes["phl:reg:lot-width"]).toBeDefined();
    expect(project.nodes["phl:constraint:lot-width"]).toBeUndefined();

    // Gate: height + parking executable; far/lot-width absent entirely.
    const gate = selectExecutableConstraints(project);
    const ids = gate.executable.map((c) => c.id);
    expect(ids).toContain("phl:constraint:max-height");
    expect(ids).toContain("phl:constraint:parking-requirement:multi-family");
    expect(ids.some((id) => id.includes("far"))).toBe(false);
    for (const decision of gate.decisions.filter((d) => d.executable)) {
      expect(decision.claimIds.length).toBeGreaterThan(0);
      expect(decision.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it("HERO END-TO-END: 55 ft excluded from executable law; 45 ft compiles; discrepancy visible", () => {
    const project = bareProject();
    const [a1, a2] = adversarialHeightCandidates();
    const result = compileRegulations(contextFor(project), {
      candidates: [a1, a2],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });

    // Only ONE height constraint exists, and it is the 45 ft one.
    const constraint = project.nodes["phl:constraint:max-height"];
    expect(constraint).toBeDefined();
    expect(
      constraint?.kind === "constraint" && constraint.constraintKind === "height" && constraint.limit.value === 45,
    ).toBe(true);

    // The 55 ft claim exists as CONFLICT evidence — visible, not erased.
    const excludedClaimId = result.outcomes.find((o) => o.candidateId === a1.candidateId)?.claimId;
    expect(excludedClaimId).toBeDefined();
    const excludedClaim = project.nodes[excludedClaimId!];
    expect(excludedClaim?.kind === "claim" && excludedClaim.evidenceState === "CONFLICT").toBe(true);
    expect(JSON.stringify(excludedClaim)).toContain("never overrides adopted code");

    // Conflict provenance is referenced from the surviving regulation.
    const regulation = project.nodes["phl:reg:max-height"];
    expect(
      regulation?.kind === "regulation" && regulation.conflictRefs.length === 1,
    ).toBe(true);

    // Gate: executable, with reasons; the value in executable law is 45.
    const gate = selectExecutableConstraints(project);
    const heightDecision = gate.decisions.find((d) => d.constraintId === "phl:constraint:max-height");
    expect(heightDecision?.executable).toBe(true);
    expect(JSON.stringify(gate.executable)).not.toContain("55");
  });

  it("BLOCKED conflicts open ONE deterministic expert review and never become executable", () => {
    const project = bareProject();
    const gisA = heightCandidate("G1", 38, { authority: "OFFICIAL_GIS" });
    const gisB = heightCandidate("G2", 45, { authority: "OFFICIAL_GIS" });
    const sources = [
      ...TEST_SOURCES,
      { sourceRef: "G1", title: "GIS A", publisher: "City", canonicalUrl: "https://t", authority: "OFFICIAL_GIS" as const, retrievedAt: "2026-01-01T00:00:00Z" },
      { sourceRef: "G2", title: "GIS B", publisher: "City", canonicalUrl: "https://t", authority: "OFFICIAL_GIS" as const, retrievedAt: "2026-01-02T00:00:00Z" },
    ];
    compileRegulations(contextFor(project), { candidates: [gisA, gisB], sources, subject: { district: "RM-1" } });
    compileRegulations(contextFor(project), { candidates: [gisA, gisB], sources, subject: { district: "RM-1" } });

    // No constraint materialized at all for the blocked predicate.
    expect(project.nodes["phl:constraint:max-height"]).toBeUndefined();
    // Exactly one expert-review node despite compiling twice.
    const reviews = Object.values(project.nodes).filter((node) => node.kind === "expert-review");
    expect(reviews).toHaveLength(1);

    const gate = selectExecutableConstraints(project);
    expect(gate.executable).toHaveLength(0);
  });

  it("IDEMPOTENT: compiling the same evidence twice leaves the semantic graph unchanged", () => {
    const project = bareProject();
    const candidates = [heightCandidate("S5", 38), adversarialHeightCandidates()[1]];
    const first = compileRegulations(contextFor(project), { candidates, sources: TEST_SOURCES, subject: { district: "RM-1" } });
    const nodeIdsAfterFirst = Object.keys(project.nodes).sort();
    const edgesAfterFirst = JSON.stringify([...project.edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const claimsAfterFirst = Object.values(project.nodes).filter((n) => n.kind === "claim").length;
    const regsAfterFirst = Object.values(project.nodes).filter((n) => n.kind === "regulation").length;
    const reviewsAfterFirst = Object.values(project.nodes).filter((n) => n.kind === "expert-review").length;

    const second = compileRegulations(contextFor(project), { candidates, sources: TEST_SOURCES, subject: { district: "RM-1" } });

    expect(Object.keys(project.nodes).sort()).toEqual(nodeIdsAfterFirst);
    expect(
      JSON.stringify([...project.edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))),
    ).toBe(edgesAfterFirst);
    expect(Object.values(project.nodes).filter((n) => n.kind === "claim").length).toBe(claimsAfterFirst);
    expect(Object.values(project.nodes).filter((n) => n.kind === "regulation").length).toBe(regsAfterFirst);
    expect(Object.values(project.nodes).filter((n) => n.kind === "expert-review").length).toBe(reviewsAfterFirst);
    // Same outcomes both runs.
    expect(second.outcomes.map((o) => `${o.candidateId}:${o.outcome}`)).toEqual(
      first.outcomes.map((o) => `${o.candidateId}:${o.outcome}`),
    );
  });

  it("STALE CASCADE: a previously executable rule goes stale via typed commands and the gate excludes it", () => {
    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [heightCandidate("S5", 38)],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
    });
    expect(selectExecutableConstraints(project).executable.map((c) => c.id)).toContain("phl:constraint:max-height");

    // Newer capture of the same logical source supersedes it.
    const { supersedeSourceArtifact, addSourceArtifact } = awaitImport();
    addSourceArtifact(contextFor(project), {
      id: "phl:src:S5@v2",
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S5",
      version: 2,
      sourceType: "official_city_reference",
      title: "Quick Guide (later retrieval)",
      publisher: "City Planning Commission",
      canonicalUrl: "https://test.example/guide",
      authority: "OFFICIAL_CITY_REFERENCE",
      retrievedAt: "2026-12-01T00:00:00Z",
      rawContentHash: "b".repeat(64),
    });
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "phl:src:S5@v1",
      supersededBySourceId: "phl:src:S5@v2",
      conflictedRegulationIds: [],
      note: "later retrieval",
    });

    const gate = selectExecutableConstraints(project);
    const decision = gate.decisions.find((d) => d.constraintId === "phl:constraint:max-height");
    expect(decision?.executable).toBe(false);
    expect(decision?.reasons.join(" ")).toContain("superseded");
    expect(gate.executable.map((c) => c.id)).not.toContain("phl:constraint:max-height");
  });
});

// Static import indirection so the stale-cascade test reads like a scenario.
import { addSourceArtifact, supersedeSourceArtifact } from "../../src/commands";
function awaitImport() {
  return { addSourceArtifact, supersedeSourceArtifact };
}
