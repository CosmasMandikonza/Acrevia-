import { describe, expect, it } from "vitest";
import { confirmMissionConstraint, recordScenario } from "../../src/commands";
import { createExistingStructure } from "../../src/commands/site";
import {
  getDependencies,
  gradeCertificate,
  refreshStaleness,
  requireNode,
  touchNode,
  type Project,
} from "../../src/domain";
import { contextFor, PARCEL_ID, PARKING_CONSTRAINT_ID, seedPhiladelphiaProject } from "../domain/helpers";

/**
 * Development Graph integrity for preserve-structure mission rules (PR #26
 * final review): the rule must not merely CARRY a canonical structureId — it
 * must be CONNECTED to the canonical structure node by an explicit
 * `mission-applies-to` dependency edge, so scenario certificates that depend
 * on sanctuary preservation pin (and stale on) the actual structure geometry
 * through the normal edge-traversing closure machinery.
 */

const SANCTUARY = "gis:structure:test-sanctuary";
const ANNEX = "gis:structure:test-annex";
const MISSION_ID = "mission:preserve-sanctuary";
const NOW = "2026-10-06T00:00:00.000Z";

function seedWithStructures(): Project {
  const project = seedPhiladelphiaProject();
  for (const id of [SANCTUARY, ANNEX]) {
    createExistingStructure(contextFor(project), {
      id,
      parcelId: PARCEL_ID,
      attributeClaimIds: [],
      notes: `test structure ${id}`,
    });
  }
  return project;
}

