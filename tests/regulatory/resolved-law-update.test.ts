import { describe, expect, it } from "vitest";
import { compileRegulations } from "../../src/application/regulatory/compile";
import { selectExecutableConstraints } from "../../src/application/regulatory/executable";
import { recordScenario } from "../../src/commands";
import { gradeCertificate } from "../../src/domain";
import { contextFor } from "../domain/helpers";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import {
  applicabilityInput,
  bareProject,
  heightCandidate,
  useCandidate,
  testDocuments,
  testSource,
  PARCEL,
} from "./helpers";

/**
 * Resolved-law update regressions (PR #28 third review):
 *  1. the executable CONSTRAINT itself changes when the same semantic rule
 *     resolves to newer law (55 -> 45; BY_RIGHT -> SPECIAL_EXCEPTION), with
 *     prior certificates STALE and new certificates CURRENT;
 *  2. the canonical Claim.verbatimQuote derives ONLY from the verified
 *     capture anchor — extractor prose never masquerades as a quote;
 *  3. applicability claims are semantically validated (wrong district,
 *     wrong overlay, cross-parcel subject -> fail closed).
 */

const HEIGHT_ID = "phl:constraint:height:max:principal";

function heightDocs(feet: number[]) {
  return testDocuments(["A1"], {
    A1: feet.map((f) => `maximum building height ... ${f} ft`).join("\n"),
  });
}

