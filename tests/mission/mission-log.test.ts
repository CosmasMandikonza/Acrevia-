import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMissionLog,
  readMissionLogFor,
  writeMissionLogFor,
} from "../../src/lib/accepted-property";

/**
 * Mission-log property binding (issue #6 review): the persisted command log
 * is bound to the accepted base project ({ projectId, envelopeSignature }).
 * A log from Property A — or from an earlier acceptance of the same address —
 * must never replay onto a different accepted pair.
 */

const PAIR_A = {
  envelope: { signature: "a".repeat(64) },
  receipt: { payload: { projectId: "gis:778273000" } },
};
const PAIR_B = {
  envelope: { signature: "b".repeat(64) },
  receipt: { payload: { projectId: "gis:884304900" } },
};
const SAME_PROPERTY_NEW_ACCEPTANCE = {
  envelope: { signature: "c".repeat(64) },
  receipt: { payload: { projectId: "gis:778273000" } },
};

describe("mission command log binding", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("returns commands for the bound pair and discards them for another property", () => {
    writeMissionLogFor(PAIR_A, [{ kind: "retract", input: { id: "mission:x", declaredAt: "2026-10-06T00:00:00.000Z" } }]);
    expect(readMissionLogFor(PAIR_A)).toEqual([
      { kind: "retract", input: { id: "mission:x", declaredAt: "2026-10-06T00:00:00.000Z" } },
    ]);
    // Property B reads → discarded, and the stale log is cleared.
    expect(readMissionLogFor(PAIR_B)).toEqual([]);
    expect(window.sessionStorage.getItem("acrevia.mission-log")).toBeNull();
  });

  it("discards a log from an earlier acceptance of the same property (new envelope signature)", () => {
    writeMissionLogFor(PAIR_A, [{ kind: "retract", input: { id: "mission:x", declaredAt: "2026-10-06T00:00:00.000Z" } }]);
    expect(readMissionLogFor(SAME_PROPERTY_NEW_ACCEPTANCE)).toEqual([]);
  });

  it("clears corrupted log payloads defensively", () => {
    window.sessionStorage.setItem("acrevia.mission-log", "{not json");
    expect(readMissionLogFor(PAIR_A)).toEqual([]);
    expect(window.sessionStorage.getItem("acrevia.mission-log")).toBeNull();
  });

  it("missing fields count as corrupted", () => {
    window.sessionStorage.setItem("acrevia.mission-log", JSON.stringify({ commands: [] }));
    expect(readMissionLogFor(PAIR_A)).toEqual([]);
  });

  it("clearMissionLog removes the key outright", () => {
    writeMissionLogFor(PAIR_A, []);
    clearMissionLog();
    expect(window.sessionStorage.getItem("acrevia.mission-log")).toBeNull();
  });
});
