import { describe, expect, it } from "vitest";
import { buildForgeScene } from "../../src/adapters/spatial/forge-scene";
import { canonicalForgeProject, canonicalSolveAndRecord, ADDRESS_HINT } from "./helpers";
import { canonicalJson } from "../../src/domain/graph/serialization";
import { gradeCertificate } from "../../src/domain";
import { contextFor } from "../domain/helpers";
import { confirmMissionConstraint } from "../../src/commands";
import { solve } from "../../src/application/solver/solve";
import { recordSolverScenarios } from "../../src/application/solver/record";
import { buildForgeSceneResult } from "../../src/application/forge/build-forge-scene";
import { intersection, totalAreaSqFt } from "../../src/adapters/spatial/geometry2d";

/**
 * Production Forge scene (issue #9) over the canonical Calvary truth.
 * Invariants under test: real #7 scenarios (never spike fixtures),
 * byte-determinism, mechanically validated placement, honest parking
 * (never invented stalls), honest 123/124 treatment, mission-change →
 * stale certificate + new scenario identity, real proof-node ids, and
 * deterministic cameras.
 */

const TITLE = "7200-50 E Roosevelt Blvd";
const SUBTITLE = "RM-1 · canonical test";

function sceneFrom(parking = 110, targetHomes?: number): ReturnType<typeof buildForgeScene> {
  const { project, result, recorded } = canonicalSolveAndRecord(parking, targetHomes);
  return buildForgeScene({
    project,
    solveResult: result,
    recorded,
    addressHint: ADDRESS_HINT,
    title: TITLE,
    subtitle: SUBTITLE,
  });
}

