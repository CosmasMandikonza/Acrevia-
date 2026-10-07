import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { verifyCandidates } from "../../src/application/regulatory/verify";
import { compileRegulations } from "../../src/application/regulatory/compile";
import { selectExecutableConstraints } from "../../src/application/regulatory/executable";
import { recordScenario } from "../../src/commands";
import { gradeCertificate } from "../../src/domain";
import { contextFor } from "../domain/helpers";
import {
  applicabilityInput,
  OVERLAY_CLAIM,
  ZONING_BASE_CLAIM,
  bareProject,
  captureTextFor,
  heightCandidate,
  testDocuments,
  testSource,
} from "./helpers";

/**
 * Trust-boundary regressions (PR #28 final review):
 *  1. the verifier independently binds extractor proposals to captured
 *     evidence (spoofed authority/date, invented quotes, mismatched values);
 *  2. applicability proof enters the graph — district/overlay law depends on
 *     the parcel's own zoning-base/overlay claims, certificates pin both the
 *     legal and applicability sources, and applicability changes stale
 *     dependents;
 *  3. same-source captured versions get distinct observation identities;
 *  4. multi-parcel accepted properties fail closed in the API.
 */

const S5_SOURCE = testSource({ sourceRef: "S5" });
const DOCS = testDocuments(["S5"], { S5: captureTextFor([{ feet: 38 }]) });

function verifyOne(candidate: Parameters<typeof verifyCandidates>[0]["candidates"][number]) {
  return verifyCandidates({
    candidates: [candidate],
    sources: [S5_SOURCE],
    subject: { district: "RM-1" },
    documents: DOCS,
  })[0];
}

describe("verifier independently binds proposals to captured evidence", () => {
  it("SPOOFED AUTHORITY: candidate claims ADOPTED_CODE for an OFFICIAL_CITY_REFERENCE capture -> REJECT", () => {
    const decision = verifyOne(heightCandidate("S5", 38, { authority: "ADOPTED_CODE" }));
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("authority");
    expect(decision.reasons.join(" ")).toContain("OFFICIAL_CITY_REFERENCE");
  });

  it("SPOOFED retrievedAt: invented newer date -> REJECT", () => {
    const decision = verifyOne(heightCandidate("S5", 38, { retrievedAt: "2030-01-01T00:00:00Z" }));
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("captured at");
  });

  it("MISMATCHED sourceArtifactId -> REJECT", () => {
    const decision = verifyOne(heightCandidate("S5", 38, { sourceArtifactId: "phl:src:S7@v1" }));
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("captured as");
  });

  it("INVENTED QUOTE: anchor text absent from the capture -> REJECT", () => {
    const decision = verifyOne(
      heightCandidate("S5", 38, {
        verbatimSupportingText: "maximum building height shall be 100 ft per the invented memo",
      }),
    );
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("does not exist in the captured bytes");
  });

  it("INVENTED ANCHOR DOCUMENT: unknown documentId -> REJECT", () => {
    const candidate = heightCandidate("S5", 38, {
      evidenceAnchor: { documentId: "S99.md", exactText: "maximum building height ... 38 ft" },
    });
    const decision = verifyOne(candidate);
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("does not resolve to a captured document");
  });

  it("MISMATCHED VALUE: anchor says 38 ft, proposal says 55 ft -> REJECT", () => {
    const decision = verifyOne(
      heightCandidate("S5", 55, { verbatimSupportingText: "maximum building height ... 38 ft" }),
    );
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("anchor says 38");
    expect(decision.reasons.join(" ")).toContain("proposes 55");
  });

  it("VALID deterministic extraction -> ACCEPT", () => {
    const decision = verifyOne(heightCandidate("S5", 38));
    expect(decision.status).toBe("ACCEPT");
    expect(decision.reasons).toHaveLength(0);
  });
});

