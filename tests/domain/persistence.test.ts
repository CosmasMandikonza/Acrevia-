import { describe, expect, it } from "vitest";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import {
  InMemoryProjectRepository,
  RevisionConflictError,
} from "../../src/adapters/persistence/project-repository";
import {
  getEvidenceChain,
  gradeCertificate,
  requireNode,
  nodesOfKind,
} from "../../src/domain";
import {
  seedWithBalanceScenario,
  confirmMissionParking,
  CERTIFICATE_ID,
  PARKING_CONSTRAINT_ID,
} from "./helpers";

describe("ProjectCodec round trip", () => {
  it("loses no provenance, relation, unit, state, revision, or dependency information", () => {
    const project = seedWithBalanceScenario();
    const encoded = ProjectCodec.encode(project);
    const decoded = ProjectCodec.decode(encoded);

    expect(decoded.revision).toBe(project.revision);
    expect(decoded.events).toHaveLength(project.events.length);
    expect(Object.keys(decoded.nodes).sort()).toEqual(Object.keys(project.nodes).sort());
    expect(decoded.edges).toHaveLength(project.edges.length);

    for (const [id, node] of Object.entries(decoded.nodes)) {
      const original = requireNode(project, id);
      expect(node.kind).toBe(original.kind);
      expect(node.meta.revision).toBe(original.meta.revision);
      expect(node.meta.semanticHash).toBe(original.meta.semanticHash);
    }

    // Semantic spot checks survive:
    const parking = requireNode(decoded, PARKING_CONSTRAINT_ID, "constraint");
    if (parking.constraintKind === "parking-requirement") {
      expect(parking.requirement).toEqual({
        type: "fixed",
        spaces: { value: 0, unit: "spaces" },
      });
    }
    expect(requireNode(decoded, "phl:claim:far", "claim").value).toEqual({
      type: "null",
      reason: "unknown",
    });
    expect(gradeCertificate(decoded, CERTIFICATE_ID).freshness).toBe("CURRENT");

    // Provenance traversal still works after the round trip:
    const chain = JSON.stringify(getEvidenceChain(decoded, PARKING_CONSTRAINT_ID));
    expect(chain).toContain("phl:src:S7@v1");
  });

  it("encoded output is deterministic across independent seeds", () => {
    expect(ProjectCodec.encode(seedWithBalanceScenario())).toBe(
      ProjectCodec.encode(seedWithBalanceScenario()),
    );
  });

  it("corrupt or foreign data fails validation on decode, loudly", () => {
    expect(() => ProjectCodec.decode("{not json")).toThrow();
    expect(() => ProjectCodec.decode('{"projectId":123}')).toThrow();
    const project = seedWithBalanceScenario();
    const decoded = JSON.parse(ProjectCodec.encode(project));
    decoded.nodes["phl:claim:far"].evidenceState = "MADE_UP_STATE";
    expect(() => ProjectCodec.decode(JSON.stringify(decoded))).toThrow();
  });
});

describe("InMemoryProjectRepository optimistic concurrency", () => {
  it("saves against the expected revision and rejects stale saves", async () => {
    const repository = new InMemoryProjectRepository();
    const first = seedWithBalanceScenario();
    const expected = first.revision;
    await repository.save(first, expected);

    // Collaborator A and B both load revision N.
    const a = await repository.get(first.projectId);
    const b = await repository.get(first.projectId);
    expect(a?.revision).toBe(expected);
    expect(b?.revision).toBe(expected);
    if (!a || !b) throw new Error("unreachable");

    // A saves first: succeeds.
    confirmMissionParking(a, 100);
    await repository.save(a, expected);

    // B saves against the same stale expected revision: must fail loudly.
    confirmMissionParking(b, 120);
    await expect(repository.save(b, expected)).rejects.toBeInstanceOf(RevisionConflictError);
    try {
      await repository.save(b, expected);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        expect(error.storedRevision).toBe(a.revision);
        expect(error.expectedRevision).toBe(expected);
      }
    }

    // The stored project is A's, not silently overwritten by B:
    const stored = await repository.get(first.projectId);
    const mission = requireNode(stored as never, "mission:min-sunday-parking", "mission-constraint");
    if (mission.normalized.type === "min-parking") {
      expect(mission.normalized.spaces.value).toBe(100);
    }
  });

  it("get() decodes through the codec, so reads are validated round trips", async () => {
    const repository = new InMemoryProjectRepository();
    const project = seedWithBalanceScenario();
    await repository.save(project, project.revision);
    const loaded = await repository.get(project.projectId);
    expect(nodesOfKind(loaded as never, "source-artifact")).toHaveLength(13);
    expect(await repository.get("missing")).toBeNull();
  });

  it("first save conflicts with nothing (no stored state to lose)", async () => {
    const repository = new InMemoryProjectRepository();
    const project = seedWithBalanceScenario();
    await repository.save(project, project.revision);
    const loaded = await repository.get(project.projectId);
    expect(loaded?.revision).toBe(project.revision);
  });
});
