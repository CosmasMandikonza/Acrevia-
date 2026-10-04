import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createSha256,
  computeSemanticHash,
  computeCertificateHash,
} from "../../src/domain";
import { canonicalSemanticJson } from "../../src/domain/graph/node";
import { mapBenchmarkToProject } from "../../src/adapters/benchmarks";
import { addSourceArtifact, supersedeSourceArtifact } from "../../src/commands";
import { requireNode } from "../../src/domain";
import {
  seedWithBalanceScenario,
  seedPhiladelphiaProject,
  confirmMissionParking,
  contextFor,
  PHILADELPHIA_FIXTURE_DIR,
} from "./helpers";

describe("canonical serialization and hashing", () => {
  it("identical semantic project state serializes identically", () => {
    const a = seedWithBalanceScenario();
    const b = seedWithBalanceScenario();
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(createSha256(canonicalJson(a))).toBe(createSha256(canonicalJson(b)));
  });

  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("omits undefined fields and rejects non-finite numbers", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("volatile fields are excluded from semantic hashes (timestamps never drift a hash)", () => {
    const project = seedPhiladelphiaProject();
    const artifact = requireNode(project, "phl:src:S7@v1", "source-artifact");
    const hashBefore = artifact.meta.semanticHash;
    artifact.retrievedAt = "2099-01-01T00:00:00.000Z";
    expect(computeSemanticHash(artifact)).toBe(hashBefore);
    artifact.retrievedAt = "2026-10-04T04:30:00.000Z";
    expect(computeSemanticHash(artifact)).toBe(hashBefore);
  });

  it("refreshing staleness never creates a semantic-hash mismatch (freshness is derived)", () => {
    const project = seedWithBalanceScenario();
    const certificate = requireNode(project, "scenario:balance:certificate", "scenario-certificate");
    confirmMissionParking(project, 100);
    expect(certificate.freshness).toBe("STALE");
    expect(computeSemanticHash(certificate)).toBe(certificate.meta.semanticHash);
    expect(certificate.meta.revision).toBe(1); // derived mutation does not bump revisions
  });

  it("semanticHash and rawContentHash are distinct concepts on SourceArtifact", () => {
    const project = seedPhiladelphiaProject();
    const artifact = requireNode(project, "phl:src:S7@v1", "source-artifact");
    expect(artifact.rawContentHash).toBeDefined();
    expect(artifact.meta.semanticHash).toBeDefined();
    expect(artifact.rawContentHash).not.toBe(artifact.meta.semanticHash);
    const again = seedPhiladelphiaProject();
    expect(requireNode(again, "phl:src:S7@v1", "source-artifact").rawContentHash).toBe(
      artifact.rawContentHash,
    );
  });

  it("supersededBy IS semantic: supersession changes the artifact's semanticHash", () => {
    const project = seedPhiladelphiaProject();
    addSourceArtifact(contextFor(project), {
      id: "phl:src:S6@v2",
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S6",
      version: 2,
      sourceType: "adopted_code",
      title: "The Philadelphia Code § 14-548 (later retrieval)",
      publisher: "City of Philadelphia",
      canonicalUrl: "https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-308864",
      authority: "ADOPTED_CODE",
      retrievedAt: "2026-12-01T00:00:00.000Z",
      rawContentHash: "abc456abc456abc456abc456abc456abc456abc456abc456abc456abc456abc4",
      versionNote: "re-verification capture",
    });
    const artifact = requireNode(project, "phl:src:S6@v1", "source-artifact");
    const hashBefore = artifact.meta.semanticHash;
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "phl:src:S6@v1",
      supersededBySourceId: "phl:src:S6@v2",
      conflictedRegulationIds: [],
      note: "later retrieval of the same logical source",
    });
    expect(artifact.meta.semanticHash).not.toBe(hashBefore);
    expect(artifact.meta.revision).toBe(2);
  });

  it("certificateHash excludes generatedAt and freshness", () => {
    const project = seedWithBalanceScenario();
    const certificate = requireNode(project, "scenario:balance:certificate", "scenario-certificate");
    const recompute = (cert: typeof certificate) =>
      computeCertificateHash({
        id: cert.id,
        scenarioId: cert.scenarioId,
        certificateVersion: cert.certificateVersion,
        solverVersion: cert.solverVersion,
        dependencies: cert.dependencies,
        assumptionIds: cert.assumptionIds,
        constraintResultIds: cert.constraintResultIds,
        metricsSnapshot: cert.metricsSnapshot,
      });
    const before = recompute(certificate);
    certificate.generatedAt = "2099-01-01T00:00:00.000Z";
    certificate.freshness = "STALE";
    expect(recompute(certificate)).toBe(before);
  });
});

describe("recovery critique: semantic determinism across build times", () => {
  it("projects built at different wall-clock times are semantically identical", () => {
    const morning = mapBenchmarkToProject({
      fixtureDir: PHILADELPHIA_FIXTURE_DIR,
      now: () => "2026-10-04T08:00:00.000Z",
    });
    const night = mapBenchmarkToProject({
      fixtureDir: PHILADELPHIA_FIXTURE_DIR,
      now: () => "2026-10-04T23:59:59.999Z",
    });
    expect(canonicalJson(morning) === canonicalJson(night)).toBe(false);
    expect(canonicalSemanticJson(morning)).toBe(canonicalSemanticJson(night));
  });
});
