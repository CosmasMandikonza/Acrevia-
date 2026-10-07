import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compileRegulations } from "../../src/application/regulatory/compile";
import { selectExecutableConstraints } from "../../src/application/regulatory/executable";
import { decideConflicts, normalizedVerifiedLegalValue } from "../../src/application/regulatory/conflicts";
import { verifyCandidates } from "../../src/application/regulatory/verify";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import { normalizeFeet } from "../../src/application/regulatory/normalize";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import type { RawEvidenceDocument } from "../../src/application/regulatory/extraction";
import { contextFor } from "../domain/helpers";
import {
  applicabilityInput,
  bareProject,
  heightCandidate,
  PARCEL,
  testDocuments,
  testSource,
  useCandidate,
} from "./helpers";

/** Documents containing every anchor the standard candidates emit. */
function standardDocuments(extra: Record<string, string> = {}): RawEvidenceDocument[] {
  return testDocuments(["S5", "S7", "A1", "A2", "G1", "G2"], {
    S5: [
      "maximum building height ... 38 ft",
      "no FAR value in the captured RM-1 evidence",
      "Min. Lot Width ... 16 ft.",
    ].join("\n"),
    S7: "Multi-Family — 1 | 0 | 3/10 units\n| Multi-Family | Y[1] |",
    A1: "Maximum building height in the RM-1 district: 55 ft.",
    A2: [
      "(.1) In the RM-1 zoning district, the maximum building height is 45 ft.",
      "maximum building height ... 45 ft",
    ].join("\n"),
    G1: "maximum building height ... 38 ft\n| Multi-Family | Y[1] |",
    G2: "maximum building height ... 45 ft\n| Multi-Family | S[2], 14-603(5) |",
    ...extra,
  });
}

/**
 * Compiler pipeline tests (issue #5 review): semantic identity, deterministic
 * verification, qualitative + quantitative conflicts, conflict lifecycle,
 * true idempotency, real source hashing, and the executable solver gate —
 * including the hero adversarial case (older favorable 55 ft vs newer
 * authoritative adopted 45 ft) driven from the first-class fixture under
 * docs/benchmarks/adversarial/height-conflict/.
 */

const ADVERSARIAL_DIR = join(import.meta.dirname, "../../docs/benchmarks/adversarial/height-conflict");

const TEST_SOURCES = [
  testSource({ sourceRef: "S5" }),
  testSource({ sourceRef: "S7", authority: "ADOPTED_CODE" }),
  testSource({ sourceRef: "A1", retrievedAt: "2025-01-15T00:00:00Z" }),
  testSource({ sourceRef: "A2", authority: "ADOPTED_CODE", retrievedAt: "2026-06-01T00:00:00Z" }),
  testSource({ sourceRef: "G1", authority: "OFFICIAL_GIS" }),
  testSource({ sourceRef: "G2", authority: "OFFICIAL_GIS" }),
];

function adversarialHeightCandidates(): CandidateRule[] {
  const older = readFileSync(join(ADVERSARIAL_DIR, "older-favorable-height.md"), "utf-8");
  const newer = readFileSync(join(ADVERSARIAL_DIR, "newer-adopted-height.md"), "utf-8");
  const olderFeet = normalizeFeet(older.match(/maximum building height[^]*?(\d+)\s*ft/i)?.[0] ?? "");
  const newerFeet = normalizeFeet(newer.match(/maximum building height is[^]*?(\d+)\s*ft/i)?.[0] ?? "");
  if (!olderFeet || !newerFeet) throw new Error("adversarial fixture failed to parse");
  return [
    heightCandidate("A1", olderFeet.value, {
      verbatimSupportingText: "Maximum building height in the RM-1 district: 55 ft.",
      retrievedAt: "2025-01-15T00:00:00Z",
    }),
    heightCandidate("A2", newerFeet.value, {
      verbatimSupportingText: "(.1) In the RM-1 zoning district, the maximum building height is 45 ft.",
      retrievedAt: "2026-06-01T00:00:00Z",
    }),
  ];
}