describe("applicability proof enters the graph", () => {
  it("DISTRICT LAW: the height regulation depends on the site's zoning-base claim + GIS artifact", () => {
    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [heightCandidate("S5", 38)],
      sources: [S5_SOURCE],
      subject: { district: "RM-1" },
      documents: DOCS,
      ...applicabilityInput(),
    });
    const regulation = project.nodes["phl:reg:height:max:principal"];
    expect(regulation?.kind === "regulation" && regulation.claimIds).toContain(ZONING_BASE_CLAIM);
    // The closure from the constraint reaches the GIS source artifact.
    const gate = selectExecutableConstraints(project);
    const height = gate.decisions.find((d) => d.constraintId === "phl:constraint:height:max:principal");
    expect(height?.executable).toBe(true);
    expect(height?.claimIds).toContain(ZONING_BASE_CLAIM);
    expect(height?.sourceIds).toContain("gis:src:zoning-base");
  });

  it("OVERLAY LAW: the ADU regulation depends on S6 law claim + the site's overlay claim + GIS artifact", async () => {
    const { loadBenchmarkEvidence } = await import("../../src/adapters/regulatory/benchmark-evidence");
    const { benchmarkExtractionAdapter } = await import("../../src/adapters/regulatory/benchmark-extractor");
    const input = loadBenchmarkEvidence({
      fixtureDir: join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia"),
      subject: { subjectNodeId: "phl:parcel:778273000", jurisdictionKey: "philadelphia-pa", district: "RM-1" },
    });
    const extraction = await benchmarkExtractionAdapter.extract(input);
    const prohibition = extraction.candidates.find((c) => c.semanticRuleKey === "overlay:/six:adu-prohibition");

    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [prohibition!],
      sources: input.sources,
      subject: { district: "RM-1" },
      documents: input.documents,
      ...applicabilityInput(),
    });

    const regulation = project.nodes["phl:reg:overlay:/six:adu-prohibition"];
    expect(regulation?.kind === "regulation");
    if (regulation?.kind === "regulation") {
      expect(regulation.claimIds).toContain(OVERLAY_CLAIM);
      expect(regulation.claimIds.some((id) => id.startsWith("phl:claim:overlay:/six:adu-prohibition:"))).toBe(true);
    }

    // Certificate pins BOTH the legal source and the overlay applicability source.
    recordScenario(contextFor(project), {
      scenarioId: "scenario:adu-check",
      label: "ADU check",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 8, unit: "dwelling_units" } }],
      constraintIds: ["phl:constraint:overlay:/six:adu-prohibition"],
      missionIds: [],
      assumptionIds: [],
      parcelId: "phl:parcel:778273000",
      results: [
        {
          resultId: "result:adu",
          constraintId: "phl:constraint:overlay:/six:adu-prohibition",
          status: "SATISFIED",
          explanation: "No ADUs proposed.",
        },
      ],
      certificateId: "scenario:adu-check:certificate",
    });
    const certificate = project.nodes["scenario:adu-check:certificate"];
    const pinned = new Set(
      certificate?.kind === "scenario-certificate" ? certificate.dependencies.map((d) => d.nodeId) : [],
    );
    expect(pinned.has("phl:src:S6@v1")).toBe(true); // legal source
    expect(pinned.has(OVERLAY_CLAIM)).toBe(true); // overlay applicability claim
    expect(pinned.has("gis:src:zoning-overlays")).toBe(true); // official GIS artifact
    expect(gradeCertificate(project, "scenario:adu-check:certificate").freshness).toBe("CURRENT");

    // Applicability evidence superseded -> dependent certificate non-CURRENT.
    const { addSourceArtifact, supersedeSourceArtifact } = await import("../../src/commands");
    addSourceArtifact(contextFor(project), {
      id: "gis:src:zoning-overlays@v2",
      kind: "source-artifact",
      logicalSourceKey: "gis:src:zoning-overlays",
      version: 2,
      sourceType: "official_gis",
      title: "Zoning Overlays (later retrieval)",
      publisher: "City of Philadelphia",
      canonicalUrl: "https://test.example/zoning-overlays",
      authority: "OFFICIAL_GIS",
      retrievedAt: "2026-12-01T00:00:00Z",
      rawContentHash: "c".repeat(64),
    });
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "gis:src:zoning-overlays",
      supersededBySourceId: "gis:src:zoning-overlays@v2",
      conflictedRegulationIds: [],
      note: "later overlay retrieval",
    });
    const graded = gradeCertificate(project, "scenario:adu-check:certificate");
    expect(["STALE", "INVALIDATED"]).toContain(graded.freshness);
  });

  it("FAIL CLOSED: district-scoped law without a site zoning-base claim refuses to compile", () => {
    const project = bareProject();
    expect(() =>
      compileRegulations(contextFor(project), {
        candidates: [heightCandidate("S5", 38)],
        sources: [S5_SOURCE],
        subject: { district: "RM-1" },
        documents: DOCS,
        // No applicabilityClaims.
      }),
    ).toThrow(/no site zoning-base applicability claim/);
  });
});

