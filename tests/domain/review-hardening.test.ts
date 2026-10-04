import { describe, expect, it } from "vitest";
import {
  addSourceArtifact,
  materializeConstraint,
  recordClaim,
  supersedeSourceArtifact,
  upsertRegulation,
} from "../../src/commands";
import {
  getDependencies,
  requireNode,
  nodesOfKind,
  explainMetric,
} from "../../src/domain";
import {
  QuantityRange,
  FeetQuantity,
  SpacesQuantity,
  StoriesQuantity,
} from "../../src/domain/units/quantity";
import { heightVariant } from "../../src/domain/constraints/constraint";
import { MissionNormalized } from "../../src/domain/constraints/mission";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import {
  seedPhiladelphiaProject,
  seedWithBalanceScenario,
  confirmMissionParking,
  recordBalanceScenario,
  contextFor,
  PARKING_CONSTRAINT_ID,
  CERTIFICATE_ID,
  SCENARIO_ID,
} from "./helpers";

const LATER_CAPTURE_BASE = {
  kind: "source-artifact" as const,
  logicalSourceKey: "phl:src:S7",
  sourceType: "adopted_code" as const,
  title: "The Philadelphia Code § 14-802 Motor Vehicle Parking Ratios (later retrieval)",
  publisher: "City of Philadelphia",
  canonicalUrl:
    "https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-293741",
  authority: "ADOPTED_CODE" as const,
  retrievedAt: "2026-12-01T00:00:00.000Z",
  versionNote: "re-verification capture",
};

describe("review hardening: historical certificates preserve historical outputs", () => {
  it("v1 certificate still resolves original v1 metrics/results after v2 recomputation", () => {
    const project = seedWithBalanceScenario();

    // v1 proof: 34 homes.
    const v1 = requireNode(project, CERTIFICATE_ID, "scenario-certificate");
    expect(v1.metricsSnapshot).toEqual([
      { metricId: "homes", label: "Homes", value: { value: 34, unit: "dwelling_units" } },
    ]);
    const v1ResultIds = [...v1.constraintResultIds];

    // Mission changes; solver recomputes at 26 homes.
    confirmMissionParking(project, 100);
    recordBalanceScenario(project, { homes: 26 });

    // v1 certificate is untouched and still resolves its ORIGINAL outputs.
    const v1After = requireNode(project, CERTIFICATE_ID, "scenario-certificate");
    expect(v1After.meta.revision).toBe(1);
    expect(v1After.metricsSnapshot[0]?.value).toEqual({ value: 34, unit: "dwelling_units" });
    expect(v1After.constraintResultIds).toEqual(v1ResultIds);
    for (const resultId of v1ResultIds) {
      const result = requireNode(project, resultId, "constraint-result");
      expect(result.meta.revision).toBe(1); // v1 results were never mutated
    }

    // v2 is a NEW certificate with NEW results and the NEW metrics.
    const v2 = requireNode(project, "scenario:balance:certificate:v2", "scenario-certificate");
    expect(v2.certificateVersion).toBe(2);
    expect(v2.metricsSnapshot[0]?.value).toEqual({ value: 26, unit: "dwelling_units" });
    expect(v2.constraintResultIds).not.toEqual(v1ResultIds); // versioned result ids
    expect(v2.constraintResultIds.join(",")).toContain("@v2");

    // The scenario head points at the newest proof; v1 proof retained.
    const scenario = requireNode(project, SCENARIO_ID, "scenario");
    expect(scenario.certificateId).toBe("scenario:balance:certificate:v2");
    expect(nodesOfKind(project, "scenario-certificate").map((c) => c.id).sort()).toEqual([
      CERTIFICATE_ID,
      "scenario:balance:certificate:v2",
    ]);
  });
});

