import { describe, expect, it } from "vitest";
import {
  addSourceArtifact,
  confirmMissionConstraint,
  recordScenario,
  supersedeSourceArtifact,
  updateStakeholderView,
  upsertRegulation,
} from "../../src/commands";
import { getDependencies, requireNode } from "../../src/domain";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import { InMemoryProjectRepository } from "../../src/adapters/persistence/project-repository";
import {
  seedWithBalanceScenario,
  contextFor,
  PARKING_CONSTRAINT_ID,
  HEIGHT_CONSTRAINT_ID,
  MISSION_PARKING_ID,
  PARCEL_ID,
  CERTIFICATE_ID,
  SCENARIO_ID,
} from "./helpers";

describe("final pass: scenario-head edge replacement", () => {
  it("re-recording replaces stale scenario-input edges with only the current head's inputs", () => {
    const project = seedWithBalanceScenario(); // v1: parking+height, mission, assumption, parcel

    // v2 drops the height constraint and the assumption entirely.
    recordScenario(contextFor(project), {
      scenarioId: SCENARIO_ID,
      label: "Balance",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 30, unit: "dwelling_units" } }],
      constraintIds: [PARKING_CONSTRAINT_ID],
      missionIds: [MISSION_PARKING_ID],
      assumptionIds: [],
      parcelId: PARCEL_ID,
      results: [
        {
          resultId: "result:parking",
          constraintId: PARKING_CONSTRAINT_ID,
          status: "SATISFIED",
          actual: { value: 0, unit: "spaces" },
          limit: { value: 0, unit: "spaces" },
          explanation: "Multi-family requires 0 spaces in RM-1.",
        },
      ],
      certificateId: CERTIFICATE_ID,
    });

    const headInputs = getDependencies(project, SCENARIO_ID)
      .filter((edge) => edge.role === "scenario-input")
      .map((edge) => edge.dependencyId);

    // Current head only: v2 result, parking constraint, mission, parcel.
    expect(headInputs).toContain("result:parking@v2");
    expect(headInputs).toContain(PARKING_CONSTRAINT_ID);
    expect(headInputs).toContain(MISSION_PARKING_ID);
    expect(headInputs).toContain(PARCEL_ID);
    // v1-only inputs are gone from the head's edges.
    expect(headInputs).not.toContain(HEIGHT_CONSTRAINT_ID);
    expect(headInputs).not.toContain("assumption:average-unit-size");
    expect(headInputs).not.toContain("result:parking"); // v1 result id
    expect(headInputs).not.toContain("result:height");

    // Historical certificate v1 is intact through its own immutable refs.
    // Note: v1 stays CURRENT here — correctly. Nothing it pinned (constraints,
    // mission, assumption, parcel) changed; only the head and outputs moved on.
    // Staleness is dependency-aware, not output-aware.
    const v1 = requireNode(project, CERTIFICATE_ID, "scenario-certificate");
    expect(v1.freshness).toBe("CURRENT");
    const v1Pins = v1.dependencies.map((ref) => ref.nodeId);
    expect(v1Pins).toContain(HEIGHT_CONSTRAINT_ID);
    expect(v1Pins).toContain("assumption:average-unit-size");
    expect(v1.constraintResultIds).toContain("result:parking"); // original v1 result retained
  });
});

describe("final pass: node-id kind integrity", () => {
  it("upserts cannot silently re-type an existing node of another kind", () => {
    const project = seedWithBalanceScenario();
    expect(() =>
      upsertRegulation(contextFor(project), {
        id: "phl:claim:far", // exists as a Claim
        kind: "regulation",
        jurisdictionKey: "philadelphia-pa",
        codeSection: "hostile takeover",
        applicability: {},
        claimIds: ["phl:claim:zoning-district"],
        currentness: "CURRENT",
        conflictRefs: [],
      }),
    ).toThrow(/never change semantic kind/i);
    expect(() =>
      confirmMissionConstraint(contextFor(project), {
        id: "phl:src:S7@v1", // exists as a SourceArtifact
        kind: "mission-constraint",
        intentText: "hostile takeover",
        normalized: { type: "retain-ownership" },
        origin: { kind: "USER_DECLARED", actorId: "attacker" },
        confirmationState: "CONFIRMED",
        hardOrSoft: "hard",
      }),
    ).toThrow(/never change semantic kind/i);
    expect(() =>
      updateStakeholderView(contextFor(project), {
        id: "phl:claim:far",
        kind: "stakeholder-view",
        audience: "board",
        title: "hostile takeover",
        visibleEvidenceDepth: "standard",
      }),
    ).toThrow(/never change semantic kind/i);
    // Nothing was overwritten:
    expect(requireNode(project, "phl:claim:far", "claim").predicate).toBe("far");
    expect(requireNode(project, "phl:src:S7@v1", "source-artifact").kind).toBe("source-artifact");
  });

  it("recordScenario rejects wrong-kind scenario ids and colliding generated result/certificate ids", () => {
    const base = {
      label: "Hostile",
      solverVersion: "test-double@0",
      status: "COMPUTED" as const,
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 1, unit: "dwelling_units" as const } }],
      constraintIds: [PARKING_CONSTRAINT_ID],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL_ID,
      results: [
        {
          resultId: "result:parking",
          constraintId: PARKING_CONSTRAINT_ID,
          status: "SATISFIED" as const,
          actual: { value: 0, unit: "spaces" as const },
          limit: { value: 0, unit: "spaces" as const },
          explanation: "x",
        },
      ],
    };

    const project = seedWithBalanceScenario();
    expect(() =>
      recordScenario(contextFor(project), { ...base, scenarioId: "phl:claim:far" }),
    ).toThrow(/never change semantic kind/i);

    // v1 result ids exist; a scenario whose v1 result id collides with an
    // existing unrelated node must fail instead of overwriting it.
    const fresh = seedWithBalanceScenario();
    expect(() =>
      recordScenario(contextFor(fresh), { ...base, scenarioId: "scenario:evil", results: [
        { ...base.results[0], resultId: "phl:claim:far" },
      ] }),
    ).toThrow(/never change semantic kind/i);

    // Certificate id collision (base id already used by an unrelated node).
    const fresh2 = seedWithBalanceScenario();
    expect(() =>
      recordScenario(contextFor(fresh2), {
        ...base,
        scenarioId: "scenario:evil2",
        certificateId: "phl:claim:far",
      }),
    ).toThrow(/never change semantic kind/i);
  });
});