describe("semantic rule identity", () => {
  it("SIX applicability and SIX ADU prohibition are DIFFERENT rules", async () => {
    const { loadBenchmarkEvidence } = await import("../../src/adapters/regulatory/benchmark-evidence");
    const { benchmarkExtractionAdapter } = await import("../../src/adapters/regulatory/benchmark-extractor");
    const input = loadBenchmarkEvidence({
      fixtureDir: join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia"),
      subject: { subjectNodeId: PARCEL, jurisdictionKey: "philadelphia-pa", district: "RM-1" },
    });
    const { candidates } = await benchmarkExtractionAdapter.extract(input);
    const applicability = candidates.find((c) => c.semanticRuleKey === "overlay:/six:applicability");
    const prohibition = candidates.find((c) => c.semanticRuleKey === "overlay:/six:adu-prohibition");
    expect(applicability).toBeDefined();
    expect(prohibition).toBeDefined();
    expect(applicability!.candidateId).not.toBe(prohibition!.candidateId);

    // Compile and prove the ADU CONSTRAINT traces specifically to the
    // prohibition rule, regulation, claim, and quote.
    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [applicability!, prohibition!],
      sources: input.sources,
      subject: { district: "RM-1" },
      documents: input.documents,
      ...applicabilityInput(),
    });
    const constraint = project.nodes["phl:constraint:overlay:/six:adu-prohibition"];
    expect(constraint).toBeDefined();
    // Applicability listings are Claim-only by design (no executable semantics).
    expect(project.nodes["phl:reg:overlay:/six:applicability"]).toBeUndefined();
    expect(project.nodes["phl:reg:overlay:/six:adu-prohibition"]?.kind).toBe("regulation");
    const aduClaim = project.nodes["phl:claim:overlay:/six:adu-prohibition:phl:src:S6@v1"];
    expect(
      aduClaim?.kind === "claim" && aduClaim.verbatimQuote?.includes("Accessory dwelling units shall not be permitted"),
    ).toBe(true);
    // The applicability regulation is a separate rule with its own claim.
    const applicabilityClaim = project.nodes["phl:claim:overlay:/six:applicability:phl:src:S6@v1"];
    expect(applicabilityClaim?.kind === "claim").toBe(true);
    expect(JSON.stringify(applicabilityClaim)).toContain("Applicability");
  });

  it("duplicate CandidateRule ids are rejected loudly", () => {
    const project = bareProject();
    const duplicate = heightCandidate("S5", 38);
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [duplicate, { ...duplicate }],
        sources: TEST_SOURCES,
        subject: { district: "RM-1" },
      }),
    ).toThrow(/duplicate CandidateRule id/);
  });
});

describe("verification (candidate -> accepted/rejected)", () => {
  it("rejects hallucinated citations, missing quotes, missing locators, malformed quantities, wrong districts", () => {
    const decisions = verifyCandidates({
      candidates: [
        heightCandidate("S99", 38),
        heightCandidate("S5", 38, { verbatimSupportingText: "   " }),
        heightCandidate("S5", 38, { codeSection: undefined }),
        heightCandidate("S5", 0),
        heightCandidate("S5", 38, { applicability: { district: "RSA-5" } }),
      ],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });
    expect(decisions.map((d) => d.status)).toEqual(["REJECT", "REJECT", "REJECT", "REJECT", "REJECT"]);
    expect(decisions[0].reasons.join(" ")).toContain("does not resolve");
    expect(decisions[1].reasons.join(" ")).toContain("supporting text");
    expect(decisions[2].reasons.join(" ")).toContain("locator");
    expect(decisions[3].reasons.join(" ")).toContain("greater than 0");
    expect(decisions[4].reasons.join(" ")).toContain("not the subject district");
  });
});

/** Verify candidates against their documents, returning VerifiedRules. */
function verifiedOf(candidates: Parameters<typeof verifyCandidates>[0]["candidates"], docs: Parameters<typeof verifyCandidates>[0]["documents"], sources: Parameters<typeof verifyCandidates>[0]["sources"]) {
  return verifyCandidates({
    candidates,
    sources,
    subject: { district: "RM-1" },
    documents: docs,
  })
    .filter((d) => d.status === "ACCEPT" && d.verified && d.verified.verifiedValue.kind !== "abstain")
    .map((d) => d.verified!);
}

