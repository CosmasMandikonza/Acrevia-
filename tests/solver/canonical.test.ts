import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contextFor } from "../domain/helpers";
import type { Project } from "../../src/domain/graph/project";
import {
  seedSolverAssumptions,
} from "../../src/application/solver/assumptions";
import { solve, attainableHomes, type CandidatePoint } from "../../src/application/solver/solve";
import { SolveRefusal } from "../../src/application/solver/inputs";
import { recordSolverScenarios } from "../../src/application/solver/record";
import { buildGeometryHandoff } from "../../src/application/solver/geometry-handoff";
import { Unit, gradeCertificate } from "../../src/domain";
import {
  confirmMissionConstraint,
  addSourceArtifact,
  recordClaim,
  upsertRegulation,
  materializeConstraint,
  recordScenario,
  setAssumption,
  replaceExecutableConstraint,
} from "../../src/commands";

/**
 * Canonical Calvary solver benchmark (issue #7): proves the three capacity
 * ceilings separately, the truthful 70-home result, the exact first
 * impossible target, Pareto non-domination, and the neutral #9 handoff —
 * with honest math, never a hard-coded conclusion.
 */

const PARCEL_GEOJSON = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia/raw/gis/pwd-parcel-brt-778273000.geojson"),
    "utf8",
  ),
).features[0].geometry;
const SANCTUARY_GEOJSON = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia/raw/gis/footprints-parcel-494018.json"),
    "utf8",
  ),
).features[0].geometry;

const NOW = "2026-10-09T12:00:00.000Z";

