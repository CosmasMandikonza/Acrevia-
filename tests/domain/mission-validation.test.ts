import { describe, expect, it } from "vitest";
import { confirmMissionConstraint, retractMissionConstraint } from "../../src/commands";
import { contextFor, seedPhiladelphiaProject } from "./helpers";
import type { MissionNormalized } from "../../src/domain/constraints/mission";

/**
 * Mission value validation (issue #6): typed units alone are not enough.
 * Negative parking, negative or non-finite heights, zero/fractional story
 * limits must never become active mission constraints — while large positive
 * values remain valid (feasibility is the #7 solver's claim to make, not
 * ours).
 */

function confirmInput(normalized: MissionNormalized) {
  return {
    id: "mission:test-rule",
    kind: "mission-constraint" as const,
    intentText: "test rule",
    normalized,
    origin: { kind: "USER_DECLARED" as const, actorId: "board-chair", declaredAt: "2026-10-05T00:00:00.000Z" },
    confirmationState: "CONFIRMED" as const,
    hardOrSoft: "hard" as const,
  };
}

const INVALID_VALUES: MissionNormalized[] = [
  { type: "min-parking", spaces: { value: -5, unit: "spaces" } },
  { type: "min-parking", spaces: { value: 0, unit: "spaces" } },
  { type: "min-parking", spaces: { value: 12.5, unit: "spaces" } },
  { type: "max-stories", stories: { value: 0, unit: "stories" } },
  { type: "max-stories", stories: { value: -3, unit: "stories" } },
  { type: "max-height", limit: { value: -10, unit: "ft" } },
  { type: "max-height", limit: { value: 0, unit: "ft" } },
  { type: "max-height", limit: { value: Number.NaN, unit: "ft" } },
  { type: "max-height", limit: { value: Number.POSITIVE_INFINITY, unit: "ft" } },
];

describe("mission constraint value validation", () => {
  for (const normalized of INVALID_VALUES) {
    it(`rejects ${normalized.type} ${JSON.stringify(normalized)} at the command boundary`, () => {
      const project = seedPhiladelphiaProject();
      expect(() =>
        confirmMissionConstraint(contextFor(project), confirmInput(normalized)),
      ).toThrow();
      expect(project.nodes["mission:test-rule"]).toBeUndefined();
    });
  }

  it("accepts large-but-positive values — impossibility is not ours to claim", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      confirmMissionConstraint(
        contextFor(project),
        confirmInput({ type: "min-parking", spaces: { value: 10000, unit: "spaces" } }),
      ),
    ).not.toThrow();
    expect(project.nodes["mission:test-rule"]).toBeDefined();
  });

  it("rejects non-USER_DECLARED origin regardless of value", () => {
    const project = seedPhiladelphiaProject();
    expect(() =>
      confirmMissionConstraint(contextFor(project), {
        ...confirmInput({ type: "retain-ownership" }),
        origin: { kind: "SOURCE_DERIVED" },
      }),
    ).toThrow(/USER_DECLARED/);
  });

  it("DRAFT REGRESSION: a forged DRAFT confirm never creates a node or advances revision", () => {
    const project = seedPhiladelphiaProject();
    const revisionBefore = project.revision;
    // Deliberately forged payload — the command input type itself forbids
    // DRAFT, so this is typed as unknown to exercise the runtime boundary.
    const forged = {
      ...confirmInput({ type: "retain-ownership" }),
      confirmationState: "DRAFT",
    } as unknown as Parameters<typeof confirmMissionConstraint>[1];
    expect(() => confirmMissionConstraint(contextFor(project), forged)).toThrow();
    expect(project.nodes["mission:test-rule"]).toBeUndefined();
    expect(project.revision).toBe(revisionBefore);
    expect(
      project.events.some((event) => event.eventType === "mission.constraint.confirmed"),
    ).toBe(false);
  });

  it("REFERENTIAL INTEGRITY: preserve-structure for a nonexistent structure rejects atomically", () => {
    const project = seedPhiladelphiaProject();
    const revisionBefore = project.revision;
    expect(() =>
      confirmMissionConstraint(
        contextFor(project),
        confirmInput({ type: "preserve-structure", structureId: "gis:structure:missing" }),
      ),
    ).toThrow();
    expect(project.nodes["mission:test-rule"]).toBeUndefined();
    expect(project.revision).toBe(revisionBefore);
  });

  it("retract removes a confirmed constraint through the typed boundary", () => {
    const project = seedPhiladelphiaProject();
    confirmMissionConstraint(
      contextFor(project),
      confirmInput({ type: "retain-ownership" }),
    );
    const revisionAfterConfirm = project.revision;
    retractMissionConstraint(contextFor(project), { id: "mission:test-rule" });
    expect(project.nodes["mission:test-rule"]).toBeUndefined();
    expect(project.revision).toBeGreaterThan(revisionAfterConfirm);
    expect(
      project.events.some((event) => event.eventType === "mission.constraint.retracted"),
    ).toBe(true);
  });

  it("retracting an unknown mission id fails without side effects", () => {
    const project = seedPhiladelphiaProject();
    const revision = project.revision;
    expect(() =>
      retractMissionConstraint(contextFor(project), { id: "mission:does-not-exist" }),
    ).toThrow();
    expect(project.revision).toBe(revision);
  });
});
