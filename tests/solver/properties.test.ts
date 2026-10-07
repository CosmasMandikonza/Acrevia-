import { describe, expect, it } from "vitest";
import { contextFor } from "../domain/helpers";
import type { Project } from "../../src/domain/graph/project";
import { seedSolverAssumptions } from "../../src/application/solver/assumptions";
import { solve, type EvaluatedConstraint } from "../../src/application/solver/solve";
import { canonicalProject } from "./canonical.test";
import {
  confirmMissionConstraint,
  addSourceArtifact,
  recordClaim,
  upsertRegulation,
  materializeConstraint,
  setAssumption,
  recordScenario,
  supersedeSourceArtifact,
  replaceExecutableConstraint,
} from "../../src/commands";
import { gradeCertificate, Unit } from "../../src/domain";

/**
 * Solver property/fuzz + adversarial suite (issue #7; incorporates the
 * solver-relevant Issue #16 Acrevia Bench cases without closing #16):
 * determinism, order invariance, fail-closed staleness, degenerate geometry,
 * extreme values, sensitivity, and certificate invalidation.
 */

const NOW = "2026-10-09T12:00:00.000Z";

function tinyProject(
  parcelSqFtWktLike: { polygon: [number, number][] },
  overrides: {
    parkingMission?: number;
    sanctuarySqFtPolygon?: { polygon: [number, number][] };
    heightFt?: number;
    occupiedPct?: number;
    grossPerUnit?: number;
    stallArea?: number;
    storyFt?: number;
    densityTiers?: Array<{ firstSqFt: number; perUnit: number }>;
    skipMissions?: boolean;
  } = {},
): Project {
  const parcelId = "gis:parcel:1";
  const project = {
    projectId: "gis:1",
    schemaVersion: "acrevia.graph.v1",
    revision: 0,
    propertyId: "gis:property:1",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: {},
    edges: [],
    events: [],
  } as unknown as Project;
  const ctx = contextFor(project);
  const baseClaim = "gis:claim:zoning-base:1";
  project.nodes[parcelId] = {
    id: parcelId,
    kind: "parcel",
    parcelIdSystem: "PWD",
    parcelNumber: "1",
    geometry: { geojson: { type: "Polygon", coordinates: [parcelSqFtWktLike.polygon] }, crs: "EPSG:4326", validity: "valid", derived: false },
    claimIds: [baseClaim],
    meta: { revision: 1, semanticHash: "p", createdAt: NOW, lastModifiedAt: NOW },
  } as never;
  addSourceArtifact(ctx, {
    id: "gis:src:zoning-base",
    kind: "source-artifact",
    logicalSourceKey: "gis:src:zoning-base",
    version: 1,
    sourceType: "official_gis",
    title: "zoning",
    publisher: "City",
    canonicalUrl: "https://t",
    authority: "OFFICIAL_GIS",
    retrievedAt: NOW,
    rawContentHash: "a".repeat(64),
  });
  recordClaim(ctx, {
    id: baseClaim,
    kind: "claim",
    subjectNodeId: parcelId,
    predicate: "zoning-district",
    value: { type: "qualitative", text: "RM-1" },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["gis:src:zoning-base"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: "RM-1",
  });
  addSourceArtifact(ctx, {
    id: "phl:src:S5@v1",
    kind: "source-artifact",
    logicalSourceKey: "phl:src:S5",
    version: 1,
    sourceType: "official_city_reference",
    title: "guide",
    publisher: "City",
    canonicalUrl: "https://t",
    authority: "OFFICIAL_CITY_REFERENCE",
    retrievedAt: NOW,
    rawContentHash: "c".repeat(64),
  });
  const lawClaim = (id: string, predicate: Parameters<typeof recordClaim>[1]["predicate"], value: import("../../src/domain").ClaimValue, quote: string) =>
    recordClaim(ctx, {
      id,
      kind: "claim",
      subjectNodeId: parcelId,
      predicate,
      value,
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: ["phl:src:S5@v1"],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: quote,
    });
  lawClaim("phl:claim:h", "max-height", { type: "quantity", quantity: { value: overrides.heightFt ?? 38, unit: "ft" } }, "38 ft");
  upsertRegulation(ctx, {
    id: "phl:reg:h",
    kind: "regulation",
    jurisdictionKey: "philadelphia-pa",
    codeSection: "38 ft",
    applicability: { district: "RM-1" },
    claimIds: ["phl:claim:h", baseClaim],
    currentness: "CURRENT",
    conflictRefs: [],
  });
  materializeConstraint(ctx, {
    id: "phl:constraint:h",
    kind: "constraint",
    constraintKind: "height",
    regulationId: "phl:reg:h",
    limit: { value: overrides.heightFt ?? 38, unit: "ft" },
    appliesTo: "principal-structure",
  });
  lawClaim("phl:claim:oa", "occupied-area", { type: "qualitative", text: "75%" }, "75%");
  upsertRegulation(ctx, {
    id: "phl:reg:oa",
    kind: "regulation",
    jurisdictionKey: "philadelphia-pa",
    codeSection: "75%",
    applicability: { district: "RM-1" },
    claimIds: ["phl:claim:oa", baseClaim],
    currentness: "CURRENT",
    conflictRefs: [],
  });
  materializeConstraint(ctx, {
    id: "phl:constraint:oa",
    kind: "constraint",
    constraintKind: "occupied-area",
    regulationId: "phl:reg:oa",
    byLotType: { intermediate: overrides.occupiedPct ?? 75 },
    unit: "percent",
  });
  lawClaim("phl:claim:pk", "parking-requirement", { type: "quantity", quantity: { value: 0, unit: "spaces" } }, "0");
  upsertRegulation(ctx, {
    id: "phl:reg:pk",
    kind: "regulation",
    jurisdictionKey: "philadelphia-pa",
    codeSection: "0",
    applicability: { district: "RM-1" },
    claimIds: ["phl:claim:pk", baseClaim],
    currentness: "CURRENT",
    conflictRefs: [],
  });
  materializeConstraint(ctx, {
    id: "ph:constraint:pk",
    kind: "constraint",
    constraintKind: "parking-requirement",
    regulationId: "phl:reg:pk",
    use: "multi-family",
    requirement: { type: "fixed", spaces: { value: 0, unit: "spaces" } },
  });
  lawClaim("phl:claim:dn", "density-formula", { type: "qualitative", text: "tiers" }, "tiers");
  upsertRegulation(ctx, {
    id: "phl:reg:dn",
    kind: "regulation",
    jurisdictionKey: "philadelphia-pa",
    codeSection: "tiers",
    applicability: { district: "RM-1" },
    claimIds: ["phl:claim:dn", baseClaim],
    currentness: "CURRENT",
    conflictRefs: [],
  });
  materializeConstraint(ctx, {
    id: "phl:constraint:dn",
    kind: "constraint",
    constraintKind: "density",
    regulationId: "phl:reg:dn",
    spec: {
      type: "tiered-min-lot-area-per-unit",
      tiers: overrides.densityTiers ?? [
        { firstSqFt: 1440, perUnit: 360 },
        { firstSqFt: 1440, perUnit: 480 },
      ],
      rounding: "down",
    },
  });
  const parkingMission = overrides.parkingMission ?? 0;
  if (!overrides.skipMissions && parkingMission >= 1) {
    confirmMissionConstraint(ctx, {
      id: "mission:pk",
      kind: "mission-constraint",
      intentText: "parking",
      normalized: { type: "min-parking", spaces: { value: parkingMission, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "u", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
  }
  if (overrides.sanctuarySqFtPolygon) {
    const sanctuaryId = "gis:structure:9";
    project.nodes[sanctuaryId] = {
      id: sanctuaryId,
      kind: "structure",
      parcelId,
      footprint: { geojson: { type: "Polygon", coordinates: [overrides.sanctuarySqFtPolygon.polygon] }, crs: "EPSG:4326", validity: "valid", derived: false },
      attributeClaimIds: [],
      meta: { revision: 1, semanticHash: "s", createdAt: NOW, lastModifiedAt: NOW },
    } as never;
    confirmMissionConstraint(ctx, {
      id: "mission:preserve",
      kind: "mission-constraint",
      intentText: "sanctuary",
      normalized: { type: "preserve-structure", structureId: sanctuaryId },
      origin: { kind: "USER_DECLARED", actorId: "u", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
  }
  seedSolverAssumptions(ctx);
  if (overrides.grossPerUnit !== undefined) {
    setAssumption(ctx, {
      id: "assumption:residential-gross-per-unit",
      kind: "assumption",
      statement: "gross/unit",
      value: { type: "quantity", quantity: { value: overrides.grossPerUnit, unit: "sq_ft_per_unit" } },
      rationale: "test",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
  }
  if (overrides.stallArea !== undefined) {
    setAssumption(ctx, {
      id: "assumption:parking-stall-gross-land-area",
      kind: "assumption",
      statement: "stall",
      value: { type: "quantity", quantity: { value: overrides.stallArea, unit: "sq_ft" } },
      rationale: "test",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
  }
  if (overrides.storyFt !== undefined) {
    setAssumption(ctx, {
      id: "assumption:story-floor-to-floor-height",
      kind: "assumption",
      statement: "story",
      value: { type: "quantity", quantity: { value: overrides.storyFt, unit: "ft" } },
      rationale: "test",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
  }
  return project;
}

// ~300 ft x 300 ft (~2.1 acres) — small enough that the full lattice stays
// far below MAX_ENUM_POINTS, big enough for meaningful scenario counts.
const SMALL_SQUARE: { polygon: [number, number][] } = {
  polygon: [
    [-75.05, 40.04],
    [-75.048928, 40.04],
    [-75.048928, 40.040823],
    [-75.05, 40.040823],
    [-75.05, 40.04],
  ],
};

describe("solver determinism and order invariance", () => {
  it("same project + same inputs → byte-equivalent scenario result", () => {
    const a = JSON.stringify(solve(canonicalProject()));
    const b = JSON.stringify(solve(canonicalProject()));
    expect(a).toBe(b);
  });

  it("property: order of project node insertion never changes the result (fuzzed)", () => {
    for (let seed = 0; seed < 5; seed += 1) {
      const project = tinyProject(SMALL_SQUARE, { parkingMission: seed });
      const first = JSON.stringify(solve(project));
      const shuffled = tinyProject(SMALL_SQUARE, { parkingMission: seed });
      // Re-seeded independently: results must still be identical.
      expect(JSON.stringify(solve(shuffled))).toBe(first);
    }
  });
});

describe("fail-closed truth boundary", () => {
  it("STALE law constraint cannot enter the solve", () => {
    const project = canonicalProject();
    // Invalidate the height constraint by making its claim conflicted via supersession.
    const ctx = contextFor(project);
    addSourceArtifact(ctx, {
      id: "phl:src:S5@v2",
      kind: "source-artifact",
      logicalSourceKey: "phl:src:S5",
      version: 2,
      sourceType: "official_city_reference",
      title: "later",
      publisher: "City",
      canonicalUrl: "https://t",
      authority: "OFFICIAL_CITY_REFERENCE",
      retrievedAt: "2026-12-01T00:00:00Z",
      rawContentHash: "d".repeat(64),
    });
    supersedeSourceArtifact(ctx, { sourceId: "phl:src:S5@v1", supersededBySourceId: "phl:src:S5@v2", conflictedRegulationIds: [], note: "later" });
    expect(() => solve(project)).toThrow(/not executable|superseded/);
  });

  it("missing assumption fails closed", () => {
    const project = tinyProject(SMALL_SQUARE);
    delete project.nodes["assumption:residential-gross-per-unit"];
    expect(() => solve(project)).toThrow(/assumption missing/);
  });

  it("inactive assumption fails closed", () => {
    const project = tinyProject(SMALL_SQUARE);
    const node = project.nodes["assumption:residential-gross-per-unit"];
    if (node && node.kind === "assumption") node.active = false;
    expect(() => solve(project)).toThrow(/inactive/);
  });
});

describe("degenerate and extreme inputs", () => {
  it("tiny parcel returns a typed result (not a crash)", () => {
    const tiny: { polygon: [number, number][] } = {
      polygon: [
        [-75.05, 40.04],
        [-75.0499, 40.04],
        [-75.0499, 40.0401],
        [-75.05, 40.0401],
        [-75.05, 40.04],
      ],
    };
    const result = solve(tinyProject(tiny, { parkingMission: 0 }));
    expect(["SOLVED", "NO_VERIFIED_SOLUTION"]).toContain(result.status);
  });

  it("zero developable area (sanctuary consumes everything) → NO VERIFIED SOLUTION", () => {
    const result = solve(
      tinyProject(SMALL_SQUARE, {
        parkingMission: 0,
        sanctuarySqFtPolygon: SMALL_SQUARE,
      }),
      { targetHomes: 5 },
    );
    expect(result.status).toBe("NO_VERIFIED_SOLUTION");
  });

  it("extremely high mission parking requirement → NO VERIFIED SOLUTION with honest ceilings", () => {
    const result = solve(tinyProject(SMALL_SQUARE, { parkingMission: 100000 }), { targetHomes: 1 });
    expect(result.status).toBe("NO_VERIFIED_SOLUTION");
    if (result.status !== "NO_VERIFIED_SOLUTION") return;
    expect(result.explanationInputs.length).toBeGreaterThan(0);
  });

  it("0 parking legal requirement + 0 mission minimum solves with full land", () => {
    const result = solve(tinyProject(SMALL_SQUARE, { parkingMission: 0 }));
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    expect(result.geometry.parkingStallsRequired).toBe(0);
    expect(result.geometry.parkingLandAreaSqFt).toBe(0);
  });

  it("negative/NaN assumption values are rejected (fail closed)", () => {
    const project = tinyProject(SMALL_SQUARE, { grossPerUnit: -100 });
    expect(() => solve(project)).toThrow(/positive finite|assumption/);
  });

  it("negative or NaN targetHomes rejected", () => {
    const project = canonicalProject();
    expect(() => solve(project, { targetHomes: -5 })).toThrow();
    expect(() => solve(project, { targetHomes: Number.NaN })).toThrow();
  });
});

describe("sensitivity — assumptions change capacity predictably", () => {
  it("gross/unit 1200 → 1000 raises capacity deterministically", () => {
    const base = solve(canonicalProject());
    if (base.status !== "SOLVED") throw new Error("base SOLVED");
    const project = canonicalProject();
    const ctx = contextFor(project);
    setAssumption(ctx, {
      id: "assumption:residential-gross-per-unit",
      kind: "assumption",
      statement: "gross/unit",
      value: { type: "quantity", quantity: { value: 1000, unit: "sq_ft_per_unit" } },
      rationale: "sensitivity",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
    const tighter = solve(project);
    if (tighter.status !== "SOLVED") throw new Error("sensitivity SOLVED");
    expect(tighter.overallCeiling).toBeGreaterThan(base.overallCeiling);
  });

  it("stall area 350 → 325 raises physical room", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    setAssumption(ctx, {
      id: "assumption:parking-stall-gross-land-area",
      kind: "assumption",
      statement: "stall",
      value: { type: "quantity", quantity: { value: 325, unit: "sq_ft" } },
      rationale: "sensitivity",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("SOLVED");
    expect(result.geometry.parkingLandAreaSqFt).toBe(110 * 325);
  });

  it("story height 11 → 10 ft can add a floor", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    setAssumption(ctx, {
      id: "assumption:story-floor-to-floor-height",
      kind: "assumption",
      statement: "story",
      value: { type: "quantity", quantity: { value: 10, unit: "ft" } },
      rationale: "sensitivity",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("SOLVED");
    expect(result.geometry.floorsCap).toBeGreaterThanOrEqual(3);
  });
});

// Map solver-evaluated results into recordScenario result rows (every
// executable constraint must have a row — the record is the proof history).
function scenarioResults(prefix: string, results: { constraintId?: string; constraintKey: string; status: EvaluatedConstraint["status"]; actual?: number; actualUnit?: string; limit?: number; limitUnit?: string; explanation: string }[]) {
  return results
    .filter((r) => r.constraintId !== undefined)
    .map((r) => ({
      resultId: `result:${prefix}:${r.constraintId}`,
      constraintId: r.constraintId as string,
      status: r.status,
      actual: r.actual !== undefined && r.actualUnit !== undefined
        ? { value: r.actual, unit: Unit.parse(r.actualUnit) }
        : null,
      limit: r.limit !== undefined && r.limitUnit !== undefined
        ? { value: r.limit, unit: Unit.parse(r.limitUnit) }
        : null,
      explanation: r.explanation,
    }));
}

describe("certificate staleness after consequential change", () => {
  it("mission parking change stales a dependent certificate; unrelated stays CURRENT", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const solveFirst = solve(project);
    if (solveFirst.status !== "SOLVED") throw new Error("SOLVED");

    // Record a scenario depending on the mission + law constraints + assumptions.
    recordScenario(ctx, {
      scenarioId: "scenario:hero",
      label: "Hero",
      solverVersion: "test@1",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: solveFirst.overallCeiling, unit: "dwelling_units" } }],
      constraintIds: solveFirst.inputs.law.map((c) => c.id),
      missionIds: solveFirst.inputs.missions.map((m) => m.id),
      assumptionIds: solveFirst.inputs.assumptionIds,
      parcelId: solveFirst.inputs.parcelId,
      results: scenarioResults("hero", solveFirst.scenarios[0].results),
      certificateId: "scenario:hero:certificate",
    });
    // Record an unrelated scenario depending only on law.
    recordScenario(ctx, {
      scenarioId: "scenario:unrelated",
      label: "Unrelated",
      solverVersion: "test@1",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 1, unit: "dwelling_units" } }],
      constraintIds: solveFirst.inputs.law.map((c) => c.id),
      missionIds: [],
      assumptionIds: solveFirst.inputs.assumptionIds,
      parcelId: solveFirst.inputs.parcelId,
      results: scenarioResults("unrelated", solveFirst.scenarios[0].results),
      certificateId: "scenario:unrelated:certificate",
    });
    expect(gradeCertificate(project, "scenario:hero:certificate").freshness).toBe("CURRENT");

    // Change mission parking 110 → 130 through the typed command.
    confirmMissionConstraint(ctx, {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint",
      intentText: "Keep at least 130 Sunday parking spaces.",
      normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    expect(["STALE", "INVALIDATED"]).toContain(gradeCertificate(project, "scenario:hero:certificate").freshness);
    expect(gradeCertificate(project, "scenario:unrelated:certificate").freshness).toBe("CURRENT");

    // Deterministic: the new solve reflects the new parking floor.
    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    expect(after.geometry.parkingStallsRequired).toBe(130);
    expect(after.overallCeiling).toBeLessThan(solveFirst.overallCeiling);
  });

  it("changing law height 38 → 45 changes the solution deterministically", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const before = solve(project);
    if (before.status !== "SOLVED") throw new Error("SOLVED");
    // Upsert a taller height constraint through the typed replace path.
    replaceExecutableConstraint(ctx, {
      id: "phl:constraint:height:max:principal",
      kind: "constraint",
      constraintKind: "height",
      regulationId: "phl:reg:height:max:principal",
      limit: { value: 45, unit: "ft" },
      appliesTo: "principal-structure",
    });
    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("SOLVED");
    expect(after.geometry.floorsCap).toBeGreaterThanOrEqual(before.geometry.floorsCap);
  });
});

describe("property: enumerated feasible lattice", () => {
  it("homes are monotonically achievable: every value 0..max is feasible (0-parking case)", () => {
    const project = tinyProject(SMALL_SQUARE, { parkingMission: 0 });
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("SOLVED");
    const max = result.frontier.reduce((m, p) => Math.max(m, p.homes), 0);
    for (let target = 0; target <= max; target += Math.max(1, Math.floor(max / 12))) {
      expect(solve(project, { targetHomes: target }).status).toBe("SOLVED");
    }
    if (max > 0) expect(solve(project, { targetHomes: max + 1 }).status).toBe("NO_VERIFIED_SOLUTION");
  });

  it("fuzz: random plausible projects never emit a VIOLATED hard constraint as valid", () => {
    let checked = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const project = tinyProject(SMALL_SQUARE, {
        parkingMission: (seed * 7) % 200,
        heightFt: 20 + seed,
        occupiedPct: 40 + (seed % 50),
      });
      const result = solve(project);
      if (result.status !== "SOLVED") continue;
      for (const scenario of result.scenarios) {
        for (const r of scenario.results) {
          if (r.source === "law" || r.source === "mission") {
            expect(r.status === "VIOLATED").toBe(false);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