describe("forge scene over the canonical benchmark", () => {
  it("renders the three real #7 scenarios with CURRENT certificates — never spike fixtures", () => {
    const scene = sceneFrom();
    expect(scene.scenarios.length).toBeGreaterThanOrEqual(3);
    const labels = scene.scenarios.map((s) => s.label);
    expect(labels).toContain("HOUSING MAX");
    expect(labels).toContain("MISSION BALANCE");
    expect(labels).toContain("LOW CHANGE");
    for (const s of scene.scenarios) {
      expect(s.scenarioId).toMatch(/^scenario:solver:/);
      expect(s.certificateId).toMatch(/:certificate$/);
      expect(s.freshness).toBe("CURRENT");
      expect(s.status).toBe("COMPUTED");
    }
    // The spike fixture vocabulary must not appear anywhere in the model.
    const serialized = canonicalJson(scene as never);
    expect(serialized).not.toContain("forge-spike");
    expect(serialized).not.toContain("HYPOTHETICAL SPIKE FIXTURE");
    expect(serialized).not.toContain("phl:scenario:");
    expect(serialized).not.toContain("optimistic-tower");
  });

  it("scenario massing derives from the live #7 points (area = exact footprint budget)", () => {
    const scene = sceneFrom();
    const { result } = canonicalSolveAndRecord();
    if (result.status !== "SOLVED") throw new Error("expected canonical solve to succeed");
    for (let i = 0; i < scene.scenarios.length; i += 1) {
      const modelScenario = scene.scenarios[i];
      const solverScenario = result.scenarios[i];
      const total = modelScenario.volumes.reduce((sum, v) => sum + totalAreaSqFt([v.polygon]), 0);
      expect(Math.abs(total - solverScenario.point.footprintSqFt)).toBeLessThanOrEqual(1);
      expect(modelScenario.point?.homes).toBe(solverScenario.point.homes);
      expect(modelScenario.point?.floors).toBe(solverScenario.point.floors);
      expect(modelScenario.point?.parkingStalls).toBe(solverScenario.point.parkingStalls);
      for (const volume of modelScenario.volumes) {
        expect(volume.heightFt).toBe(solverScenario.point.floors * 11);
        expect(volume.heightFt).toBeLessThanOrEqual(result.geometry.heightCeilingFt);
        // Inside the mission envelope.
        const inside = scene.missionEnvelope!.polygons.reduce(
          (sum, p) => sum + totalAreaSqFt(intersection(volume.polygon, p)),
          0,
        );
        expect(inside).toBeGreaterThanOrEqual(totalAreaSqFt([volume.polygon]) - 1);
        // Never intersects the sanctuary.
        for (const structure of scene.structures.filter((st) => st.protectedByMission)) {
          expect(totalAreaSqFt(intersection(volume.polygon, structure.polygon))).toBeLessThanOrEqual(1);
        }
        // Finite geometry only.
        for (const p of volume.polygon.exterior) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
    }
  });

  it("is byte-deterministic: same state → identical canonical JSON", () => {
    const a = sceneFrom();
    const b = sceneFrom();
    expect(canonicalJson(a as never)).toBe(canonicalJson(b as never));
  });

  it("never fabricates parking: PLACED only with the exact count, UNRESOLVED otherwise", () => {
    const scene = sceneFrom();
    for (const s of scene.scenarios) {
      expect(s.parking).toBeDefined();
      if (s.parking!.status === "PLACED") {
        expect(s.parking!.placedStalls).toBe(s.point!.parkingStalls);
        expect(s.parking!.fields.length).toBeGreaterThan(0);
        expect(
          s.parking!.fields.reduce((sum, f) => sum + f.stalls.count, 0),
        ).toBe(s.point!.parkingStalls);
        expect(s.parking!.verification).toBe("ASSUMPTION_DERIVED");
      } else {
        expect(s.parking!.fields).toEqual([]);
        expect(s.parking!.placedStalls).toBe(0);
        expect(s.parking!.reasons.length).toBeGreaterThan(0);
        expect(s.parking!.obligation.areaSqFt).toBeGreaterThan(0);
      }
    }
  });

  it("placement status is honest: PARTIAL/UNRESOLVED never claims PLACED", () => {
    const scene = sceneFrom();
    for (const s of scene.scenarios) {
      const buildingPlaced = s.volumes.length > 0 && s.volumes.every((v) => v.status === "VALID");
      const parkingPlaced = s.parking?.status === "PLACED";
      if (s.placement!.status === "PLACED") {
        expect(buildingPlaced).toBe(true);
        expect(parkingPlaced).toBe(true);
      } else if (s.placement!.status === "PARTIAL") {
        expect(buildingPlaced).toBe(true);
        expect(parkingPlaced).toBe(false);
        expect(s.placement!.summary).toMatch(/PLACEMENT NOT FULLY PROVEN/i);
      } else {
        expect(buildingPlaced).toBe(false);
      }
    }
  });

  it("the 123-home modeled upper bound is never labeled placement-proven unless geometry proves it", () => {
    const scene = sceneFrom();
    expect(scene.modeled!.upperBoundHomes).toBe(123);
    const housingMax = scene.scenarios.find((s) => s.label === "HOUSING MAX");
    expect(housingMax).toBeDefined();
    // Whatever the placement outcome, the summary must carry the honest
    // distinction between the area-budget bound and a proven site plan.
    expect(housingMax!.placement!.summary).toMatch(/ASSUMPTION_DERIVED|PLACEMENT NOT FULLY PROVEN|PLACEMENT NOT PROVEN/);
    if (housingMax!.placement!.status !== "PLACED") {
      expect(housingMax!.placement!.summary).not.toMatch(/all mechanically validated/);
    }
  });

  it("124 homes renders the NO VERIFIED SOLUTION ghost, never buildable massing", () => {
    const scene = sceneFrom(110, 124);
    expect(scene.refusal).toBeDefined();
    expect(scene.refusal!.requestedTarget).toBe(124);
    expect(scene.refusal!.upperBoundHomes).toBe(123);
    expect(scene.refusal!.binding.length).toBeGreaterThan(0);
    expect(scene.refusal!.nearestHomes.length).toBeGreaterThan(0);
    const ghost = scene.scenarios.find((s) => s.status === "REFUSED");
    expect(ghost).toBeDefined();
    expect(ghost!.confidence).toBe("NO_VERIFIED_SOLUTION");
    for (const v of ghost!.volumes) {
      expect(v.status).toBe("CONFLICT");
      expect(v.statusDetail).toMatch(/NOT BUILDABLE/);
    }
    expect(ghost!.certificateId).toBeNull();
  });

  it("mission parking change: new scenario ids, old certificate goes STALE in-graph", () => {
    // One continuous project: record at 110, then upsert the same mission
    // slot to 90 and re-solve + re-record (exactly what /api/forge/scene
    // does per request).
    const project = canonicalForgeProject(110);
    const ctx = contextFor(project);
    const first = solve(project);
    if (first.status !== "SOLVED") throw new Error("expected first solve to succeed");
    const firstRecorded = recordSolverScenarios(ctx, first);
    expect(firstRecorded[0].freshness).toBe("CURRENT");

    confirmMissionConstraint(ctx, {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint",
      intentText: "Keep at least 90 Sunday parking spaces.",
      normalized: { type: "min-parking", spaces: { value: 90, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: "2026-10-09T13:00:00.000Z" },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    const second = solve(project);
    if (second.status !== "SOLVED") throw new Error("expected second solve to succeed");
    const secondRecorded = recordSolverScenarios(ctx, second);

    const firstScene = buildForgeScene({
      project,
      solveResult: second,
      recorded: secondRecorded,
      addressHint: ADDRESS_HINT,
      title: TITLE,
      subtitle: SUBTITLE,
    });
    expect(firstScene.scenarios.length).toBeGreaterThan(0);

    // New semantic state ⇒ new scenario identity…
    expect(secondRecorded[0].scenarioId).not.toBe(firstRecorded[0].scenarioId);
    expect(secondRecorded[0].freshness).toBe("CURRENT");
    // …while the OLD certificate in the same graph grades STALE.
    const oldGrade = gradeCertificate(project, firstRecorded[0].certificateId);
    expect(oldGrade.freshness).toBe("STALE");
  });

  it("cameras are deterministic and derived from geometry (structure #13 can consume them)", () => {
    const a = sceneFrom().cameras;
    const b = sceneFrom().cameras;
    expect(canonicalJson(a as never)).toBe(canonicalJson(b as never));
    expect(a.map((c) => c.id)).toEqual([
      "camera:aerial",
      "camera:entry",
      "camera:pedestrian",
      "camera:neighbor",
    ]);
    for (const cam of a) {
      for (const v of [cam.position, cam.target]) {
        expect(Number.isFinite(v.x)).toBe(true);
        expect(Number.isFinite(v.y)).toBe(true);
        expect(Number.isFinite(v.z)).toBe(true);
      }
      expect(cam.transitionMs).toBeGreaterThan(0);
    }
  });

  it("every provenance node id referenced by the scene exists in the project", () => {
    const { project, result, recorded } = canonicalSolveAndRecord();
    const scene = buildForgeScene({
      project,
      solveResult: result,
      recorded,
      addressHint: ADDRESS_HINT,
      title: TITLE,
      subtitle: SUBTITLE,
    });
    const ids = new Set(Object.keys(project.nodes));
    const checkRefs = (refs: { nodeId: string }[]) => {
      for (const ref of refs) {
        if (ref.nodeId.includes(" ")) continue; // display-only claim labels
        expect(ids.has(ref.nodeId)).toBe(true);
      }
    };
    checkRefs(scene.parcel.provenance);
    for (const s of scene.structures) checkRefs(s.provenance);
    if (scene.legalEnvelope) checkRefs(scene.legalEnvelope.provenance);
    if (scene.missionEnvelope) checkRefs(scene.missionEnvelope.provenance);
    for (const s of scene.scenarios) {
      for (const v of s.volumes) checkRefs(v.provenance);
      if (s.parking) checkRefs(s.parking.provenance);
    }
  });

  it("the envelope stays truth-labeled: assumption-derived, never verified", () => {
    const scene = sceneFrom();
    expect(scene.legalEnvelope!.verification).toBe("ASSUMPTION_DERIVED");
    expect(scene.legalEnvelope!.verificationNote).toMatch(/LAW-INFORMED PLANNING ENVELOPE/i);
    expect(scene.missionEnvelope!.verification).toBe("ASSUMPTION_DERIVED");
  });
});

describe("forge scene trust boundary", () => {
  it("rejects a forged accepted pair before any derivation (no server truth from client input)", async () => {
    await expect(
      buildForgeSceneResult({
        envelope: { session: { sessionId: "forged" }, signature: "deadbeef" } as never,
        receipt: { payload: { projectId: "x" }, signature: "deadbeef" } as never,
        commands: [],
      }),
    ).rejects.toThrow(/verification|envelope|signature|session/i);
  });
});