/** Build the canonical solvable Calvary project from real geometry + law. */
function canonicalProject(
  options: { usePermission?: "BY_RIGHT" | "SPECIAL_EXCEPTION" | "PROHIBITED" | "missing" } = {},
): Project {
  const parcelId = "gis:parcel:778273000";
  const sanctuaryId = "gis:structure:1282177";
  const project = {
    projectId: "gis:778273000",
    schemaVersion: "acrevia.graph.v1",
    revision: 0,
    propertyId: "gis:property:778273000",
    createdAt: NOW,
    updatedAt: NOW,
    nodes: {} as Record<string, never>,
    edges: [] as Array<{ dependentId: string; dependencyId: string; role: string }>,
    events: [],
  } as unknown as Project;

  const ctx = contextFor(project);
  const parcelGeoClaim = "gis:claim:zoning-base:778273000";
  const overlayGeoClaim = "gis:claim:zoning-overlays:778273000";

  // Parcel + structure with real geometry.
  project.nodes[parcelId] = {
    id: parcelId,
    kind: "parcel",
    parcelIdSystem: "PWD",
    parcelNumber: "778273000",
    geometry: { geojson: PARCEL_GEOJSON, crs: "EPSG:4326", validity: "valid", derived: false },
    claimIds: [parcelGeoClaim],
    meta: { revision: 1, semanticHash: "p", createdAt: NOW, lastModifiedAt: NOW },
  } as never;
  project.nodes[sanctuaryId] = {
    id: sanctuaryId,
    kind: "structure",
    parcelId,
    footprint: { geojson: SANCTUARY_GEOJSON, crs: "EPSG:4326", validity: "valid", derived: false },
    attributeClaimIds: [],
    meta: { revision: 1, semanticHash: "s", createdAt: NOW, lastModifiedAt: NOW },
  } as never;

  // GIS source artifacts + applicability claims (source-resolved, live).
  for (const [id, title] of [
    ["gis:src:zoning-base", "Zoning Base Districts (L&I zoning GIS layer)"],
    ["gis:src:zoning-overlays", "Zoning Overlays (L&I zoning GIS layer)"],
  ] as const) {
    addSourceArtifact(ctx, {
      id,
      kind: "source-artifact",
      logicalSourceKey: id,
      version: 1,
      sourceType: "official_gis",
      title,
      publisher: "City of Philadelphia",
      canonicalUrl: "https://li0.vo.llnwd.net/Service.svc/DownloadLayer",
      authority: "OFFICIAL_GIS",
      retrievedAt: "2026-10-04T04:30:00Z",
      rawContentHash: id.endsWith("base") ? "a".repeat(64) : "b".repeat(64),
    });
  }
  recordClaim(ctx, {
    id: parcelGeoClaim,
    kind: "claim",
    subjectNodeId: parcelId,
    predicate: "zoning-district",
    value: { type: "qualitative", text: "RM-1" },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["gis:src:zoning-base"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: 'long_code:"RM-1"',
  });
  recordClaim(ctx, {
    id: overlayGeoClaim,
    kind: "claim",
    subjectNodeId: parcelId,
    predicate: "zoning-overlays",
    value: { type: "qualitative", text: "/SIX Sixth District Overlay District" },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["gis:src:zoning-overlays"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: 'overlay_name:"/SIX Sixth District Overlay District"',
  });

  // Law sources + claims + regulations + executable constraints.
  const law: Array<{
    artifactId: string;
    key: string;
    claimId: string;
    predicate: (typeof import("../../src/domain/enums")) extends never ? never : Parameters<typeof recordClaim>[1]["predicate"];
    value: import("../../src/domain").ClaimValue;
    quote: string;
    constraint: Parameters<typeof materializeConstraint>[1];
  }> = [
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:height:max:principal",
      claimId: "phl:claim:height:max:principal:phl:src:S5@v1",
      predicate: "max-height",
      value: { type: "quantity", quantity: { value: 38, unit: "ft" } },
      quote: "| Max. Height / FAR | 38 ft. [5] * |",
      constraint: {
        id: "phl:constraint:height:max:principal",
        kind: "constraint",
        constraintKind: "height",
        regulationId: "phl:reg:height:max:principal",
        limit: { value: 38, unit: "ft" },
        appliesTo: "principal-structure",
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:bulk:occupied-area:max",
      claimId: "phl:claim:bulk:occupied-area:max:phl:src:S5@v1",
      predicate: "occupied-area",
      value: { type: "qualitative", text: "Intermediate 75%; Corner 80%" },
      quote: "| Max. Occupied Area | Intermediate 75%; Corner 80% [2] |",
      constraint: {
        id: "phl:constraint:bulk:occupied-area:max",
        kind: "constraint",
        constraintKind: "occupied-area",
        regulationId: "phl:reg:bulk:occupied-area:max",
        byLotType: { intermediate: 75, corner: 80 },
        unit: "percent",
      },
    },
    {
      artifactId: "phl:src:S7@v1",
      key: "phl:reg:parking:multi-family:minimum",
      claimId: "phl:claim:parking:multi-family:minimum:phl:src:S7@v1",
      predicate: "parking-requirement",
      value: { type: "quantity", quantity: { value: 0, unit: "spaces" } },
      quote: "Multi-Family — 1 | 0 | 3/10 units",
      constraint: {
        id: "phl:constraint:parking:multi-family:minimum",
        kind: "constraint",
        constraintKind: "parking-requirement",
        regulationId: "phl:reg:parking:multi-family:minimum",
        use: "multi-family",
        requirement: { type: "fixed", spaces: { value: 0, unit: "spaces" } },
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:density:min-lot-area-per-unit",
      claimId: "phl:claim:density:min-lot-area-per-unit:phl:src:S5@v1",
      predicate: "density-formula",
      value: {
        type: "qualitative",
        text: "360 sq ft per unit for the first 1,440 sq ft; 480 above.",
      },
      quote: "minimum lot area required per dwelling unit",
      constraint: {
        id: "phl:constraint:density:min-lot-area-per-unit",
        kind: "constraint",
        constraintKind: "density",
        regulationId: "phl:reg:density:min-lot-area-per-unit",
        spec: {
          type: "tiered-min-lot-area-per-unit",
          tiers: [
            { firstSqFt: 1440, perUnit: 360 },
            { firstSqFt: 1440, perUnit: 480 },
          ],
          rounding: "down",
        },
      },
    },
    {
      artifactId: "phl:src:S6@v1",
      key: "phl:reg:overlay:/six:adu-prohibition",
      claimId: "phl:claim:overlay:/six:adu-prohibition:phl:src:S6@v1",
      predicate: "overlay-restriction",
      value: { type: "qualitative", text: "ADUs prohibited" },
      quote: "(.c) Accessory dwelling units shall not be permitted.",
      constraint: {
        id: "phl:constraint:overlay:/six:adu-prohibition",
        kind: "constraint",
        constraintKind: "overlay-prohibition",
        regulationId: "phl:reg:overlay:/six:adu-prohibition",
        overlay: "/SIX",
        prohibits: "accessory-dwelling-units",
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:use:multi-family:permission",
      claimId: "phl:claim:use:multi-family:permission:phl:src:S5@v1",
      predicate: "use-permission",
      value: { type: "qualitative", text: "Y[1]" },
      quote: "| Multi-Family | Y[1] |",
      constraint: {
        id: "phl:constraint:use:multi-family:permission",
        kind: "constraint",
        constraintKind: "use-permission",
        regulationId: "phl:reg:use:multi-family:permission",
        use: "multi-family",
        permission: "BY_RIGHT",
      },
    },
    {
      artifactId: "phl:src:S7@v1",
      key: "phl:reg:parking:religious-assembly:minimum",
      claimId: "phl:claim:parking:religious-assembly:minimum:phl:src:S7@v1",
      predicate: "parking-requirement",
      value: { type: "qualitative", text: "1/10 seats or 1/1,000 sq. ft., whichever is greater" },
      quote: "Religious Assembly — \"1/10 seats or 1/1,000 sq. ft., whichever is greater\"",
      constraint: {
        id: "phl:constraint:parking:religious-assembly:minimum",
        kind: "constraint",
        constraintKind: "parking-requirement",
        regulationId: "phl:reg:parking:religious-assembly:minimum",
        use: "religious-assembly",
        requirement: { type: "formula", formulaId: "religious-assembly", text: "1/10 seats or 1/1,000 sq. ft., whichever is greater" },
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:setback:front",
      claimId: "phl:claim:setback:front:phl:src:S5@v1",
      predicate: "setback-front",
      value: { type: "qualitative", text: "Based on adjacent [5,6]" },
      quote: "| Min. Front Setback | Based on adjacent [5,6] |",
      constraint: {
        id: "phl:constraint:setback:front",
        kind: "constraint",
        constraintKind: "setback",
        regulationId: "phl:reg:setback:front",
        face: "front",
        spec: { type: "contextual", ruleId: "adjacent-facades" },
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:setback:side:min",
      claimId: "phl:claim:setback:side:min:phl:src:S5@v1",
      predicate: "setback-side",
      value: { type: "quantity", quantity: { value: 5, unit: "ft" } },
      quote: "| * Min. Side Yard Width [8] | 5' to 12' based on number of families |",
      constraint: {
        id: "phl:constraint:setback:side:min",
        kind: "constraint",
        constraintKind: "setback",
        regulationId: "phl:reg:setback:side:min",
        face: "side",
        spec: { type: "range", range: { min: 5, max: 12, unit: "ft" } },
      },
    },
    {
      artifactId: "phl:src:S5@v1",
      key: "phl:reg:setback:rear:min",
      claimId: "phl:claim:setback:rear:min:phl:src:S5@v1",
      predicate: "setback-rear",
      value: { type: "quantity", quantity: { value: 9, unit: "ft" } },
      quote: "| Min. Rear Yard Depth | 9 ft. [9] |",
      constraint: {
        id: "phl:constraint:setback:rear:min",
        kind: "constraint",
        constraintKind: "setback",
        regulationId: "phl:reg:setback:rear:min",
        face: "rear",
        spec: { type: "numeric", min: { value: 9, unit: "ft" } },
      },
    },
  ];

  for (const [artifactId, authority, sourceType, title] of [
    ["phl:src:S5@v1", "OFFICIAL_CITY_REFERENCE", "official_city_reference", "Quick Guide"],
    ["phl:src:S6@v1", "ADOPTED_CODE", "adopted_code", "§14-548"],
    ["phl:src:S7@v1", "ADOPTED_CODE", "adopted_code", "§14-802"],
  ] as const) {
    addSourceArtifact(ctx, {
      id: artifactId,
      kind: "source-artifact",
      logicalSourceKey: artifactId.split("@")[0],
      version: 1,
      sourceType,
      title,
      publisher: "City of Philadelphia",
      canonicalUrl: "https://example",
      authority,
      retrievedAt: "2026-10-04T04:00:00Z",
      rawContentHash: (artifactId.charCodeAt(9) + "").padEnd(64, "0"),
    });
  }

  for (const entry of law) {
    // Use-permission fixture variant for the solver precondition regressions.
    if (entry.constraint.constraintKind === "use-permission") {
      if (options.usePermission === "missing") continue;
      if (options.usePermission && options.usePermission !== "BY_RIGHT") {
        (entry.constraint as { permission: string }).permission = options.usePermission;
      }
    }
    recordClaim(ctx, {
      id: entry.claimId,
      kind: "claim",
      subjectNodeId: parcelId,
      predicate: entry.predicate,
      value: entry.value,
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [entry.artifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: entry.quote,
    });
    const applicability = entry.constraint.constraintKind === "overlay-prohibition"
      ? { overlay: "/SIX" }
      : { district: "RM-1" };
    upsertRegulation(ctx, {
      id: entry.key,
      kind: "regulation",
      jurisdictionKey: "philadelphia-pa",
      codeSection: entry.quote,
      applicability,
      claimIds: [
        entry.claimId,
        entry.constraint.constraintKind === "overlay-prohibition" ? overlayGeoClaim : parcelGeoClaim,
      ],
      currentness: "CURRENT",
      conflictRefs: [],
    });
    materializeConstraint(ctx, entry.constraint);
  }

  // Confirmed hard mission rules (issue #6 command boundary).
  confirmMissionConstraint(ctx, {
    id: "mission:min-sunday-parking",
    kind: "mission-constraint",
    intentText: "Keep at least 110 Sunday parking spaces.",
    normalized: { type: "min-parking", spaces: { value: 110, unit: "spaces" } },
    origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
  confirmMissionConstraint(ctx, {
    id: "mission:preserve-sanctuary",
    kind: "mission-constraint",
    intentText: "Keep the sanctuary.",
    normalized: { type: "preserve-structure", structureId: sanctuaryId },
    origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
  confirmMissionConstraint(ctx, {
    id: "mission:retain-ownership",
    kind: "mission-constraint",
    intentText: "We are not selling the land.",
    normalized: { type: "retain-ownership" },
    origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });

  seedSolverAssumptions(ctx);
  return project;
}

describe("canonical Calvary solver benchmark", () => {
  it("computes the three ceilings INDEPENDENTLY with real geometry (no copying)", () => {
    const project = canonicalProject();
    const result = solve(project);
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const { geometry: g, ceilings } = result;

    expect(g.floorsCap).toBe(3); // floor(38 ft / 11 ft floor-to-floor)
    // Legal density: 4 + floor((parcel − 1,440)/480) — fixture-computed 249.
    expect(ceilings.legalDensity).toBe(4 + Math.floor((g.parcelAreaSqFt - 1440) / 480));
    // Massing (occupied-area envelope, parking land NOT subtracted):
    // floor(floor(75% × parcel − sanctuary) × 3 ÷ 1,200)
    const massingFormula = Math.floor(
      Math.floor((g.occupiedAreaCeilingPct / 100) * g.parcelAreaSqFt - g.preservedStructureAreaSqFt) *
        g.floorsCap /
        1200,
    );
    expect(ceilings.massing).toBe(massingFormula);
    // Physical site area budget (parcel − sanctuary − 110 × 350):
    const physicalFormula = Math.floor(
      Math.floor(
        g.parcelAreaSqFt - g.preservedStructureAreaSqFt - 110 * 350,
      ) *
        g.floorsCap /
        1200,
    );
    expect(ceilings.physicalSiteAreaBudget).toBe(physicalFormula);
    // Independent by construction on the canonical parcel: massing > physical.
    expect(ceilings.massing).toBeGreaterThan(ceilings.physicalSiteAreaBudget);
    expect(ceilings.legalDensity).toBeGreaterThan(ceilings.massing);
    // Overall = min of the independently computed ceilings; shared primitive agrees.
    expect(ceilings.overall).toBe(
      Math.min(ceilings.legalDensity ?? Infinity, ceilings.massing, ceilings.physicalSiteAreaBudget),
    );
    expect(ceilings.overall).toBe(attainableHomes(result.inputs, g));
  });

  it("no footprint-lattice artifact: the modeled bound follows the exact area, not a 500-sq-ft grid", () => {
    const project = canonicalProject();
    const result = solve(project);
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const { geometry: g, ceilings } = result;
    const M = ceilings.overall;
    // Exact-footprint feasibility of M: ceil(M × 1,200 / 3) fits the room…
    expect(Math.ceil((M * 1200) / g.floorsCap)).toBeLessThanOrEqual(
      g.parcelAreaSqFt - g.preservedStructureAreaSqFt - 110 * 350,
    );
    // …and M+1 does NOT — with ~49,434 sq ft of room the exact answer is 123,
    // whereas the old 500-sq-ft lattice would have said 122.
    expect(Math.ceil(((M + 1) * 1200) / g.floorsCap)).toBeGreaterThan(
      g.parcelAreaSqFt - g.preservedStructureAreaSqFt - 110 * 350,
    );
    expect(M).toBe(123); // computed truth of the corrected solver (fixture bytes)
    // The selected HOUSING MAX point carries the exact minimum footprint.
    const housingMax = result.scenarios.find((s) => s.label === "HOUSING MAX");
    expect(housingMax).toBeDefined();
    if (!housingMax) return;
    expect(housingMax.point.footprintSqFt).toBe(Math.ceil((M * 1200) / housingMax.point.floors));
    expect(housingMax.point.footprintSqFt % 500).not.toBe(0); // not a lattice value
  });

  it("parking range is DERIVED from site area — no hidden +60 cap", () => {
    const project = canonicalProject();
    const result = solve(project);
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const { geometry: g, enumeration, frontier } = result;
    const derivedMax = Math.floor(
      (g.parcelAreaSqFt - g.preservedStructureAreaSqFt) / 350,
    );
    expect(enumeration.parkingStallsMax).toBe(derivedMax); // ~251, not required+60
    expect(derivedMax - enumeration.parkingStallsMin).toBeGreaterThan(60);
    // The frontier actually reaches beyond required+60 (full modeled space).
    const maxStalls = frontier.reduce((m, p) => Math.max(m, p.parkingStalls), 0);
    expect(maxStalls).toBeGreaterThan(enumeration.parkingStallsMin + 60);
    // And the pre-search bound covered exactly that derived space.
    expect(enumeration.pointsConsidered).toBe(
      (enumeration.homesUpperBound + 1) * enumeration.floorsCap *
        (enumeration.parkingStallsMax - enumeration.parkingStallsMin + 1),
    );
  });

  it("M is supported and M+1 is the first NO VERIFIED SOLUTION — from the corrected solver", () => {
    const project = canonicalProject();
    const base = solve(project);
    expect(base.status).toBe("SOLVED");
    if (base.status !== "SOLVED") return;
    const M = base.ceilings.overall;

    const atMax = solve(project, { targetHomes: M });
    expect(atMax.status).toBe("SOLVED");
    const beyond = solve(project, { targetHomes: M + 1 });
    expect(beyond.status).toBe("NO_VERIFIED_SOLUTION");
    if (beyond.status !== "NO_VERIFIED_SOLUTION") return;
    expect(beyond.modeledUpperBoundHomes).toBe(M);
    expect(beyond.requestedTarget).toBe(M + 1);
    // The refusal explains the three modeled ceilings and the bound's meaning.
    expect(beyond.explanationInputs.join(" ")).toContain("modeled upper bound");
  });

  it("70 homes is SUPPORTED WITHIN MODELED SCOPE — computed, never hard-coded", () => {
    const result = solve(canonicalProject(), { targetHomes: 70 });
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    expect(result.scenarios.every((s) => s.point.homes >= 70)).toBe(true);
    // Language discipline: the confidence vocabulary never claims placement-
    // proven feasibility — canonical unknowns (contextual setback, special
    // exception) honestly force EXPERT_REVIEW_REQUIRED here.
    for (const scenario of result.scenarios) {
      expect(["SUPPORTED_WITHIN_MODED_SCOPE", "ASSUMPTION_SENSITIVE", "EXPERT_REVIEW_REQUIRED"]).toContain(
        scenario.confidence,
      );
    }
    expect(
      result.scenarios.some((r) => r.results.some((row) => /AREA ARITHMETIC/i.test(row.explanation))),
    ).toBe(true);
  });

  it("binding constraints are proven by the SAME shared primitive, one bound at a time", () => {
    const project = canonicalProject();
    const base = solve(project);
    expect(base.status).toBe("SOLVED");
    const impossible = solve(project, { targetHomes: (base.status === "SOLVED" ? base.ceilings.overall : 0) + 1 });
    expect(impossible.status).toBe("NO_VERIFIED_SOLUTION");
    if (impossible.status !== "NO_VERIFIED_SOLUTION" || base.status !== "SOLVED") return;

    expect(impossible.binding.length).toBeGreaterThan(0);
    for (const proof of impossible.binding) {
      expect(proof.capacityDelta).toBeGreaterThan(0);
      expect(proof.capacityAfter).toBeGreaterThan(proof.capacityBefore);
      expect(proof.capacityBefore).toBe(base.ceilings.overall); // same primitive as the primary solve
    }
    // Mission-locked counterfactuals are explained but never offered.
    expect(impossible.binding.some((p) => p.missionLocked)).toBe(true);
    expect(impossible.counterfactuals.join(" ")).toContain("did not use that alternative");
    // Density is NOT binding on the canonical parcel (249 > 145 > 123), so it
    // must not appear as a binding proof.
    expect(impossible.binding.some((p) => p.constraintKey === "law:density")).toBe(false);
  });

  it("every returned scenario satisfies every hard constraint (no plausible-but-invalid)", () => {
    const result = solve(canonicalProject());
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    for (const scenario of result.scenarios) {
      for (const r of scenario.results) {
        if (r.source === "law" || r.source === "mission") {
          expect(r.status === "VIOLATED").toBe(false);
        }
      }
      // Exact-footprint invariants for the selected point.
      expect(scenario.point.footprintSqFt).toBe(
        Math.ceil((scenario.point.homes * 1200) / scenario.point.floors),
      );
    }
  });

  it("Pareto frontier is non-dominated over the full modeled space", () => {
    const result = solve(canonicalProject());
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const { frontier } = result;
    for (const a of frontier) {
      for (const b of frontier) {
        if (a === b) continue;
        const dominates =
          b.homes >= a.homes &&
          b.parkingMargin >= a.parkingMargin &&
          b.footprintSqFt <= a.footprintSqFt &&
          (b.homes > a.homes || b.parkingMargin > a.parkingMargin || b.footprintSqFt < a.footprintSqFt);
        expect(dominates).toBe(false); // no frontier point dominates another
      }
    }
    // The frontier reaches the modeled bound — the full space was searched.
    expect(frontier.reduce((m, p) => Math.max(m, p.homes), 0)).toBe(result.ceilings.overall);
  });

  it("labels satisfy their documented definitions (HOUSING MAX / LOW CHANGE / MISSION BALANCE)", () => {
    const result = solve(canonicalProject());
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const byLabel = new Map(result.scenarios.map((s) => [s.label, s.point]));
    const maxHomes = result.ceilings.overall;

    const housingMax = byLabel.get("HOUSING MAX");
    expect(housingMax).toBeDefined();
    expect(housingMax!.homes).toBe(maxHomes);

    const lowChange = byLabel.get("LOW CHANGE");
    expect(lowChange).toBeDefined();
    // LOW CHANGE actually minimizes footprint among displayed scenarios…
    const displayed = [...byLabel.values()];
    expect(lowChange!.footprintSqFt).toBe(Math.min(...displayed.map((p) => p.footprintSqFt)));
    // …subject to the usefulness criterion: ≥ half the modeled maximum homes.
    expect(lowChange!.homes).toBeGreaterThanOrEqual(Math.ceil(maxHomes / 2));

    // MISSION BALANCE is the Pareto knee WITHIN the useful set (homes ≥
    // ceil(max/2)): closest min-max-normalized point to the ideal corner.
    const missionBalance = byLabel.get("MISSION BALANCE");
    expect(missionBalance).toBeDefined();
    const f = result.frontier.filter((p) => p.homes >= Math.ceil(maxHomes / 2));
    const minH = Math.min(...f.map((p) => p.homes));
    const maxH = Math.max(...f.map((p) => p.homes));
    const minM = Math.min(...f.map((p) => p.parkingMargin));
    const maxM = Math.max(...f.map((p) => p.parkingMargin));
    const minF = Math.min(...f.map((p) => p.footprintSqFt));
    const maxF = Math.max(...f.map((p) => p.footprintSqFt));
    const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0.5);
    const dist = (p: CandidatePoint) =>
      Math.hypot(
        1 - norm(p.homes, minH, maxH),
        1 - norm(p.parkingMargin, minM, maxM),
        norm(p.footprintSqFt, minF, maxF),
      );
    const knee = f.reduce((best, p) => (dist(p) < dist(best) - 1e-12 ? p : best), f[0]);
    expect(missionBalance!.homes).toBe(knee.homes);
    expect(missionBalance!.parkingStalls).toBe(knee.parkingStalls);

    // Deterministic + order-invariant labels.
    const again = solve(canonicalProject());
    expect(JSON.stringify(again.status === "SOLVED" ? again.scenarios.map((s) => [s.label, s.point]) : null)).toBe(
      JSON.stringify(result.scenarios.map((s) => [s.label, s.point])),
    );
  });

  it("multi-family use permission gates the solver: BY_RIGHT / SPECIAL_EXCEPTION / PROHIBITED / missing", () => {
    // BY_RIGHT: normal solve.
    const byRight = solve(canonicalProject({ usePermission: "BY_RIGHT" }));
    expect(byRight.status).toBe("SOLVED");

    // SPECIAL_EXCEPTION: conditional pathway — every scenario EXPERT_REVIEW_REQUIRED.
    const special = solve(canonicalProject({ usePermission: "SPECIAL_EXCEPTION" }));
    expect(special.status).toBe("SOLVED");
    if (special.status !== "SOLVED") return;
    expect(special.scenarios.length).toBeGreaterThan(0);
    for (const scenario of special.scenarios) {
      expect(scenario.confidence).toBe("EXPERT_REVIEW_REQUIRED");
      expect(
        scenario.professionalQuestions.some((q) => /SPECIAL_EXCEPTION/i.test(q)),
      ).toBe(true);
    }

    // PROHIBITED: NO VERIFIED SOLUTION with the prohibition as a binding proof.
    const prohibited = solve(canonicalProject({ usePermission: "PROHIBITED" }));
    expect(prohibited.status).toBe("NO_VERIFIED_SOLUTION");
    if (prohibited.status !== "NO_VERIFIED_SOLUTION") return;
    expect(prohibited.modeledUpperBoundHomes).toBe(0);
    const useProof = prohibited.binding.find((p) => /use permission/i.test(p.humanLabel));
    expect(useProof).toBeDefined();
    expect(useProof!.capacityDelta).toBeGreaterThan(0); // relaxing ONLY the prohibition unlocks homes
    expect(useProof!.missionLocked).toBe(false);

    // Missing: fail closed — the solver never assumes permission.
    expect(() => solve(canonicalProject({ usePermission: "missing" }))).toThrow(SolveRefusal);
    expect(() => solve(canonicalProject({ usePermission: "missing" }))).toThrow(/use-permission|permission/i);
  });

  it("unknown law and setbacks never default — they surface honestly", () => {
    const result = solve(canonicalProject());
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;
    const all = result.scenarios.flatMap((s) => s.results);
    expect(all.some((r) => r.status === "NOT_EVALUATED" && /setback/i.test(r.humanLabel))).toBe(true);
    expect(all.some((r) => r.status === "EXPERT_REQUIRED" && /front setback/i.test(r.humanLabel))).toBe(true);
    expect(all.some((r) => /formula/i.test(r.explanation) && r.status === "NOT_EVALUATED")).toBe(true);
    // Area-arithmetic discipline: no scenario claims placement-proven scope.
    expect(all.some((r) => /AREA ARITHMETIC/i.test(r.explanation))).toBe(true);
    expect(result.scenarios[0].confidence).not.toBe("SUPPORTED_WITHIN_MODED_SCOPE");
  });

  it("neutral #9 geometry handoff carries regions, statuses, and no renderer concepts", () => {
    const result = solve(canonicalProject());
    const handoff = buildGeometryHandoff(result);
    expect(handoff.legalEnvelopeVerified).toBe(false);
    const roles = handoff.regions.map((r) => r.role);
    expect(roles).toContain("parcel-boundary");
    expect(roles).toContain("preserved-structure");
    expect(roles).toContain("parking-reservation");
    expect(roles).toContain("proposed-footprint");
    expect(handoff.unresolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(handoff)).not.toMatch(/three|@react-three|maplibre/i);
  });

  it("production recording: every displayed scenario gets a CURRENT ScenarioCertificate (closure complete)", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const solved = solve(project);
    expect(solved.status).toBe("SOLVED");
    if (solved.status !== "SOLVED") return;
    const hero = solved.scenarios[0];

    // THE production path (same helper the API route calls).
    const recorded = recordSolverScenarios(ctx, solved);
    expect(recorded.length).toBe(solved.scenarios.length);
    for (const entry of recorded) {
      expect(entry.freshness).toBe("CURRENT");
      expect(project.nodes[entry.scenarioId]).toBeDefined();
    }

    // Idempotent: replaying identical solve state reuses the same ids.
    const replay = recordSolverScenarios(ctx, solved);
    expect(replay.map((r) => r.scenarioId)).toEqual(recorded.map((r) => r.scenarioId));

    // Closure reaches the whole truth chain at pinned revisions.
    const certNode = project.nodes[recorded[0].certificateId] as unknown as {
      dependencies: Array<{ nodeId: string; nodeKind: string; revision: number; semanticHash: string }>;
    };
    const depIds = new Set(certNode.dependencies.map((d) => d.nodeId));
    for (const id of [
      "phl:constraint:height:max:principal",
      "phl:constraint:bulk:occupied-area:max",
      "phl:constraint:parking:multi-family:minimum",
      "phl:constraint:density:min-lot-area-per-unit",
      "phl:constraint:overlay:/six:adu-prohibition",
      "phl:constraint:use:multi-family:permission",
    ]) {
      expect(depIds.has(id), `law constraint ${id}`).toBe(true);
    }
    for (const id of [
      "phl:reg:height:max:principal",
      "phl:reg:bulk:occupied-area:max",
      "phl:reg:parking:multi-family:minimum",
      "phl:reg:density:min-lot-area-per-unit",
      "phl:reg:overlay:/six:adu-prohibition",
    ]) {
      expect(depIds.has(id), `regulation ${id}`).toBe(true);
    }
    for (const id of [
      "phl:claim:height:max:principal:phl:src:S5@v1",
      "phl:claim:bulk:occupied-area:max:phl:src:S5@v1",
      "phl:claim:parking:multi-family:minimum:phl:src:S7@v1",
      "phl:claim:density:min-lot-area-per-unit:phl:src:S5@v1",
      "phl:claim:overlay:/six:adu-prohibition:phl:src:S6@v1",
    ]) {
      expect(depIds.has(id), `claim ${id}`).toBe(true);
    }
    for (const id of ["phl:src:S5@v1", "phl:src:S6@v1", "phl:src:S7@v1", "gis:src:zoning-base", "gis:src:zoning-overlays"]) {
      expect(depIds.has(id), `source artifact ${id}`).toBe(true);
    }
    for (const id of ["mission:min-sunday-parking", "mission:preserve-sanctuary", "mission:retain-ownership"]) {
      expect(depIds.has(id), `mission ${id}`).toBe(true);
    }
    expect(depIds.has("gis:structure:1282177")).toBe(true);
    expect(depIds.has("gis:parcel:778273000")).toBe(true);
    for (const id of solved.inputs.assumptionIds) {
      expect(depIds.has(id), `assumption ${id}`).toBe(true);
    }
    for (const dep of certNode.dependencies) {
      const node = project.nodes[dep.nodeId] as unknown as { kind: string; meta?: { revision?: number } } | undefined;
      expect(node, `dependency node exists: ${dep.nodeId}`).toBeDefined();
      expect(node?.kind).toBe(dep.nodeKind);
      expect(node?.meta?.revision).toBe(dep.revision);
    }
    void hero;
  });

  it("certificate staleness: law / mission / assumption changes stale the hero; unrelated stays CURRENT", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    const recorded = recordSolverScenarios(ctx, solved);
    const heroCert = recorded[0].certificateId;
    expect(gradeCertificate(project, heroCert).freshness).toBe("CURRENT");

    // Law change (typed replace path) stales the hero.
    replaceExecutableConstraint(ctx, {
      id: "phl:constraint:height:max:principal",
      kind: "constraint",
      constraintKind: "height",
      regulationId: "phl:reg:height:max:principal",
      limit: { value: 45, unit: "ft" },
      appliesTo: "principal-structure",
    });
    expect(gradeCertificate(project, heroCert).freshness).not.toBe("CURRENT");

    // Fresh project; mission change (110 → 130) stales the hero.
    const project2 = canonicalProject();
    const ctx2 = contextFor(project2);
    const solved2 = solve(project2);
    if (solved2.status !== "SOLVED") throw new Error("SOLVED 2");
    const recorded2 = recordSolverScenarios(ctx2, solved2);
    confirmMissionConstraint(ctx2, {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint",
      intentText: "Keep at least 130 Sunday parking spaces.",
      normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    expect(gradeCertificate(project2, recorded2[0].certificateId).freshness).not.toBe("CURRENT");
    // The re-solve reflects the new parking floor deterministically.
    const after = solve(project2);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    expect(after.geometry.parkingStallsRequired).toBe(130);
    expect(after.ceilings.overall).toBeLessThan(solved2.ceilings.overall);

    // Fresh project; assumption change stales the hero.
    const project3 = canonicalProject();
    const ctx3 = contextFor(project3);
    const solved3 = solve(project3);
    if (solved3.status !== "SOLVED") throw new Error("SOLVED 3");
    const recorded3 = recordSolverScenarios(ctx3, solved3);
    setAssumption(ctx3, {
      id: "assumption:residential-gross-per-unit",
      kind: "assumption",
      statement: "gross/unit",
      value: { type: "quantity", quantity: { value: 1000, unit: "sq_ft_per_unit" } },
      rationale: "sensitivity",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
    expect(gradeCertificate(project3, recorded3[0].certificateId).freshness).not.toBe("CURRENT");

    // Unrelated law-only certificate stays CURRENT across a mission change.
    const project4 = canonicalProject();
    const ctx4 = contextFor(project4);
    const solved4 = solve(project4);
    if (solved4.status !== "SOLVED") throw new Error("SOLVED 4");
    const unrelated = recordSolverScenarios(ctx4, solved4);
    // A law-only scenario recorded through the same command with missionIds [].
    recordScenario(ctx4, {
      scenarioId: "scenario:unrelated-law-only",
      label: "Unrelated",
      solverVersion: "solver/exact-integer-homes v2",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: 1, unit: "dwelling_units" } }],
      constraintIds: solved4.inputs.law.map((c) => c.id),
      missionIds: [],
      assumptionIds: solved4.inputs.assumptionIds,
      parcelId: solved4.inputs.parcelId,
      results: solved4.scenarios[0].results
        .filter((r) => r.constraintId !== undefined)
        .map((r) => ({
          resultId: `result:unrelated:${r.constraintId}`,
          constraintId: r.constraintId as string,
          status: r.status,
          actual:
            r.actual !== undefined && r.actualUnit !== undefined
              ? { value: r.actual, unit: Unit.parse(r.actualUnit) }
              : null,
          limit:
            r.limit !== undefined && r.limitUnit !== undefined
              ? { value: r.limit, unit: Unit.parse(r.limitUnit) }
              : null,
          explanation: r.explanation,
        })),
      certificateId: "scenario:unrelated-law-only:certificate",
    });
    confirmMissionConstraint(ctx4, {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint",
      intentText: "Keep at least 130 Sunday parking spaces.",
      normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    expect(gradeCertificate(project4, "scenario:unrelated-law-only:certificate").freshness).toBe("CURRENT");
    expect(gradeCertificate(project4, unrelated[0].certificateId).freshness).not.toBe("CURRENT");
  });

  it("scenario identity includes dependency SEMANTIC state: same point + changed law → new CURRENT certificate, replay reuses it", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const before = solve(project);
    if (before.status !== "SOLVED") throw new Error("SOLVED");
    const recordedA = recordSolverScenarios(ctx, before);
    for (const entry of recordedA) expect(entry.freshness).toBe("CURRENT");

    // Consequential LAW change that does NOT move the selected point:
    // occupied-area 75% → 76% relaxes a NON-binding ceiling (the physical
    // area budget still binds), so every homes/floors/parking point stays
    // identical while the law node's revision + semanticHash change.
    replaceExecutableConstraint(ctx, {
      id: "phl:constraint:bulk:occupied-area:max",
      kind: "constraint",
      constraintKind: "occupied-area",
      regulationId: "phl:reg:bulk:occupied-area:max",
      byLotType: { intermediate: 76 },
      unit: "percent",
    });
    for (const entry of recordedA) {
      expect(gradeCertificate(project, entry.certificateId).freshness).not.toBe("CURRENT");
    }

    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    // The selected point is deliberately identical — only the identity of
    // the proof changed.
    expect(JSON.stringify(after.scenarios.map((s) => s.point))).toBe(
      JSON.stringify(before.scenarios.map((s) => s.point)),
    );
    const recordedB = recordSolverScenarios(ctx, after);
    expect(recordedB.length).toBe(recordedA.length);
    for (let i = 0; i < recordedB.length; i += 1) {
      expect(recordedB[i].scenarioId).not.toBe(recordedA[i].scenarioId);
      expect(recordedB[i].certificateId).not.toBe(recordedA[i].certificateId);
      expect(recordedB[i].freshness).toBe("CURRENT");
    }

    // Replay of the unchanged new state reuses cert B's identity.
    const replayB = recordSolverScenarios(ctx, after);
    expect(replayB.map((r) => r.scenarioId)).toEqual(recordedB.map((r) => r.scenarioId));
    for (const entry of replayB) expect(entry.freshness).toBe("CURRENT");
  });

  it("scenario identity includes dependency SEMANTIC state: same point + changed mission text → new CURRENT certificate, replay reuses it", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const before = solve(project);
    if (before.status !== "SOLVED") throw new Error("SOLVED");
    const recordedA = recordSolverScenarios(ctx, before);
    for (const entry of recordedA) expect(entry.freshness).toBe("CURRENT");

    // Consequential MISSION change that does NOT move the selected point:
    // retain-ownership wording changes the mission node's semantics while
    // leaving every homes/floors/parking value identical.
    confirmMissionConstraint(ctx, {
      id: "mission:retain-ownership",
      kind: "mission-constraint",
      intentText: "We will never sell the land — not now, not later.",
      normalized: { type: "retain-ownership" },
      origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    });
    for (const entry of recordedA) {
      expect(gradeCertificate(project, entry.certificateId).freshness).not.toBe("CURRENT");
    }

    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    expect(JSON.stringify(after.scenarios.map((s) => s.point))).toBe(
      JSON.stringify(before.scenarios.map((s) => s.point)),
    );
    const recordedB = recordSolverScenarios(ctx, after);
    for (let i = 0; i < recordedB.length; i += 1) {
      expect(recordedB[i].scenarioId).not.toBe(recordedA[i].scenarioId);
      expect(recordedB[i].freshness).toBe("CURRENT");
    }
    const replayB = recordSolverScenarios(ctx, after);
    expect(replayB.map((r) => r.scenarioId)).toEqual(recordedB.map((r) => r.scenarioId));
  });

  it("scenario identity includes dependency SEMANTIC state: same point + changed assumption → new CURRENT certificate, replay reuses it", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const before = solve(project);
    if (before.status !== "SOLVED") throw new Error("SOLVED");
    const recordedA = recordSolverScenarios(ctx, before);
    for (const entry of recordedA) expect(entry.freshness).toBe("CURRENT");

    // Consequential ASSUMPTION change that does NOT move the selected point:
    // the planning-envelope setback only shapes the conceptual massing note,
    // never homes/floors/parking.
    setAssumption(ctx, {
      id: "assumption:planning-envelope-uniform-setback",
      kind: "assumption",
      statement: "planning envelope",
      value: { type: "quantity", quantity: { value: 10, unit: "ft" } },
      rationale: "conceptual massing only",
      origin: { kind: "MODELER_DECLARED", actorId: "t" },
      active: true,
    });
    for (const entry of recordedA) {
      expect(gradeCertificate(project, entry.certificateId).freshness).not.toBe("CURRENT");
    }

    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    expect(JSON.stringify(after.scenarios.map((s) => s.point))).toBe(
      JSON.stringify(before.scenarios.map((s) => s.point)),
    );
    const recordedB = recordSolverScenarios(ctx, after);
    for (let i = 0; i < recordedB.length; i += 1) {
      expect(recordedB[i].scenarioId).not.toBe(recordedA[i].scenarioId);
      expect(recordedB[i].freshness).toBe("CURRENT");
    }
    const replayB = recordSolverScenarios(ctx, after);
    expect(replayB.map((r) => r.scenarioId)).toEqual(recordedB.map((r) => r.scenarioId));
  });
});

export { canonicalProject };