describe("review hardening: source-version immutability", () => {
  it("rejects overwriting an existing source version with changed content", () => {
    const project = seedPhiladelphiaProject();
    const before = JSON.stringify(project.nodes["phl:src:S7@v1"]);
    expect(() =>
      addSourceArtifact(contextFor(project), {
        id: "phl:src:S7@v1",
        ...LATER_CAPTURE_BASE,
        version: 1,
        rawContentHash: "changed-content-hash-000000000000000000000000000000000000000000000",
      }),
    ).toThrow(/immutable/i);
    expect(JSON.stringify(project.nodes["phl:src:S7@v1"])).toBe(before);
  });

  it("treats exact replay of the same capture as an idempotent no-op", () => {
    const project = seedPhiladelphiaProject();
    const artifact = requireNode(project, "phl:src:S7@v1", "source-artifact");
    const before = artifact.meta.revision;
    addSourceArtifact(contextFor(project), {
      id: "phl:src:S7@v1",
      kind: "source-artifact",
      logicalSourceKey: artifact.logicalSourceKey,
      version: artifact.version,
      sourceType: artifact.sourceType,
      title: artifact.title,
      publisher: artifact.publisher,
      canonicalUrl: artifact.canonicalUrl,
      authority: artifact.authority,
      retrievedAt: artifact.retrievedAt,
      rawContentHash: artifact.rawContentHash,
      rawEvidenceRef: artifact.rawEvidenceRef,
      notes: artifact.notes,
    });
    expect(artifact.meta.revision).toBe(before);
  });

  it("rejects supersession across different logical sources", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S6@v1",
        supersededBySourceId: "phl:src:S7@v1",
        conflictedRegulationIds: [],
      }),
    ).toThrow(/across logical sources/i);
  });

  it("rejects backwards and same-version supersession", () => {
    const project = seedPhiladelphiaProject();
    addSourceArtifact(contextFor(project), {
      ...LATER_CAPTURE_BASE,
      id: "phl:src:S7@v2",
      version: 2,
      rawContentHash: "bbb111bbb111bbb111bbb111bbb111bbb111bbb111bbb111bbb111bbb111bbb1",
    });
    addSourceArtifact(contextFor(project), {
      ...LATER_CAPTURE_BASE,
      id: "phl:src:S7@v3",
      version: 3,
      rawContentHash: "ccc222ccc222ccc222ccc222ccc222ccc222ccc222ccc222ccc222ccc222ccc2",
    });
    // v3 -> v2 is backwards.
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S7@v3",
        supersededBySourceId: "phl:src:S7@v2",
        conflictedRegulationIds: [],
      }),
    ).toThrow(/strictly newer/i);
    // v1 -> v1 is not newer (rejected as self-supersession, which is the
    // strongest form of "not strictly newer").
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S7@v1",
        supersededBySourceId: "phl:src:S7@v1",
        conflictedRegulationIds: [],
      }),
    ).toThrow(/cannot supersede itself|strictly newer/i);
    // v1 -> v3 is valid.
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S7@v1",
        supersededBySourceId: "phl:src:S7@v3",
        conflictedRegulationIds: [],
      }),
    ).not.toThrow();
  });
});

describe("review hardening: upserts keep edges and revisions consistent", () => {
  it("regulation upsert replaces stale evidence edges and bumps revision monotonically", () => {
    const project = seedPhiladelphiaProject();
    const regulationId = "phl:reg:edge-replacement-test";

    upsertRegulation(contextFor(project), {
      id: regulationId,
      kind: "regulation",
      jurisdictionKey: "philadelphia-pa",
      codeSection: "test section",
      applicability: {},
      claimIds: ["phl:claim:zoning-district"],
      currentness: "CURRENT",
      conflictRefs: [],
    });
    expect(getDependencies(project, regulationId).map((e) => e.dependencyId)).toEqual([
      "phl:claim:zoning-district",
    ]);

    upsertRegulation(contextFor(project), {
      id: regulationId,
      kind: "regulation",
      jurisdictionKey: "philadelphia-pa",
      codeSection: "test section (revised)",
      applicability: {},
      claimIds: ["phl:claim:parking-multifamily"],
      currentness: "CURRENT",
      conflictRefs: [],
    });

    const dependencies = getDependencies(project, regulationId).map((e) => e.dependencyId);
    expect(dependencies).toContain("phl:claim:parking-multifamily");
    expect(dependencies).not.toContain("phl:claim:zoning-district");
    expect(requireNode(project, regulationId).meta.revision).toBe(2);
  });

  it("create-style commands reject existing ids instead of resetting revisions", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      recordClaim(contextFor(project), {
        id: "phl:claim:far",
        kind: "claim",
        subjectNodeId: "phl:parcel:778273000",
        predicate: "far",
        value: { type: "null", reason: "unknown" },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: ["phl:src:S5@v1"],
        evidenceState: "UNKNOWN",
      }),
    ).toThrow(/create-only/i);
    expect(() =>
      materializeConstraint(contextFor(project), {
        id: PARKING_CONSTRAINT_ID,
        kind: "constraint",
        constraintKind: "parking-requirement",
        regulationId: "phl:reg:parking-multifamily",
        use: "multi-family",
        requirement: { type: "fixed", spaces: { value: 0, unit: "spaces" } },
      } as never),
    ).toThrow(/create-only/i);
  });
});