describe("same-source captured versions are distinct observations", () => {
  it("S5@v1 = 55 and S5@v2 = 45 -> distinct ids/claims, v1 SUPERSEDED, v2 executable, both inspectable", async () => {
    const { decideConflicts } = await import("../../src/application/regulatory/conflicts");
    const v1 = heightCandidate("S5", 55, {
      retrievedAt: "2025-01-01T00:00:00Z",
      candidateId: "cand:height:max:principal:phl:src:S5@v1:old",
      sourceArtifactId: "phl:src:S5@v1",
    });
    const v2 = heightCandidate("S5", 45, {
      retrievedAt: "2026-06-01T00:00:00Z",
      candidateId: "cand:height:max:principal:phl:src:S5@v2:new",
      sourceArtifactId: "phl:src:S5@v2",
    });
    const { dispositions } = decideConflicts([v1, v2]);
    expect(dispositions.get(v1.candidateId)?.status).toBe("SUPERSEDED");
    expect(dispositions.get(v2.candidateId)?.status).toBe("EXECUTABLE");

    // Graph: two distinct claims; the regulation cites the winner's version.
    const v1Source = testSource({
      sourceRef: "S5",
      sourceArtifactId: "phl:src:S5@v1",
      retrievedAt: "2025-01-01T00:00:00Z",
    });
    const v2Source = testSource({
      sourceRef: "S5",
      sourceArtifactId: "phl:src:S5@v2",
      retrievedAt: "2026-06-01T00:00:00Z",
    });
    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [v1, v2],
      sources: [v1Source, v2Source],
      subject: { district: "RM-1" },
      documents: testDocuments(["S5"], { S5: "maximum building height ... 55 ft\nmaximum building height ... 45 ft" }),
      ...applicabilityInput(),
    });
    expect(project.nodes["phl:claim:height:max:principal:phl:src:S5@v1"]).toBeDefined();
    expect(project.nodes["phl:claim:height:max:principal:phl:src:S5@v2"]).toBeDefined();
    const regulation = project.nodes["phl:reg:height:max:principal"];
    expect(
      regulation?.kind === "regulation" &&
        regulation.claimIds.includes("phl:claim:height:max:principal:phl:src:S5@v2"),
    ).toBe(true);
    expect(
      regulation?.kind === "regulation" &&
        regulation.claimIds.includes("phl:claim:height:max:principal:phl:src:S5@v1"),
    ).toBe(false);
    const constraint = project.nodes["phl:constraint:height:max:principal"];
    expect(constraint?.kind === "constraint" && constraint.constraintKind === "height").toBe(true);
    if (constraint?.kind === "constraint" && constraint.constraintKind === "height") {
      expect(constraint.limit.value).toBe(45);
    }
  });
});
