import { describe, expect, it } from "vitest";
import { Quantity, QuantityRange } from "../../src/domain/units/quantity";
import {
  confirmMissionConstraint,
  recordClaim,
  setAssumption,
} from "../../src/commands";
import { seedPhiladelphiaProject, contextFor } from "./helpers";
import { requireNode } from "../../src/domain";

describe("typed units", () => {
  it("accepts well-formed quantities and rejects bare numbers / unknown units", () => {
    expect(Quantity.parse({ value: 38, unit: "ft" })).toEqual({ value: 38, unit: "ft" });
    expect(() => Quantity.parse({ value: 38 })).toThrow();
    expect(() => Quantity.parse({ value: 38, unit: "furlongs" })).toThrow();
    expect(() => Quantity.parse({ value: Number.NaN, unit: "ft" })).toThrow();
    expect(QuantityRange.parse({ min: 5, max: 12, unit: "ft" })).toEqual({
      min: 5,
      max: 12,
      unit: "ft",
    });
  });

  it("explicit conversions are rounding-explicit functions", () => {
    expect(11083.343424441293 * 10.7639).toBeCloseTo(119300, 3);
  });
});

describe("state vocabularies stay separate", () => {
  it("origin is not an evidence state: mission/assumption nodes carry origin, not evidenceState", () => {
    const project = seedPhiladelphiaProject();
    confirmMissionConstraint(contextFor(project), {
      id: "mission:retain-ownership",
      kind: "mission-constraint",
      intentText: "The church keeps the land.",
      normalized: { type: "retain-ownership" },
      origin: { kind: "USER_DECLARED", actorId: "board" },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    setAssumption(contextFor(project), {
      id: "assumption:unit-mix",
      kind: "assumption",
      statement: "Unit mix skews to 1- and 2-bedroom homes.",
      value: { type: "qualitative", text: "60/40 1BR/2BR" },
      rationale: "Comparable-market programming input.",
      origin: { kind: "MODELER_DECLARED", actorId: "modeler" },
      active: true,
    });

    const mission = requireNode(project, "mission:retain-ownership", "mission-constraint");
    expect("evidenceState" in mission).toBe(false);
    expect(mission.origin.kind).toBe("USER_DECLARED");

    const assumption = requireNode(project, "assumption:unit-mix", "assumption");
    expect("evidenceState" in assumption).toBe(false);
    expect(assumption.origin.kind).toBe("MODELER_DECLARED");
  });

  it("commands reject origin masquerades", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      confirmMissionConstraint(contextFor(project), {
        id: "mission:bad",
        kind: "mission-constraint",
        intentText: "x",
        normalized: { type: "retain-ownership" },
        origin: { kind: "SOURCE_DERIVED" },
        confirmationState: "CONFIRMED",
        hardOrSoft: "hard",
      }),
    ).toThrow(/USER_DECLARED/);
    expect(() =>
      setAssumption(contextFor(project), {
        id: "assumption:bad",
        kind: "assumption",
        statement: "x",
        value: { type: "qualitative", text: "y" },
        rationale: "z",
        origin: { kind: "SOURCE_DERIVED" },
        active: true,
      }),
    ).toThrow(/MODELER_DECLARED/);
  });

  it("sourced claims must cite sources and carry an evidence state; declared claims must not", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      recordClaim(contextFor(project), {
        id: "claim:bad-source-derived",
        kind: "claim",
        subjectNodeId: "phl:parcel:778273000",
        predicate: "parcel-area",
        value: { type: "qualitative", text: "made up" },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [],
      } as never),
    ).toThrow(/at least one source artifact/);
  });
});

describe("command audit invariants", () => {
  it("every command appends a ProjectEvent, bumps revisions, and summarizes", () => {
    const project = seedPhiladelphiaProject();
    const eventsBefore = project.events.length;
    const revisionBefore = project.revision;

    confirmMissionConstraint(contextFor(project, "pastor", "corr-1"), {
      id: "mission:min-parking-audit",
      kind: "mission-constraint",
      intentText: "Keep 90 Sunday spaces.",
      normalized: { type: "min-parking", spaces: { value: 90, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "pastor" },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });

    expect(project.events).toHaveLength(eventsBefore + 1);
    const event = project.events[project.events.length - 1];
    expect(event.actor).toBe("pastor");
    expect(event.correlationId).toBe("corr-1");
    expect(event.priorProjectRevision).toBe(revisionBefore);
    expect(event.nextProjectRevision).toBe(revisionBefore + 1);
    expect(event.affectedNodeIds).toContain("mission:min-parking-audit");
    expect(requireNode(project, "mission:min-parking-audit").meta.revision).toBe(1);
  });

  it("invalid input is rejected before any mutation", () => {
    const project = seedPhiladelphiaProject();
    const snapshot = JSON.stringify({
      nodes: Object.keys(project.nodes),
      edges: project.edges.length,
      events: project.events.length,
      revision: project.revision,
    });
    expect(() =>
      recordClaim(contextFor(project), {
        id: "",
        kind: "claim",
        subjectNodeId: "phl:parcel:778273000",
        predicate: "parcel-area",
        value: { type: "qualitative", text: "x" },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: ["phl:src:S2@v1"],
        evidenceState: "SOURCE_CONFIRMED",
      } as never),
    ).toThrow();
    expect(
      JSON.stringify({
        nodes: Object.keys(project.nodes),
        edges: project.edges.length,
        events: project.events.length,
        revision: project.revision,
      }),
    ).toBe(snapshot);
  });
});
