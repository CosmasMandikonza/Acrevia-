import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { bootstrapSpikeProject, loadMassingFixture } from "../../src/adapters/spatial/benchmark-bootstrap";
import { buildSpatialScene } from "../../src/adapters/spatial/scene-adapter";
import { createSha256 } from "../../src/domain/graph/hashing";
import { canonicalJson } from "../../src/domain/graph/serialization";
import { nodesOfKind } from "../../src/domain";

const FIXTURE_DIR = join(process.cwd(), "docs", "benchmarks", "calvary-memorial-philadelphia");

function buildScene() {
  const boot = bootstrapSpikeProject(FIXTURE_DIR);
  const massing = loadMassingFixture();
  return buildSpatialScene({
    project: boot.project,
    massing,
    addressHint: boot.addressHint,
    title: "Calvary Memorial Church",
    subtitle: "7200-50 E Roosevelt Blvd · RM-1 · Philadelphia",
  });
}

describe("spike scene adapter (issue #8, truth labels per PR #30 review)", () => {
  it("projects the canonical parcel within 0.1% of the recorded area", () => {
    const scene = buildScene();
    expect(scene.parcel.recordedAreaSqFt).toBe(119295);
    expect(scene.parcel.computedAreaSqFt).toBeGreaterThan(119295 * 0.999);
    expect(scene.parcel.computedAreaSqFt).toBeLessThan(119295 * 1.001);
    expect(scene.structures).toHaveLength(1);
    expect(scene.structures[0].heightFt).toBe(29);
    expect(scene.structures[0].protectedByMission).toBe(true);
  });

  it("records the CANONICAL mission flow — preserve, 110 parking, retain ownership; no invented cap", () => {
    const boot = bootstrapSpikeProject(FIXTURE_DIR);
    const missions = nodesOfKind(boot.project, "mission-constraint").map((n) => {
      const m = n as unknown as { id: string; normalized: { type: string } };
      return `${m.id}:${m.normalized.type}`;
    });
    expect(missions).toEqual([
      "phl:mission:preserve-sanctuary:preserve-structure",
      "phl:mission:min-parking-110:min-parking",
      "phl:mission:retain-ownership:retain-ownership",
    ]);
  });

  it("scenario setback results are the honest trusted states (front EXPERT_REQUIRED, side/rear NOT_EVALUATED)", () => {
    const boot = bootstrapSpikeProject(FIXTURE_DIR);
    const homes = nodesOfKind(boot.project, "constraint-result").filter((n) => {
      const r = n as unknown as { scenarioId: string };
      return r.scenarioId === "phl:scenario:homes-24";
    }) as unknown as { constraintId: string; status: string }[];
    const byConstraint = new Map(homes.map((r) => [r.constraintId, r.status]));
    expect(byConstraint.get("phl:constraint:setback-front")).toBe("EXPERT_REQUIRED");
    expect(byConstraint.get("phl:constraint:setback-side")).toBe("NOT_EVALUATED");
    expect(byConstraint.get("phl:constraint:setback-rear")).toBe("NOT_EVALUATED");
    // Law-derived scalars keep their honest evaluations.
    expect(byConstraint.get("phl:constraint:height-max")).toBe("SATISFIED");
    expect(byConstraint.get("phl:constraint:occupied-area-max")).toBe("SATISFIED");
    // Scenario labels are unmistakably fixtures.
    const scenario = nodesOfKind(boot.project, "scenario").find(
      (n) => (n as unknown as { id: string }).id === "phl:scenario:homes-24",
    ) as unknown as { label: string };
    expect(scenario.label).toMatch(/^HYPOTHETICAL SPIKE FIXTURE/);
  });

  it("derives the planning envelope from setbacks + occupied-area cap, marked ASSUMPTION_DERIVED", () => {
    const scene = buildScene();
    const env = scene.legalEnvelope;
    expect(env).not.toBeNull();
    expect(env!.heightFt).toBe(38);
    expect(env!.verification).toBe("ASSUMPTION_DERIVED");
    expect(env!.verificationNote).toMatch(/visualization heuristic/i);
    expect(env!.verificationNote).toMatch(/not yet classified in trusted state/i);
    // 75% of the computed parcel area (intermediate-lot conservative cap).
    const cap = scene.parcel.computedAreaSqFt * 0.75;
    expect(Math.abs(env!.areaSqFt - cap)).toBeLessThan(5);
    expect(env!.bindingNotes.join(" ")).toMatch(/Occupied-area cap 75%/);
    const front = env!.setbacks.find((s) => s.face === "front");
    expect(front?.specType).toBe("contextual");
    expect(front?.appliedFt).toBeNull();
    expect(env!.setbacks.find((s) => s.face === "side")?.appliedFt).toBe(5);
    expect(env!.setbacks.find((s) => s.face === "rear")?.appliedFt).toBe(9);
  });

  it("canonical mission: sanctuary clip only, NO invented height cap, 110-stall parking honestly UNRESOLVED", () => {
    const scene = buildScene();
    const mission = scene.missionEnvelope;
    expect(mission).not.toBeNull();
    expect(mission!.heightFt).toBe(38); // canonical flow has no mission cap
    expect(mission!.verification).toBe("ASSUMPTION_DERIVED");
    expect(mission!.areaSqFt).toBeLessThan(scene.legalEnvelope!.areaSqFt);
    const labels = mission!.clips.map((c) => c.label).join(" | ");
    expect(labels).toMatch(/sanctuary/i);
    expect(labels).not.toMatch(/height cap/i);
    // The 110-stall requirement is real but this spike cannot design it:
    // no single rectangular field fits, so nothing is faked.
    expect(scene.parking).toBeNull();
    expect(scene.derivationNotes.join(" ")).toMatch(/Parking field UNRESOLVED/);
  });

  it("validates fixture scenario volumes against the mission envelope", () => {
    const scene = buildScene();
    expect(scene.scenarios).toHaveLength(2);
    const homes = scene.scenarios.find((s) => s.scenarioId === "phl:scenario:homes-24")!;
    expect(homes.status).toBe("COMPUTED");
    expect(homes.label).toMatch(/^HYPOTHETICAL SPIKE FIXTURE/);
    for (const v of homes.volumes) {
      expect(v.status).toBe("VALID");
    }
    const tower = scene.scenarios.find((s) => s.scenarioId === "phl:scenario:optimistic-tower")!;
    expect(tower.status).toBe("REFUSED");
    for (const v of tower.volumes) {
      expect(v.status).toBe("CONFLICT");
      expect(v.statusDetail).toMatch(/NOT BUILDABLE/);
    }
  });

  it("provides four deterministic saved cameras", () => {
    const scene = buildScene();
    const ids = scene.cameras.map((c) => c.id);
    expect(ids).toEqual(["camera:aerial", "camera:entry", "camera:pedestrian", "camera:neighbor"]);
    for (const cam of scene.cameras) {
      expect(Number.isFinite(cam.position.x)).toBe(true);
      expect(cam.position.y).toBeGreaterThan(0);
      expect(cam.fovDeg).toBeGreaterThan(20);
    }
  });

  it("is byte-deterministic across rebuilds (and immune to clock changes)", () => {
    const a = buildScene();
    const b = buildScene();
    const jsonA = canonicalJson(a as never);
    const jsonB = canonicalJson(b as never);
    expect(createSha256(jsonA)).toBe(createSha256(jsonB));
    expect(a.derivationNotes.length).toBeGreaterThan(4);
    expect(a.legalEnvelope!.polygons.length).toBeGreaterThan(0);
  });
});