describe("conflict engine (semantic, order-invariant, qualitative-aware)", () => {
  it("HERO: older favorable 55 ft loses to newer authoritative adopted 45 ft", () => {
    const [a1, a2] = adversarialHeightCandidates();
    expect(a1.proposedValue).toEqual({ kind: "quantity", value: 55, unit: "ft" });
    expect(a2.proposedValue).toEqual({ kind: "quantity", value: 45, unit: "ft" });

    const { dispositions, conflicts } = decideConflicts(verifiedOf([a1, a2], standardDocuments(), TEST_SOURCES));
    expect(dispositions.get(a1.candidateId)?.status).toBe("EXCLUDED");
    expect(dispositions.get(a1.candidateId)?.reasons.join(" ")).toContain("never overrides adopted code");
    expect(dispositions.get(a2.candidateId)?.status).toBe("EXECUTABLE");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe("authority-resolved");
  });

  it("SOURCE-ORDER INVARIANCE: [55, 45] and [45, 55] decide identically", () => {
    const [a1, a2] = adversarialHeightCandidates();
    const forward = decideConflicts(verifiedOf([a1, a2], standardDocuments(), TEST_SOURCES));
    const backward = decideConflicts(verifiedOf([a2, a1], standardDocuments(), TEST_SOURCES));
    expect(forward.dispositions).toEqual(backward.dispositions);
    expect(forward.conflicts).toEqual(backward.conflicts);
  });

  it("QUALITATIVE: BY_RIGHT vs SPECIAL_EXCEPTION for the same rule BLOCKs", () => {
    const gisA = useCandidate("G1", "Y[1]");
    const gisB = useCandidate("G2", "S[2], 14-603(5)");
    const verifiedUse = verifiedOf([gisA, gisB], standardDocuments(), TEST_SOURCES);
    expect(verifiedUse.map((v) => normalizedVerifiedLegalValue(v.verifiedValue))).toContain("perm:BY_RIGHT");
    expect(verifiedUse.map((v) => normalizedVerifiedLegalValue(v.verifiedValue))).toContain("perm:SPECIAL_EXCEPTION");

    const { dispositions, conflicts } = decideConflicts(verifiedUse);
    expect(dispositions.get(gisA.candidateId)?.status).toBe("BLOCKED");
    expect(dispositions.get(gisB.candidateId)?.status).toBe("BLOCKED");
    expect(conflicts[0].resolution).toBe("blocked");
  });

  it("equal-authority incompatible quantities BLOCK with nothing executable", () => {
    const gisA = heightCandidate("G1", 38, { authority: "OFFICIAL_GIS" });
    const gisB = heightCandidate("G2", 45, { authority: "OFFICIAL_GIS" });
    const { dispositions, conflicts } = decideConflicts(
      verifiedOf([gisA, gisB], standardDocuments({ G2: "maximum building height ... 45 ft" }), TEST_SOURCES),
    );
    expect(dispositions.get(gisA.candidateId)?.status).toBe("BLOCKED");
    expect(dispositions.get(gisB.candidateId)?.status).toBe("BLOCKED");
    expect(conflicts[0].resolution).toBe("blocked");
  });

  it("same logical source, newer capture supersedes the older one", () => {
    const older = heightCandidate("S5", 55, {
      retrievedAt: "2025-01-01T00:00:00Z",
      candidateId: "cand:height:max:principal:S5@v1",
      sourceArtifactId: "phl:src:S5@v1",
    });
    const newer = heightCandidate("S5", 45, {
      retrievedAt: "2026-06-01T00:00:00Z",
      candidateId: "cand:height:max:principal:S5@v2",
      sourceArtifactId: "phl:src:S5@v2",
    });
    const { dispositions } = decideConflicts(
      verifiedOf(
        [older, newer],
        testDocuments(["S5"], { S5: "maximum building height ... 55 ft\nmaximum building height ... 45 ft" }),
        [
          testSource({ sourceRef: "S5", sourceArtifactId: "phl:src:S5@v1", retrievedAt: "2025-01-01T00:00:00Z" }),
          testSource({ sourceRef: "S5", sourceArtifactId: "phl:src:S5@v2", retrievedAt: "2026-06-01T00:00:00Z" }),
        ],
      ),
    );
    expect(dispositions.get(older.candidateId)?.status).toBe("SUPERSEDED");
    expect(dispositions.get(newer.candidateId)?.status).toBe("EXECUTABLE");
  });
});