describe("final pass: supersession history immutability", () => {
  const addVersion = (project: Parameters<typeof contextFor>[0], version: number) =>
    addSourceArtifact(contextFor(project), {
      id: `phl:src:S7@v${version}`,
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S7",
      version,
      sourceType: "adopted_code",
      title: `The Philadelphia Code § 14-802 (capture v${version})`,
      publisher: "City of Philadelphia",
      canonicalUrl: "https://codelibrary.amlegal.com/codes/philadelphia/latest/philadelphia_pa/0-0-0-293741",
      authority: "ADOPTED_CODE",
      retrievedAt: `2026-12-0${version}T00:00:00.000Z`,
      rawContentHash: `${String(version).repeat(64)}`,
      versionNote: "re-verification capture",
    });

  it("a superseded source cannot be re-pointed to a different successor", () => {
    const project = seedWithBalanceScenario();
    addVersion(project, 2);
    addVersion(project, 3);
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "phl:src:S7@v1",
      supersededBySourceId: "phl:src:S7@v2",
      conflictedRegulationIds: [],
    });
    const eventsAfterFirst = project.events.length;
    const artifact = requireNode(project, "phl:src:S7@v1", "source-artifact");

    // Re-pointing v1 to v3 rewrites history: rejected.
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S7@v1",
        supersededBySourceId: "phl:src:S7@v3",
        conflictedRegulationIds: [],
      }),
    ).toThrow(/supersession history is immutable/i);
    expect(artifact.supersededBy).toBe("phl:src:S7@v2");

    // Same target again: idempotent no-op (no event, no revision change).
    supersedeSourceArtifact(contextFor(project), {
      sourceId: "phl:src:S7@v1",
      supersededBySourceId: "phl:src:S7@v2",
      conflictedRegulationIds: [],
    });
    expect(project.events.length).toBe(eventsAfterFirst);
    expect(artifact.meta.revision).toBe(2);

    // The correct way to advance: supersede v2 (the current head) by v3.
    expect(() =>
      supersedeSourceArtifact(contextFor(project), {
        sourceId: "phl:src:S7@v2",
        supersededBySourceId: "phl:src:S7@v3",
        conflictedRegulationIds: [],
      }),
    ).not.toThrow();
  });
});

describe("final pass: encode-side integrity validation", () => {
  it("encode rejects malformed in-memory state instead of storing it", () => {
    const project = seedWithBalanceScenario();
    // Corrupt a node semantically without recomputing its hash.
    const claim = requireNode(project, "phl:claim:far", "claim");
    (claim as unknown as { notes?: string }).notes = "tampered without touchNode";
    expect(() => ProjectCodec.encode(project)).toThrow(/semanticHash mismatch/i);
  });

  it("repository.save rejects corrupted state through the encode-side check", async () => {
    const repository = new InMemoryProjectRepository();
    const project = seedWithBalanceScenario();
    delete project.nodes["phl:src:S7@v1"]; // dangling edges
    await expect(repository.save(project, project.revision)).rejects.toThrow(/integrity/i);
  });

  it("a clean project still encodes, saves, and loads", async () => {
    const repository = new InMemoryProjectRepository();
    const project = seedWithBalanceScenario();
    await repository.save(project, project.revision);
    const loaded = await repository.get(project.projectId);
    expect(loaded?.revision).toBe(project.revision);
  });
});