function confirmPreserve(project: Project, structureId: string, id = MISSION_ID): void {
  confirmMissionConstraint(contextFor(project), {
    id,
    kind: "mission-constraint",
    intentText: "Keep the sanctuary.",
    normalized: { type: "preserve-structure", structureId },
    origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
}

function missionAppliesToEdges(project: Project, id = MISSION_ID) {
  return getDependencies(project, id).filter((edge) => edge.role === "mission-applies-to");
}

describe("mission-applies-to dependency edge", () => {
  it("confirm preserve-structure creates exactly one edge to the canonical structure node", () => {
    const project = seedWithStructures();
    confirmPreserve(project, SANCTUARY);
    const edges = missionAppliesToEdges(project);
    expect(edges).toHaveLength(1);
    expect(edges[0].dependencyId).toBe(SANCTUARY);
    expect(project.nodes[edges[0].dependencyId]?.kind).toBe("structure");
  });

  it("retargeting structure A -> B replaces the edge (no stale A edge)", () => {
    const project = seedWithStructures();
    confirmPreserve(project, SANCTUARY);
    confirmPreserve(project, ANNEX); // same mission id, new target
    const edges = missionAppliesToEdges(project);
    expect(edges).toHaveLength(1);
    expect(edges[0].dependencyId).toBe(ANNEX);
    expect(
      project.edges.some(
        (edge) => edge.role === "mission-applies-to" && edge.dependencyId === SANCTUARY,
      ),
    ).toBe(false);
  });

  it("changing the same id from preserve-structure to retain-ownership leaves no structure edge", () => {
    const project = seedWithStructures();
    confirmPreserve(project, SANCTUARY);
    confirmMissionConstraint(contextFor(project), {
      id: MISSION_ID,
      kind: "mission-constraint",
      intentText: "We are not selling the land.",
      normalized: { type: "retain-ownership" },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    expect(missionAppliesToEdges(project)).toHaveLength(0);
    expect(
      project.edges.some((edge) => edge.role === "mission-applies-to"),
    ).toBe(false);
  });

  it("certificate closure includes the MissionConstraint, the Structure, and the structure's reachable graph", () => {
    const project = seedWithStructures();
    confirmPreserve(project, SANCTUARY);
    recordScenario(contextFor(project), {
      scenarioId: "scenario:preserve-check",
      label: "Preservation check",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [
        { metricId: "homes", label: "Homes", value: { value: 12, unit: "dwelling_units" } },
      ],
      constraintIds: [PARKING_CONSTRAINT_ID],
      missionIds: [MISSION_ID],
      assumptionIds: [],
      parcelId: PARCEL_ID,
      results: [
        {
          resultId: "result:preserve-check:parking",
          constraintId: PARKING_CONSTRAINT_ID,
          status: "SATISFIED",
          actual: { value: 0, unit: "spaces" },
          limit: { value: 0, unit: "spaces" },
          explanation: "Test double.",
        },
      ],
      certificateId: "scenario:preserve-check:certificate",
    });
    const certificate = requireNode(project, "scenario:preserve-check:certificate", "scenario-certificate");
    const pinned = new Set(certificate.dependencies.map((dep) => dep.nodeId));
    expect(pinned.has(MISSION_ID)).toBe(true);
    expect(pinned.has(SANCTUARY)).toBe(true); // the actual sanctuary structure
    expect(pinned.has(PARCEL_ID)).toBe(true); // reachable via located-on
    // ...and the parcel's own grounding chain reaches sources.
    expect([...pinned].some((id) => id.startsWith("phl:src:"))).toBe(true);
    // The annex structure is NOT part of this closure.
    expect(pinned.has(ANNEX)).toBe(false);
    expect(requireNode(project, "scenario:preserve-check:certificate", "scenario-certificate").freshness).toBe("CURRENT");
  });

  it("a semantic change to the pinned structure stales the preserve-dependent certificate; an unrelated one stays CURRENT", () => {
    const project = seedWithStructures();
    confirmPreserve(project, SANCTUARY);
    recordScenario(contextFor(project), {
      scenarioId: "scenario:preserve-check",
      label: "Preservation check",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [
        { metricId: "homes", label: "Homes", value: { value: 12, unit: "dwelling_units" } },
      ],
      constraintIds: [PARKING_CONSTRAINT_ID],
      missionIds: [MISSION_ID],
      assumptionIds: [],
      parcelId: PARCEL_ID,
      results: [
        {
          resultId: "result:preserve-check:parking",
          constraintId: PARKING_CONSTRAINT_ID,
          status: "SATISFIED",
          actual: { value: 0, unit: "spaces" },
          limit: { value: 0, unit: "spaces" },
          explanation: "Test double.",
        },
      ],
      certificateId: "scenario:preserve-check:certificate",
    });
    // An unrelated scenario whose certificate does NOT depend on the mission rule.
    recordScenario(contextFor(project), {
      scenarioId: "scenario:parking-only",
      label: "Parking only",
      solverVersion: "test-double@0",
      status: "COMPUTED",
      metrics: [
        { metricId: "homes", label: "Homes", value: { value: 30, unit: "dwelling_units" } },
      ],
      constraintIds: [PARKING_CONSTRAINT_ID],
      missionIds: [],
      assumptionIds: [],
      parcelId: PARCEL_ID,
      results: [
        {
          resultId: "result:parking-only:parking",
          constraintId: PARKING_CONSTRAINT_ID,
          status: "SATISFIED",
          actual: { value: 0, unit: "spaces" },
          limit: { value: 0, unit: "spaces" },
          explanation: "Test double.",
        },
      ],
      certificateId: "scenario:parking-only:certificate",
    });

    // Semantic change to the sanctuary structure (new footprint evidence).
    const sanctuary = requireNode(project, SANCTUARY, "structure");
    sanctuary.attributeClaimIds = ["phl:claim:height-max"];
    touchNode(sanctuary, "2026-10-07T00:00:00.000Z");
    refreshStaleness(project);

    expect(gradeCertificate(project, "scenario:preserve-check:certificate").freshness).toBe("STALE");
    expect(requireNode(project, "scenario:preserve-check:certificate", "scenario-certificate").freshness).toBe("STALE");
    expect(gradeCertificate(project, "scenario:parking-only:certificate").freshness).toBe("CURRENT");
    expect(requireNode(project, "scenario:parking-only:certificate", "scenario-certificate").freshness).toBe("CURRENT");
  });
});