describe("source artifact truth", () => {
  it("raw byte changes change the hash; same id + changed content fails loudly", async () => {
    const { hashCaptureFiles } = await import("../../src/adapters/regulatory/benchmark-evidence");
    const bytesA = Buffer.from("height 38 ft");
    const bytesB = Buffer.from("height 39 ft");
    const hashA = hashCaptureFiles([{ name: "raw/a.md", bytes: bytesA }]);
    const hashB = hashCaptureFiles([{ name: "raw/a.md", bytes: bytesB }]);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).not.toBe(hashB);
    // Multi-file combination is order-invariant.
    expect(hashCaptureFiles([
      { name: "raw/a.md", bytes: bytesA },
      { name: "raw/b.md", bytes: bytesB },
    ])).toBe(hashCaptureFiles([
      { name: "raw/b.md", bytes: bytesB },
      { name: "raw/a.md", bytes: bytesA },
    ]));

    const project = bareProject();
    const ctx = contextFor(project);
    compileRegulations(ctx, {
      candidates: [heightCandidate("S5", 38)],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });
    const tampered = testSource({
      sourceRef: "S5",
      rawContentHash: createHash("sha256").update("different bytes").digest("hex"),
    });
    expect(() =>
      compileRegulations(ctx, {
        candidates: [heightCandidate("S5", 38)],
        sources: [tampered],
        subject: { district: "RM-1" },
        documents: standardDocuments(),
        ...applicabilityInput(),
      }),
    ).toThrow(/immutable/i);
  });

  it("AuthorityLevel maps to SourceType exactly and is preserved on the artifact", async () => {
    const project = bareProject();
    const adopted = testSource({ sourceRef: "A2", authority: "ADOPTED_CODE" });
    const gis = testSource({ sourceRef: "G1", authority: "OFFICIAL_GIS" });
    const tool = testSource({ sourceRef: "T1", authority: "OFFICIAL_CITY_TOOL" });
    const reference = testSource({ sourceRef: "R1", authority: "OFFICIAL_CITY_REFERENCE" });
    const candidates = [
      heightCandidate("A2", 45, { verbatimSupportingText: "maximum building height ... 45 ft" }),
      heightCandidate("G1", 38, {
        semanticRuleKey: "lot:width:min",
        candidateId: "cand:lot:width:min:phl:src:G1@v1",
        predicate: "lot-width",
        applicability: { district: "RM-1" },
        authority: "OFFICIAL_GIS",
        verbatimSupportingText: "| Min. Lot Width | 38 ft. |",
        evidenceAnchor: { documentId: "G1.md", exactText: "| Min. Lot Width | 38 ft. |" },
      }),
    ];
    compileRegulations(contextFor(project), {
      candidates,
      sources: [adopted, gis, tool, reference],
      subject: { district: "RM-1" },
      documents: standardDocuments({ G1: "maximum building height ... 45 ft\n| Min. Lot Width | 38 ft. |" }),
      ...applicabilityInput(),
    });
    expect(project.nodes["phl:src:A2@v1"]).toMatchObject({ sourceType: "adopted_code" });
    expect(project.nodes["phl:src:G1@v1"]).toMatchObject({ sourceType: "official_gis" });
    expect(project.nodes["phl:src:T1@v1"]).toBeUndefined(); // unused source not materialized
  });
});

