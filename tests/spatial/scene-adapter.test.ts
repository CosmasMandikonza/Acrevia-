import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { bootstrapSpikeProject, loadMassingFixture } from "../../src/adapters/spatial/benchmark-bootstrap";
import { buildSpatialScene } from "../../src/adapters/spatial/scene-adapter";
import { createSha256 } from "../../src/domain/graph/hashing";
import { canonicalJson } from "../../src/domain/graph/serialization";

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

describe("spike scene adapter (issue #8)", () => {
  it("projects the canonical parcel within 0.1% of the recorded area", () => {
    const scene = buildScene();
    expect(scene.parcel.recordedAreaSqFt).toBe(119295);
    expect(scene.parcel.computedAreaSqFt).toBeGreaterThan(119295 * 0.999);
    expect(scene.parcel.computedAreaSqFt).toBeLessThan(119295 * 1.001);
    expect(scene.structures).toHaveLength(1);
    expect(scene.structures[0].heightFt).toBe(29);
    expect(scene.structures[0].protectedByMission).toBe(true);
  });

  it("derives the legal envelope from setbacks + occupied-area cap", () => {
    const scene = buildScene();
    const env = scene.legalEnvelope;
    expect(env).not.toBeNull();
    expect(env!.heightFt).toBe(38);
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

  it("derives the mission envelope by clipping sanctuary + parking + height", () => {
    const scene = buildScene();
    const mission = scene.missionEnvelope;
    expect(mission).not.toBeNull();
    expect(mission!.heightFt).toBe(28); // mission cap below legal 38
    expect(mission!.areaSqFt).toBeLessThan(scene.legalEnvelope!.areaSqFt);
    const labels = mission!.clips.map((c) => c.label).join(" | ");
    expect(labels).toMatch(/sanctuary/i);
    expect(labels).toMatch(/parking/i);
    expect(labels).toMatch(/height cap 28/i);
    expect(scene.parking?.stalls.count).toBe(24);
  });

  it("validates scenario volumes against the mission envelope", () => {
    const scene = buildScene();
    expect(scene.scenarios).toHaveLength(2);
    const homes = scene.scenarios.find((s) => s.scenarioId === "phl:scenario:homes-24")!;
    expect(homes.status).toBe("COMPUTED");
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
    // Sanity: the model is not trivially empty.
    expect(a.derivationNotes.length).toBeGreaterThan(4);
    expect(a.legalEnvelope!.polygons.length).toBeGreaterThan(0);
  });
});