describe("sequential resolved-law updates change the executable constraint", () => {
  it("55 alone -> 45 later: same id, value 45, gate 45, no 55, old cert STALE, new cert CURRENT", () => {
    const project = bareProject();
    const ctx = contextFor(project);
    const adopted = testSource({ sourceRef: "A1", authority: "ADOPTED_CODE", retrievedAt: "2026-06-01T00:00:00Z" });

    // Run 1: 55 ft alone.
    compileRegulations(ctx, {
      candidates: [
        heightCandidate("A1", 55, {
          authority: "ADOPTED_CODE",
          retrievedAt: "2026-06-01T00:00:00Z",
        }),
      ],
      sources: [adopted],
      subject: { district: "RM-1" },
      documents: heightDocs([55]),
      ...applicabilityInput(),
    });
    let gate = selectExecutableConstraints(project);
    let height = gate.executable.find((c) => c.id === HEIGHT_ID);
    expect(height?.constraintKind === "height" && height.limit.value).toBe(55);

    // Certificate against 55.
    recordScenario(ctx, {
      scenarioId: "scenario:cert-55",
      label: "Cert 55",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 12, unit: "dwelling_units" } }],
      constraintIds: [HEIGHT_ID],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL,
      results: [
        {
          resultId: "result:cert-55",
          constraintId: HEIGHT_ID,
          status: "SATISFIED",
          actual: { value: 55, unit: "ft" },
          limit: { value: 55, unit: "ft" },
          explanation: "At 55.",
        },
      ],
      certificateId: "scenario:cert-55:certificate",
    });
    expect(gradeCertificate(project, "scenario:cert-55:certificate").freshness).toBe("CURRENT");

    // Run 2: same semantic rule now resolves to 45 (newer adopted capture).
    const adoptedV2 = testSource({
      sourceRef: "A1",
      authority: "ADOPTED_CODE",
      retrievedAt: "2026-12-01T00:00:00Z",
      sourceArtifactId: "phl:src:A1@v2",
    });
    compileRegulations(ctx, {
      candidates: [
        heightCandidate("A1", 45, {
          authority: "ADOPTED_CODE",
          retrievedAt: "2026-12-01T00:00:00Z",
          sourceArtifactId: "phl:src:A1@v2",
          candidateId: "cand:height:max:principal:phl:src:A1@v2",
        }),
      ],
      sources: [adoptedV2],
      subject: { district: "RM-1" },
      documents: heightDocs([55, 45]),
      ...applicabilityInput(),
    });

    // SAME constraint id, value now 45; gate exposes 45 and no 55.
    const constraint = project.nodes[HEIGHT_ID];
    expect(constraint?.kind === "constraint" && constraint.constraintKind === "height" && constraint.limit.value).toBe(45);
    gate = selectExecutableConstraints(project);
    height = gate.executable.find((c) => c.id === HEIGHT_ID);
    expect(height?.constraintKind === "height" && height.limit.value).toBe(45);
    expect(JSON.stringify(gate.executable)).not.toMatch(/"value":55\\b/);
    // The audited replacement event exists.
    expect(project.events.some((e) => e.eventType === "constraint.replaced")).toBe(true);

    // Prior certificate went STALE; a NEW certificate against 45 is CURRENT.
    expect(gradeCertificate(project, "scenario:cert-55:certificate").freshness).toBe("STALE");
    recordScenario(ctx, {
      scenarioId: "scenario:cert-45",
      label: "Cert 45",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 9, unit: "dwelling_units" } }],
      constraintIds: [HEIGHT_ID],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL,
      results: [
        {
          resultId: "result:cert-45",
          constraintId: HEIGHT_ID,
          status: "SATISFIED",
          actual: { value: 45, unit: "ft" },
          limit: { value: 45, unit: "ft" },
          explanation: "At 45.",
        },
      ],
      certificateId: "scenario:cert-45:certificate",
    });
    expect(gradeCertificate(project, "scenario:cert-45:certificate").freshness).toBe("CURRENT");
  });

  it("BY_RIGHT -> later authoritative SPECIAL_EXCEPTION: same use constraint updates", () => {
    const project = bareProject();
    const ctx = contextFor(project);
    const gis = testSource({ sourceRef: "G1", authority: "OFFICIAL_GIS" });
    const adopted = testSource({ sourceRef: "A2", authority: "ADOPTED_CODE", retrievedAt: "2026-12-01T00:00:00Z" });

    compileRegulations(ctx, {
      candidates: [useCandidate("G1", "Y[1]")],
      sources: [gis],
      subject: { district: "RM-1" },
      documents: testDocuments(["G1"], { G1: "| Multi-Family | Y[1] |" }),
      ...applicabilityInput(),
    });
    const USE_ID = "phl:constraint:use:multi-family:permission";
    let gate = selectExecutableConstraints(project);
    let use = gate.executable.find((c) => c.id === USE_ID);
    expect(use?.constraintKind === "use-permission" && use.permission).toBe("BY_RIGHT");

    // Later adopted resolution says SPECIAL_EXCEPTION.
    const later: CandidateRule = {
      ...useCandidate("A2", "S[2], 14-603(5)", {
        authority: "ADOPTED_CODE",
        retrievedAt: "2026-12-01T00:00:00Z",
      }),
      candidateId: "cand:use:multi-family:permission:phl:src:A2@v1",
    };
    compileRegulations(ctx, {
      candidates: [later],
      sources: [adopted],
      subject: { district: "RM-1" },
      documents: testDocuments(["A2"], { A2: "| Multi-Family | S[2], 14-603(5) |" }),
      ...applicabilityInput(),
    });

    const constraint = project.nodes[USE_ID];
    expect(
      constraint?.kind === "constraint" &&
        constraint.constraintKind === "use-permission" &&
        constraint.permission,
    ).toBe("SPECIAL_EXCEPTION");
    gate = selectExecutableConstraints(project);
    use = gate.executable.find((c) => c.id === USE_ID);
    expect(use?.constraintKind === "use-permission" && use.permission).toBe("SPECIAL_EXCEPTION");
    const serialized = JSON.stringify(gate.executable);
    expect(serialized).not.toMatch(/BY_RIGHT(?!")/); // no BY_RIGHT survives for this rule
  });
});