describe("review hardening: typed units and claim semantics", () => {
  it("rejects dimensionally invalid quantities", () => {
    expect(() => heightVariant.parse({
      id: "c:height-usd",
      kind: "constraint",
      constraintKind: "height",
      regulationId: "r:1",
      limit: { value: 38, unit: "usd" },
      appliesTo: "principal-structure",
    })).toThrow();
    expect(() => MissionNormalized.parse({
      type: "min-parking",
      spaces: { value: 100, unit: "ft" },
    })).toThrow();
    expect(() => MissionNormalized.parse({
      type: "max-stories",
      stories: { value: 3, unit: "spaces" },
    })).toThrow();
    // And the valid forms parse.
    expect(FeetQuantity.parse({ value: 38, unit: "ft" })).toEqual({ value: 38, unit: "ft" });
    expect(SpacesQuantity.parse({ value: 100, unit: "spaces" })).toEqual({
      value: 100,
      unit: "spaces",
    });
    expect(StoriesQuantity.parse({ value: 3, unit: "stories" })).toEqual({
      value: 3,
      unit: "stories",
    });
  });

  it("rejects ranges without bounds and ranges where min exceeds max", () => {
    expect(() => QuantityRange.parse({ unit: "ft" })).toThrow(/at least one bound/i);
    expect(() => QuantityRange.parse({ min: 12, max: 5, unit: "ft" })).toThrow(/min exceeds max/i);
    expect(QuantityRange.parse({ min: 5, max: 12, unit: "ft" })).toBeTruthy();
    expect(QuantityRange.parse({ min: 5, unit: "ft" })).toBeTruthy();
  });

  it("rejects evidence states on declared claims (origin is not evidence)", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      recordClaim(contextFor(project), {
        id: "claim:declared-with-evidence",
        kind: "claim",
        subjectNodeId: "phl:parcel:778273000",
        predicate: "parcel-area",
        value: { type: "qualitative", text: "declared" },
        origin: { kind: "USER_DECLARED", actorId: "board" },
        sourceIds: [],
        evidenceState: "VERIFIED",
      }),
    ).toThrow(/must not carry an evidence state/i);
  });
});

describe("review hardening: explainMetric is scenario-explicit", () => {
  it("returns the correct scenario's chain when both scenarios define 'homes'", () => {
    const project = seedWithBalanceScenario();
    // Second scenario, same metric id, different value and certificate.
    recordBalanceScenario(project, {
      scenarioId: "scenario:community",
      label: "Community",
      homes: 41,
      certificateId: "scenario:community:certificate",
      resultIdPrefix: "community-",
    });

    const community = explainMetric(project, "scenario:community", "homes");
    expect(community.scenarioId).toBe("scenario:community");
    expect(community.certificateId).toBe("scenario:community:certificate");
    expect(community.metricsSnapshot[0]?.value).toEqual({ value: 41, unit: "dwelling_units" });

    const balance = explainMetric(project, "scenario:balance", "homes");
    expect(balance.scenarioId).toBe("scenario:balance");
    expect(balance.metricsSnapshot[0]?.value).toEqual({ value: 34, unit: "dwelling_units" });
  });
});

describe("review hardening: ProjectCodec integrity rejections", () => {
  const tamper = (mutate: (decoded: Record<string, unknown>) => void): string => {
    const project = seedWithBalanceScenario();
    const decoded = JSON.parse(ProjectCodec.encode(project));
    mutate(decoded);
    return JSON.stringify(decoded);
  };

  it("rejects a node whose map key does not match its id", () => {
    const json = tamper((decoded) => {
      const nodes = decoded.nodes as Record<string, unknown>;
      nodes["phl:wrong-key"] = nodes["phl:src:S7@v1"];
      delete nodes["phl:src:S7@v1"];
    });
    expect(() => ProjectCodec.decode(json)).toThrow(/map key/i);
  });

  it("rejects a tampered semanticHash", () => {
    const json = tamper((decoded) => {
      const node = (decoded.nodes as Record<string, unknown>)["phl:claim:far"] as Record<string, unknown>;
      const meta = node.meta as Record<string, string>;
      meta.semanticHash = "0".repeat(64);
    });
    expect(() => ProjectCodec.decode(json)).toThrow(/semanticHash mismatch/i);
  });

  it("rejects a tampered certificateHash", () => {
    const json = tamper((decoded) => {
      const cert = (decoded.nodes as Record<string, unknown>)[CERTIFICATE_ID] as Record<string, unknown>;
      cert.certificateHash = "0".repeat(64);
    });
    expect(() => ProjectCodec.decode(json)).toThrow(/certificateHash mismatch/i);
  });

  it("rejects edges that reference missing nodes", () => {
    const json = tamper((decoded) => {
      (decoded.edges as Array<Record<string, string>>).push({
        dependentId: "phl:ghost",
        dependencyId: "phl:src:S7@v1",
        role: "supported-by",
      });
    });
    expect(() => ProjectCodec.decode(json)).toThrow(/missing dependent/i);
  });

  it("rejects an unresolvable propertyId", () => {
    const json = tamper((decoded) => {
      decoded.propertyId = "phl:property:nowhere";
    });
    expect(() => ProjectCodec.decode(json)).toThrow(/propertyId/i);
  });

  it("accepts a legitimate round trip", () => {
    const project = seedWithBalanceScenario();
    const decoded = ProjectCodec.decode(ProjectCodec.encode(project));
    expect(decoded.revision).toBe(project.revision);
  });
});