describe("canonical compilation + executable gate", () => {
  it("compiles verified rules to claim/regulation/constraint and traverses to sources", () => {
    const project = bareProject();
    const farCandidate: CandidateRule = {
      ...heightCandidate("S5", 0, {
        candidateId: "cand:far:max:S5",
        semanticRuleKey: "far:max",
        predicate: "far",
        verbatimSupportingText: "no FAR value in the captured RM-1 evidence",
      }),
      proposedValue: { kind: "unknown" },
    };
    const lotWidth: CandidateRule = heightCandidate("S5", 16, {
      candidateId: "cand:lot:width:min:S5",
      semanticRuleKey: "lot:width:min",
      predicate: "lot-width",
      verbatimSupportingText: "Min. Lot Width ... 16 ft.",
    });
    const parking: CandidateRule = {
      ...heightCandidate("S7", 0, {
        candidateId: "cand:parking:multi-family:minimum:S7",
        semanticRuleKey: "parking:multi-family:minimum",
        predicate: "parking-requirement",
        authority: "ADOPTED_CODE",
        verbatimSupportingText: "Multi-Family — 1 | 0 | 3/10 units",
      }),
      applicability: { district: "RM-1", use: "multi-family" },
      proposedValue: { kind: "quantity", value: 0, unit: "spaces" },
    };
    compileRegulations(contextFor(project), {
      candidates: [heightCandidate("S5", 38), parking, farCandidate, lotWidth],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });

    expect(project.nodes["phl:claim:height:max:principal:phl:src:S5@v1"]).toBeDefined();
    expect(project.nodes["phl:reg:height:max:principal"]).toBeDefined();
    expect(project.nodes["phl:constraint:height:max:principal"]).toBeDefined();

    const farClaim = project.nodes["phl:claim:far:max:phl:src:S5@v1"];
    expect(farClaim?.kind === "claim" && farClaim.evidenceState === "UNKNOWN").toBe(true);
    expect(project.nodes["phl:reg:far:max"]).toBeUndefined(); // UNKNOWN stays Claim-only
    expect(project.nodes["phl:constraint:far:max"]).toBeUndefined();

    expect(project.nodes["phl:claim:lot:width:min:phl:src:S5@v1"]).toBeDefined();
    expect(project.nodes["phl:reg:lot:width:min"]).toBeDefined();
    expect(project.nodes["phl:constraint:lot:width:min"]).toBeUndefined();

    const gate = selectExecutableConstraints(project);
    const ids = gate.executable.map((c) => c.id);
    expect(ids).toContain("phl:constraint:height:max:principal");
    expect(ids).toContain("phl:constraint:parking:multi-family:minimum");
    expect(ids.some((id) => id.includes("far"))).toBe(false);
    for (const decision of gate.decisions.filter((d) => d.executable)) {
      expect(decision.claimIds.length).toBeGreaterThan(0);
      expect(decision.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it("HERO END-TO-END: 55 ft excluded from executable law; 45 ft compiles; discrepancy visible", () => {
    const project = bareProject();
    const [a1, a2] = adversarialHeightCandidates();
    compileRegulations(contextFor(project), {
      candidates: [a1, a2],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });

    const constraint = project.nodes["phl:constraint:height:max:principal"];
    expect(constraint).toBeDefined();
    expect(constraint?.kind === "constraint" && constraint.constraintKind === "height" && constraint.limit.value === 45).toBe(true);

    const excludedClaim = project.nodes["phl:claim:height:max:principal:phl:src:A1@v1"];
    expect(excludedClaim?.kind === "claim" && excludedClaim.evidenceState === "CONFLICT").toBe(true);
    expect(JSON.stringify(excludedClaim)).toContain("never overrides adopted code");

    const regulation = project.nodes["phl:reg:height:max:principal"];
    expect(regulation?.kind === "regulation" && regulation.conflictRefs.length === 1).toBe(true);

    const gate = selectExecutableConstraints(project);
    expect(gate.decisions.find((d) => d.constraintId === "phl:constraint:height:max:principal")?.executable).toBe(true);
    expect(JSON.stringify(gate.executable)).not.toMatch(/"value":55\b/);
  });

  it("CONFLICT LIFECYCLE: previously-valid 38 ft goes STALE when later equal-authority evidence conflicts", async () => {
    const { recordScenario } = await import("../../src/commands");
    const project = bareProject();
    const ctx = contextFor(project);

    // Compile 1: trusted 38 ft, executable.
    compileRegulations(ctx, {
      candidates: [heightCandidate("S5", 38)],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });
    let gate = selectExecutableConstraints(project);
    expect(gate.decisions.find((d) => d.constraintId === "phl:constraint:height:max:principal")?.executable).toBe(true);

    // A certificate depends on the compiled height constraint.
    recordScenario(ctx, {
      scenarioId: "scenario:height-check",
      label: "Height check",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 10, unit: "dwelling_units" } }],
      constraintIds: ["phl:constraint:height:max:principal"],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL,
      results: [
        {
          resultId: "result:height",
          constraintId: "phl:constraint:height:max:principal",
          status: "SATISFIED",
          actual: { value: 38, unit: "ft" },
          limit: { value: 38, unit: "ft" },
          explanation: "Massing at 38 ft.",
        },
      ],
      certificateId: "scenario:height-check:certificate",
    });

    // Compile 2: an equally authoritative source now says 45 ft.
    const conflicting = heightCandidate("G1", 45, { authority: "OFFICIAL_GIS" });
    compileRegulations(ctx, {
      candidates: [heightCandidate("S5", 38), conflicting],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments({ G1: "maximum building height ... 45 ft" }),
      ...applicabilityInput(),
    });

    // Old constraint REMAINS for audit; regulation is STALE; gate excludes.
    expect(project.nodes["phl:constraint:height:max:principal"]).toBeDefined();
    const regulation = project.nodes["phl:reg:height:max:principal"];
    expect(regulation?.kind === "regulation" && regulation.currentness).toBe("STALE");
    gate = selectExecutableConstraints(project);
    const decision = gate.decisions.find((d) => d.constraintId === "phl:constraint:height:max:principal");
    expect(decision?.executable).toBe(false);
    expect(decision?.reasons.join(" ")).toContain("STALE");

    // Expert review concerns REAL graph nodes — never CandidateRule ids.
    const review = Object.values(project.nodes).find((node) => node.kind === "expert-review");
    expect(review).toBeDefined();
    const affected = review?.kind === "expert-review" ? review.affectedNodeIds : [];
    expect(affected.length).toBeGreaterThan(0);
    for (const nodeId of affected) {
      expect(nodeId.startsWith("cand:")).toBe(false);
      expect(project.nodes[nodeId]).toBeDefined();
    }
    expect(affected).toContain("phl:reg:height:max:principal");
    expect(affected).toContain("phl:claim:height:max:principal:phl:src:S5@v1");

    // Dependent certificate non-CURRENT; gate blocked via open review too.
    const { gradeCertificate } = await import("../../src/domain");
    expect(["STALE", "INVALIDATED"]).toContain(gradeCertificate(project, "scenario:height-check:certificate").freshness);
    expect(decision?.reasons.join(" ")).toMatch(/expert review|STALE/);
  });

  it("TRUE IDEMPOTENCY: compiling identical evidence twice changes NOTHING", () => {
    const project = bareProject();
    const ctx = contextFor(project);
    const candidates = [heightCandidate("S5", 38), adversarialHeightCandidates()[1]];
    compileRegulations(ctx, {
      candidates,
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });

    const revision = project.revision;
    const eventCount = project.events.length;
    const edges = JSON.stringify([...project.edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const encoded = ProjectCodec.encode(project);
    const regulationRevisions = Object.values(project.nodes)
      .filter((n) => n.kind === "regulation")
      .map((n) => `${n.id}:${n.meta.revision}`)
      .sort();
    const semanticHashes = Object.values(project.nodes)
      .map((n) => `${n.id}:${n.meta.semanticHash}`)
      .sort();

    const second = compileRegulations(ctx, {
      candidates,
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });

    expect(project.revision).toBe(revision);
    expect(project.events.length).toBe(eventCount);
    expect(
      JSON.stringify([...project.edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))),
    ).toBe(edges);
    expect(ProjectCodec.encode(project)).toBe(encoded);
    expect(
      Object.values(project.nodes).filter((n) => n.kind === "regulation").map((n) => `${n.id}:${n.meta.revision}`).sort(),
    ).toEqual(regulationRevisions);
    expect(Object.values(project.nodes).map((n) => `${n.id}:${n.meta.semanticHash}`).sort()).toEqual(semanticHashes);
    expect(second.outcomes.map((o) => `${o.candidateId}:${o.outcome}`)).toEqual(
      compileRegulations(ctx, {
        candidates,
        sources: TEST_SOURCES,
        subject: { district: "RM-1" },
        documents: standardDocuments(),
        ...applicabilityInput(),
      }).outcomes
        .map((o) => `${o.candidateId}:${o.outcome}`),
    );
  });

  it("TRUE SOURCE-SUPERSESSION CERTIFICATE: newer artifact supersedes, gate excludes, dependents go non-CURRENT", async () => {
    const { addSourceArtifact, supersedeSourceArtifact, recordScenario } = await import("../../src/commands");
    const { gradeCertificate } = await import("../../src/domain");
    const project = bareProject();
    const ctx = contextFor(project);

    const heightId = "phl:constraint:height:max:principal";
    const parkingId = "phl:constraint:parking:multi-family:minimum";
    const parkingCandidate: CandidateRule = {
      ...heightCandidate("S7", 0, {
        candidateId: "cand:parking:multi-family:minimum:S7",
        semanticRuleKey: "parking:multi-family:minimum",
        predicate: "parking-requirement",
        authority: "ADOPTED_CODE",
        verbatimSupportingText: "Multi-Family — 1 | 0 | 3/10 units",
      }),
      applicability: { district: "RM-1", use: "multi-family" },
      proposedValue: { kind: "quantity", value: 0, unit: "spaces" },
    };
    compileRegulations(ctx, {
      candidates: [heightCandidate("S5", 38), parkingCandidate],
      sources: TEST_SOURCES,
      subject: { district: "RM-1" },
      documents: standardDocuments(),
      ...applicabilityInput(),
    });
    expect(selectExecutableConstraints(project).executable.map((c) => c.id)).toContain(heightId);

    recordScenario(ctx, {
      scenarioId: "scenario:height-dep",
      label: "Height dep",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 10, unit: "dwelling_units" } }],
      constraintIds: [heightId],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL,
      results: [
        {
          resultId: "result:height-dep",
          constraintId: heightId,
          status: "SATISFIED",
          actual: { value: 38, unit: "ft" },
          limit: { value: 38, unit: "ft" },
          explanation: "Massing at 38 ft.",
        },
      ],
      certificateId: "scenario:height-dep:certificate",
    });
    // Unrelated certificate depending only on S7 parking.
    recordScenario(ctx, {
      scenarioId: "scenario:parking-dep",
      label: "Parking dep",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 10, unit: "dwelling_units" } }],
      constraintIds: [parkingId],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL,
      results: [
        {
          resultId: "result:parking-dep",
          constraintId: parkingId,
          status: "SATISFIED",
          actual: { value: 0, unit: "spaces" },
          limit: { value: 0, unit: "spaces" },
          explanation: "0 required.",
        },
      ],
      certificateId: "scenario:parking-dep:certificate",
    });

    // Newer capture of the SAME logical source (real content, real hash).
    addSourceArtifact(ctx, {
      id: "phl:src:S5@v2",
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S5",
      version: 2,
      sourceType: "official_city_reference",
      title: "Quick Guide (later retrieval)",
      publisher: "Test City",
      canonicalUrl: "https://test.example/S5",
      authority: "OFFICIAL_CITY_REFERENCE",
      retrievedAt: "2026-12-01T00:00:00Z",
      rawContentHash: createHash("sha256").update("later retrieval bytes").digest("hex"),
    });
    supersedeSourceArtifact(ctx, {
      sourceId: "phl:src:S5@v1",
      supersededBySourceId: "phl:src:S5@v2",
      conflictedRegulationIds: [],
      note: "later retrieval",
    });

    const gate = selectExecutableConstraints(project);
    const heightDecision = gate.decisions.find((d) => d.constraintId === heightId);
    expect(heightDecision?.executable).toBe(false);
    expect(heightDecision?.reasons.join(" ")).toContain("superseded");
    expect(gate.executable.map((c) => c.id)).not.toContain(heightId);

    const heightCertificate = gradeCertificate(project, "scenario:height-dep:certificate");
    expect(["STALE", "INVALIDATED"]).toContain(heightCertificate.freshness);
    expect(heightCertificate.reasons.join(" ")).toContain("superseded");
    // The unrelated certificate stays CURRENT.
    expect(gradeCertificate(project, "scenario:parking-dep:certificate").freshness).toBe("CURRENT");
  });
});
