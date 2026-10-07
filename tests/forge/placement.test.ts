import { describe, expect, it } from "vitest";
import {
  placeScenarioMassing,
  planParking,
  validatePlacement,
  type MassingPlacementInput,
  type ParkingPlanInput,
} from "../../src/adapters/spatial/forge-placement";
import type { ScenePolygon } from "../../src/spatial/scene-model";
import { intersection, totalAreaSqFt } from "../../src/adapters/spatial/geometry2d";

/**
 * Deterministic placement engine (issue #9) — mechanical validation and
 * adversarial geometry. The invariant under test everywhere: a polygon is
 * emitted ONLY when it is provably inside the allowed region, clear of the
 * sanctuary, exactly the right aggregate area, finite, and under the height
 * cap. Anything else is UNRESOLVED — never a plausible shape.
 */

function rect(minX: number, minY: number, maxX: number, maxY: number): ScenePolygon {
  return {
    exterior: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

const FRONT = { point: { x: 0, y: 0 }, outward: { x: 0, y: -1 } }; // street to the south

function massingInput(overrides: Partial<MassingPlacementInput> = {}): MassingPlacementInput {
  return {
    envelope: [rect(0, 0, 300, 200)], // 60,000 sq ft region
    sanctuary: [],
    requiredAreaSqFt: 24_000,
    heightFt: 33,
    heightCapFt: 38,
    front: FRONT,
    ...overrides,
  };
}

function parkingInput(overrides: Partial<ParkingPlanInput> = {}): ParkingPlanInput {
  return {
    envelope: [rect(0, 0, 300, 200)],
    sanctuary: [],
    building: [],
    requiredStalls: 60,
    front: { outward: FRONT.outward },
    ...overrides,
  };
}

describe("massing placement", () => {
  it("places exactly the required area inside the region (aggregate ±1 sq ft)", () => {
    const result = placeScenarioMassing(massingInput());
    expect(result.status).toBe("PLACED");
    const total = result.pieces.reduce((sum, p) => sum + p.areaSqFt, 0);
    expect(Math.abs(total - 24_000)).toBeLessThanOrEqual(1);
  });

  it("is byte-deterministic: identical input → identical output", () => {
    const a = placeScenarioMassing(massingInput());
    const b = placeScenarioMassing(massingInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("every emitted piece is fully inside the envelope and finite", () => {
    const result = placeScenarioMassing(massingInput({ requiredAreaSqFt: 57_000 }));
    expect(result.status).toBe("PLACED");
    const violations = validatePlacement(
      result.pieces,
      { envelope: massingInput().envelope, sanctuary: [] },
      57_000,
      33,
      38,
    );
    expect(violations).toEqual([]);
  });

  it("refuses when the required footprint exceeds the region (tiny parcel)", () => {
    const result = placeScenarioMassing(
      massingInput({ envelope: [rect(0, 0, 40, 40)], requiredAreaSqFt: 2_000 }),
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.pieces).toEqual([]);
    expect(result.reasons[0]).toMatch(/exceeds the allowed planning region/i);
  });

  it("refuses when the height exceeds the cap", () => {
    const result = placeScenarioMassing(massingInput({ heightFt: 45, heightCapFt: 38 }));
    expect(result.status).toBe("UNRESOLVED");
    expect(result.reasons.join(" ")).toMatch(/height/i);
  });

  it("splits bars around a notched (L-shaped) envelope with exact aggregate area", () => {
    // Envelope = big rectangle minus a notch in the second bar's path.
    const lShape: ScenePolygon = {
      exterior: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 72 },
        { x: 180, y: 72 },
        { x: 180, y: 200 },
        { x: 0, y: 200 },
      ],
    };
    const result = placeScenarioMassing(massingInput({ envelope: [lShape], requiredAreaSqFt: 40_000 }));
    expect(result.status).toBe("PLACED");
    const total = result.pieces.reduce((sum, p) => sum + p.areaSqFt, 0);
    expect(Math.abs(total - 40_000)).toBeLessThanOrEqual(1);
    const violations = validatePlacement(
      result.pieces,
      { envelope: [lShape], sanctuary: [] },
      40_000,
      33,
      38,
    );
    expect(violations).toEqual([]);
  });

  it("never overlaps the sanctuary (sanctuary-dominant parcel refuses honestly)", () => {
    // The sanctuary covers most of the region; only a 60×200 strip remains.
    const sanctuary = rect(60, 0, 300, 200);
    const region = [rect(0, 0, 300, 200)];
    const smallRoom = placeScenarioMassing(
      massingInput({ envelope: region, sanctuary: [sanctuary], requiredAreaSqFt: 10_000 }),
    );
    // The engine's region already excludes nothing here — it must either
    // place clear of the sanctuary or refuse; overlapping is a failure.
    if (smallRoom.status === "PLACED") {
      const violations = validatePlacement(
        smallRoom.pieces,
        { envelope: region, sanctuary: [sanctuary] },
        10_000,
        33,
        38,
      );
      expect(violations).toEqual([]);
    } else {
      expect(smallRoom.reasons.length).toBeGreaterThan(0);
    }
  });

  it("rejects a degenerate piece with non-finite coordinates via validation", () => {
    const bad = [
      {
        polygon: {
          exterior: [
            { x: Number.NaN, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
        areaSqFt: 100,
        label: "bad",
      },
    ];
    const violations = validatePlacement(bad, { envelope: [rect(0, 0, 100, 100)], sanctuary: [] }, 100, 10, 38);
    expect(violations.join(" ")).toMatch(/non-finite/i);
  });

  it("zero-area program places trivially with no geometry", () => {
    const result = placeScenarioMassing(massingInput({ requiredAreaSqFt: 0 }));
    expect(result.status).toBe("PLACED");
    expect(result.pieces).toEqual([]);
  });
});

describe("parking planner", () => {
  it("places the exact stall count with validated fields", () => {
    const result = planParking(parkingInput({ requiredStalls: 60 }));
    expect(result.status).toBe("PLACED");
    expect(result.placedStalls).toBe(60);
    expect(result.fields.reduce((s, f) => s + f.stalls, 0)).toBe(60);
    for (const field of result.fields) {
      const expected = field.perRow * 9 * (field.rows === 1 ? 42 : field.rows === 2 ? 60 : field.rows === 3 ? 102 : 144);
      expect(Math.abs(field.areaSqFt - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("is byte-deterministic", () => {
    const a = planParking(parkingInput());
    const b = planParking(parkingInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never places a field on the building footprint", () => {
    const building = rect(0, 0, 300, 60);
    const result = planParking(parkingInput({ building: [building], requiredStalls: 40 }));
    if (result.status === "PLACED") {
      for (const field of result.fields) {
        const overlap = totalAreaSqFt(intersection(field.polygon, building));
        expect(overlap).toBeLessThanOrEqual(1);
      }
    } else {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("refuses all-or-nothing when the count cannot be proven (extreme mission)", () => {
    const result = planParking(parkingInput({ requiredStalls: 5_000 }));
    expect(result.status).toBe("UNRESOLVED");
    expect(result.fields).toEqual([]);
    expect(result.placedStalls).toBe(0);
  });

  it("refuses when the building leaves no usable ground (sanctuary-dominant site)", () => {
    const result = planParking(
      parkingInput({
        envelope: [rect(0, 0, 200, 80)],
        building: [rect(0, 0, 200, 76)],
        requiredStalls: 30,
      }),
    );
    expect(result.status).toBe("UNRESOLVED");
    expect(result.fields).toEqual([]);
  });

  it("zero stalls place trivially", () => {
    const result = planParking(parkingInput({ requiredStalls: 0 }));
    expect(result.status).toBe("PLACED");
    expect(result.fields).toEqual([]);
  });
});
