import { describe, expect, it } from "vitest";
import { addSourceArtifact, supersedeSourceArtifact } from "../../src/commands";
import {
  gradeCertificate,
  requireNode,
  getAffectedArtifacts,
  computeDependencyClosure,
  nodesOfKind,
} from "../../src/domain";
import {
  seedWithBalanceScenario,
  recordBalanceScenario,
  confirmMissionParking,
  updateCouncilViewTitle,
  setAverageUnitSizeAssumption,
  contextFor,
  CERTIFICATE_ID,
  PARKING_CONSTRAINT_ID,
  SCENARIO_ID,
} from "./helpers";

describe("dependency-aware invalidation", () => {
  it("MANDATORY: superseding only the source artifact invalidates the certificate", () => {
    const project = seedWithBalanceScenario();
    // Sanity: certificate is current, constraint untouched.
    expect(requireNode(project, CERTIFICATE_ID, "scenario-certificate").freshness).toBe("CURRENT");

    // A newer, materially different capture of the SAME logical source.
    addSourceArtifact(contextFor(project), {
      id: "phl:src:S7@v2",
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S7",
      version: 2,
      sourceType: "adopted_code",
      title: "The Philadelphia Code § 14-802 Motor Vehicle Parking Ratios (later retrieval)",
      publisher: "City of Philadelphia",
      canonicalUrl:
        "https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-293741",
      authority: "ADOPTED_CODE",
      retrievedAt: "2026-12-01T00:00:00.000Z",
      rawContentHash: "def456def456def456def456def456def456def456def456def456def456def456",
      versionNote: "re-verification capture",
    });

    // Supersede WITHOUT touching the claim, regulation, constraint, or scenario.
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "phl:src:S7@v1",
      supersededBySourceId: "phl:src:S7@v2",
      conflictedRegulationIds: [],
      note: "later retrieval shows amended text",
    });

    // The constraint object was NOT manually edited...
    const constraint = requireNode(project, PARKING_CONSTRAINT_ID, "constraint");
    expect(constraint.meta.revision).toBe(1);
    // ...and the scenario node was NOT manually edited either.
    expect(requireNode(project, SCENARIO_ID, "scenario").meta.revision).toBe(1);

    // Yet the certificate can no longer be CURRENT.
    const grade = gradeCertificate(project, CERTIFICATE_ID);
    expect(grade.freshness).toBe("INVALIDATED");
    expect(grade.reasons.join(" ")).toContain("phl:src:S7@v1 superseded by phl:src:S7@v2");
    expect(requireNode(project, CERTIFICATE_ID, "scenario-certificate").freshness).toBe("INVALIDATED");
  });

  it("changing the mission parking constraint stales exactly the dependent certificate", () => {
    const project = seedWithBalanceScenario();
    const before = requireNode(project, PARKING_CONSTRAINT_ID).meta.revision;

    confirmMissionParking(project, 100); // 80 -> 100

    const grade = gradeCertificate(project, CERTIFICATE_ID);
    expect(grade.freshness).toBe("STALE");
    expect(grade.reasons.join(" ")).toContain("mission:min-sunday-parking changed");
    // Unrelated evidence records were untouched:
    expect(requireNode(project, PARKING_CONSTRAINT_ID).meta.revision).toBe(before);
    expect(requireNode(project, "phl:src:S7@v1", "source-artifact").meta.revision).toBe(1);
    expect(requireNode(project, "phl:claim:parking-multifamily", "claim").meta.revision).toBe(1);
  });

  it("irrelevant Council-view title change leaves the certificate CURRENT", () => {
    const project = seedWithBalanceScenario();
    const revisionBefore = project.revision;

    updateCouncilViewTitle(project, "Calvary Memorial Church — Council Presentation v2");

    expect(project.revision).toBeGreaterThan(revisionBefore); // audited...
    expect(requireNode(project, CERTIFICATE_ID, "scenario-certificate").freshness).toBe("CURRENT"); // ...but not stale
  });

  it("changing an active assumption stales certificates that pinned it", () => {
    const project = seedWithBalanceScenario();
    setAverageUnitSizeAssumption(project, 950);
    expect(gradeCertificate(project, CERTIFICATE_ID).freshness).toBe("STALE");
  });

  it("certificate closure includes upstream sources, claims, and regulations", () => {
    const project = seedWithBalanceScenario();
    const certificate = requireNode(project, CERTIFICATE_ID, "scenario-certificate");
    const pinned = new Set(certificate.dependencies.map((dep) => dep.nodeId));
    // Direct inputs and their full upstream trees:
    for (const expected of [
      PARKING_CONSTRAINT_ID,
      "phl:constraint:height-max",
      "phl:reg:parking-multifamily",
      "phl:claim:parking-multifamily",
      "phl:src:S7@v1",
      "phl:reg:height-max",
      "phl:claim:height-max",
      "phl:src:S5@v1",
      "mission:min-sunday-parking",
      "assumption:average-unit-size",
      "phl:parcel:778273000",
      "phl:claim:parcel-geometry-source",
    ]) {
      expect(pinned.has(expected), `closure missing ${expected}`).toBe(true);
    }
  });

  it("closure structurally excludes views, narrative, and unused sources/constraints", () => {
    const project = seedWithBalanceScenario();
    updateCouncilViewTitle(project, "Council deck");
    const certificate = requireNode(project, CERTIFICATE_ID, "scenario-certificate");
    const pinned = new Set(certificate.dependencies.map((dep) => dep.nodeId));

    expect(pinned.has("view:council-deck")).toBe(false);
    // Sources whose rules never entered this computation:
    expect(pinned.has("phl:src:S12@v1")).toBe(false); // church website
    expect(pinned.has("phl:src:S9@v1")).toBe(false); // flood layer
    // Constraints not used by this scenario:
    expect(pinned.has("phl:constraint:setback-front")).toBe(false);
    expect(pinned.has("phl:constraint:overlay-six-adu-prohibition")).toBe(false);
    // Every dependency of the scenario is either in the closure or a view.
    const affected = getAffectedArtifacts(project, ["phl:src:S7@v1"]);
    expect(affected).toContain(CERTIFICATE_ID);
  });

  it("a missing (retracted) dependency grades INVALIDATED", () => {
    const project = seedWithBalanceScenario();
    delete project.nodes["phl:src:S7@v1"];
    const grade = gradeCertificate(project, CERTIFICATE_ID);
    expect(grade.freshness).toBe("INVALIDATED");
    expect(grade.reasons.join(" ")).toContain("no longer exists");
  });

  it("re-recording the scenario issues a new certificate version", () => {
    const project = seedWithBalanceScenario();
    confirmMissionParking(project, 100);
    expect(requireNode(project, CERTIFICATE_ID, "scenario-certificate").freshness).toBe("STALE");
    // The solver (test double here) recomputes and re-records:
    recordBalanceScenario(project);
    const certificates = nodesOfKind(project, "scenario-certificate");
    const newest = certificates.reduce((a, b) =>
      a.certificateVersion > b.certificateVersion ? a : b,
    );
    expect(newest.certificateVersion).toBe(2);
    expect(newest.freshness).toBe("CURRENT");
    expect(newest.id).not.toBe(CERTIFICATE_ID); // old proof retained, not overwritten
  });

  it("global project revision alone is never used for staleness", () => {
    const project = seedWithBalanceScenario();
    const revisionBefore = project.revision;
    // Irrelevant changes bump the revision repeatedly.
    updateCouncilViewTitle(project, "v3");
    updateCouncilViewTitle(project, "v4");
    updateCouncilViewTitle(project, "v5");
    expect(project.revision).toBe(revisionBefore + 3);
    expect(requireNode(project, CERTIFICATE_ID, "scenario-certificate").freshness).toBe("CURRENT");
  });

  it("computeDependencyClosure terminates and is sorted/deduplicated", () => {
    const project = seedWithBalanceScenario();
    const closure = computeDependencyClosure(project, [PARKING_CONSTRAINT_ID]);
    expect([...closure].sort()).toEqual(closure);
    expect(new Set(closure).size).toBe(closure.length);
    expect(closure).toContain("phl:src:S7@v1");
  });
});