describe("canonical verbatimQuote comes from verified captured evidence", () => {
  it("fabricated verbatimSupportingText never enters the canonical claim quote", () => {
    const project = bareProject();
    const source = testSource({ sourceRef: "A1" });
    const candidate = heightCandidate("A1", 38, {
      verbatimSupportingText: "The City Commission hereby eternally grants 38 ft as a matter of divine right.",
      // The anchor stays the REAL captured row — extractor prose is separate.
      evidenceAnchor: { documentId: "A1.md", exactText: "maximum building height ... 38 ft" },
    });
    compileRegulations(contextFor(project), {
      candidates: [candidate],
      sources: [source],
      subject: { district: "RM-1" },
      documents: testDocuments(["A1"], { A1: "maximum building height ... 38 ft" }),
      ...applicabilityInput(),
    });

    const claim = project.nodes["phl:claim:height:max:principal:phl:src:A1@v1"];
    expect(claim?.kind === "claim").toBe(true);
    if (claim?.kind === "claim") {
      // The canonical quote is EXACTLY the verified capture anchor.
      expect(claim.verbatimQuote).toBe("maximum building height ... 38 ft");
      expect(claim.verbatimQuote).not.toContain("divine right");
      // Extractor commentary survives only in notes.
      expect(claim.notes).toContain("extractor rendering:");
      expect(claim.notes).toContain("divine right");
    }
  });
});

describe("applicability claims are semantically validated (fail closed)", () => {
  const A1 = testSource({ sourceRef: "A1" });
  const docs = testDocuments(["A1"], { A1: "maximum building height ... 38 ft" });
  const candidate = heightCandidate("A1", 38);

  it("RM-1 rule + supplied zoning claim says CMX-2 -> fail closed", () => {
    const project = bareProject();
    const zoningClaim = project.nodes["gis:claim:zoning-base:778273000"];
    if (zoningClaim?.kind === "claim") {
      zoningClaim.value = { type: "qualitative", text: "CMX-2" };
    }
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [candidate],
        sources: [A1],
        subject: { district: "RM-1" },
        documents: docs,
        ...applicabilityInput(),
      }),
    ).toThrow(/does not prove district RM-1/);
  });

  it("/SIX rule + supplied overlay claim proves a different overlay -> fail closed", async () => {
    const { loadBenchmarkEvidence } = await import("../../src/adapters/regulatory/benchmark-evidence");
    const { benchmarkExtractionAdapter } = await import("../../src/adapters/regulatory/benchmark-extractor");
    const input = loadBenchmarkEvidence({
      fixtureDir: "./docs/benchmarks/calvary-memorial-philadelphia",
      subject: { subjectNodeId: PARCEL, jurisdictionKey: "philadelphia-pa", district: "RM-1" },
    });
    const extraction = await benchmarkExtractionAdapter.extract(input);
    const prohibition = extraction.candidates.find((c) => c.semanticRuleKey === "overlay:/six:adu-prohibition");

    const project = bareProject();
    const overlayClaim = project.nodes["gis:claim:zoning-overlays:778273000"];
    if (overlayClaim?.kind === "claim") {
      overlayClaim.value = { type: "qualitative", text: "/NIS Narcotics Injection Sites Overlay District" };
    }
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [prohibition!],
        sources: input.sources,
        subject: { district: "RM-1" },
        documents: input.documents,
        ...applicabilityInput(),
      }),
    ).toThrow("does not prove overlay");
  });

  it("applicability claim belonging to another parcel -> fail closed", () => {
    const project = bareProject();
    const zoningClaim = project.nodes["gis:claim:zoning-base:778273000"];
    if (zoningClaim?.kind === "claim") {
      zoningClaim.subjectNodeId = "phl:parcel:999999999";
    }
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [candidate],
        sources: [A1],
        subject: { district: "RM-1" },
        documents: docs,
        ...applicabilityInput(),
      }),
    ).toThrow(/is not this parcel/);
  });

  it("non-SOURCE_DERIVED / unevidenced applicability claims -> fail closed", () => {
    const project = bareProject();
    const zoningClaim = project.nodes["gis:claim:zoning-base:778273000"];
    if (zoningClaim?.kind === "claim") {
      zoningClaim.origin = { kind: "MODELER_DECLARED" };
    }
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [candidate],
        sources: [A1],
        subject: { district: "RM-1" },
        documents: docs,
        ...applicabilityInput(),
      }),
    ).toThrow(/origin is not SOURCE_DERIVED/);
  });
});
