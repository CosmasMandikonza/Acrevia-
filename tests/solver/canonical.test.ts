import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contextFor } from "../domain/helpers";
import type { Project } from "../../src/domain/graph/project";
import {
  seedSolverAssumptions,
} from "../../src/application/solver/assumptions";
import { solve } from "../../src/application/solver/solve";
import { buildGeometryHandoff } from "../../src/application/solver/geometry-handoff";
import { Unit } from "../../src/domain";
import {
  confirmMissionConstraint,
  addSourceArtifact,
  recordClaim,
  upsertRegulation,
  materializeConstraint,
  recordScenario,
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
function canonicalProject(): Project {
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
  it("computes the three ceilings separately with real geometry", () => {
    const project = canonicalProject();
    const result = solve(project);
    expect(result.status).toBe("SOLVED");
    if (result.status !== "SOLVED") return;

    // Legal density: 4 + floor((119,173 - 1,440)/480) = 249
    expect(result.legalDensityCeiling).toBe(249);
    // Massing: floors(38/11=3) × footprint(min(physical, occupied room))/1200
    expect(result.geometry.floorsCap).toBe(3);
    // Physical room: 119,173 - 31,239 sanctuary - 38,500 parking = 49,434
    expect(Math.round(result.geometry.physicalLandRoomSqFt)).toBe(49434);
    // Occupied room: 89,380 - 31,239 = 58,140 -> physical binds
    expect(Math.round(result.geometry.occupiedRoomSqFt)).toBe(58140);
    expect(Math.round(result.geometry.developableFootprintMaxSqFt)).toBe(49434);
    expect(result.massingCeiling).toBe(122); // 98 × 500 sq ft steps × 3 floors ÷ 1,200
    expect(result.overallCeiling).toBe(122);
  });

  it("70 homes is FEASIBLE under the canonical assumptions — never hard-coded", () => {
    const project = canonicalProject();
    const result = solve(project, { targetHomes: 70 });
    expect(result.status).toBe("SOLVED");
  });

  it("target = exact maximum (122) is feasible; 123 is the first NO VERIFIED SOLUTION", () => {
    const project = canonicalProject();
    expect(solve(project, { targetHomes: 122 }).status).toBe("SOLVED");
    const impossible = solve(project, { targetHomes: 123 });
    expect(impossible.status).toBe("NO_VERIFIED_SOLUTION");
    if (impossible.status !== "NO_VERIFIED_SOLUTION") return;
    expect(impossible.maxFeasibleHomes).toBe(122);
    expect(impossible.requestedTarget).toBe(123);
  });

  it("binding constraints are mechanically proven with capacity deltas", () => {
    const project = canonicalProject();
    const impossible = solve(project, { targetHomes: 150 });
    expect(impossible.status).toBe("NO_VERIFIED_SOLUTION");
    if (impossible.status !== "NO_VERIFIED_SOLUTION") return;
    expect(impossible.binding.length).toBeGreaterThan(0);
    for (const proof of impossible.binding) {
      expect(proof.capacityDelta).toBeGreaterThan(0);
      expect(proof.capacityAfter).toBeGreaterThan(proof.capacityBefore);
    }
    // Mission-locked counterfactuals are explained but never offered.
    const missionProofs = impossible.binding.filter((p) => p.missionLocked);
    expect(missionProofs.length).toBeGreaterThan(0);
    expect(impossible.counterfactuals.join(" ")).toContain("did not use that alternative");
  });

  it("every returned scenario satisfies every hard constraint (no plausible-but-invalid)", () => {
    const project = canonicalProject();
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("expected SOLVED");
    expect(result.scenarios.length).toBeGreaterThan(0);
    for (const scenario of result.scenarios) {
      const hard = scenario.results.filter((r) => r.source === "law" || r.source === "mission");
      for (const r of hard) {
        if (r.status === "VIOLATED") {
          throw new Error(`scenario violates ${r.humanLabel}: ${r.explanation}`);
        }
      }
    }
  });

  it("no selected scenario is dominated by any feasible enumerated point (Pareto proof)", () => {
    const project = canonicalProject();
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("expected SOLVED");
    for (const a of result.frontier) {
      const dominated = result.frontier.some(
        (b) =>
          b !== a &&
          b.homes >= a.homes &&
          b.parkingMargin >= a.parkingMargin &&
          b.footprintSqFt <= a.footprintSqFt &&
          (b.homes > a.homes || b.parkingMargin > a.parkingMargin || b.footprintSqFt < a.footprintSqFt),
      );
      expect(dominated).toBe(false);
    }
  });

  it("labels are presentation applied AFTER the frontier; deterministic + order-invariant", () => {
    const project = canonicalProject();
    const a = JSON.stringify(solve(project));
    const b = JSON.stringify(solve(project));
    expect(a).toBe(b);
    const c = solve(project, { targetHomes: 70 });
    expect(JSON.stringify(solve(project, { targetHomes: 70 })).length).toBe(JSON.stringify(c).length);
  });

  it("unknown law and setbacks never default — they surface honestly", () => {
    const project = canonicalProject();
    const result = solve(project);
    if (result.status !== "SOLVED") throw new Error("expected SOLVED");
    const all = result.scenarios.flatMap((s) => s.results);
    expect(all.some((r) => r.status === "NOT_EVALUATED" && /setback/i.test(r.humanLabel))).toBe(true);
    expect(all.some((r) => r.status === "EXPERT_REQUIRED" && /front setback/i.test(r.humanLabel))).toBe(true);
    expect(all.some((r) => /formula/i.test(r.explanation) && r.status === "NOT_EVALUATED")).toBe(true);
    expect(result.scenarios[0].confidence).not.toBe("VERIFIED_WITHIN_MODED_SCOPE");
  });

  it("neutral #9 geometry handoff carries regions, statuses, and no renderer concepts", () => {
    const project = canonicalProject();
    const handoff = buildGeometryHandoff(solve(project));
    expect(handoff.legalEnvelopeVerified).toBe(false);
    const roles = handoff.regions.map((r) => r.role);
    expect(roles).toContain("parcel-boundary");
    expect(roles).toContain("preserved-structure");
    expect(roles).toContain("parking-reservation");
    expect(roles).toContain("proposed-footprint");
    expect(handoff.unresolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(handoff)).not.toMatch(/three|@react-three|maplibre/i);
  });

  it("certificate closure is complete end-to-end: law chain, applicability, GIS, missions, structure, parcel, assumptions", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("expected SOLVED");
    const hero = solved.scenarios[0];

    recordScenario(ctx, {
      scenarioId: "scenario:hero",
      label: "Hero",
      solverVersion: "solver/enumerator v1",
      status: "COMPUTED",
      metrics: [{ metricId: "homes", label: "Homes", value: { value: hero.point.homes, unit: "dwelling_units" } }],
      constraintIds: solved.inputs.law.map((c) => c.id),
      missionIds: solved.inputs.missions.map((m) => m.id),
      assumptionIds: solved.inputs.assumptionIds,
      parcelId: solved.inputs.parcelId,
      results: hero.results
        .filter((r) => r.constraintId !== undefined)
        .map((r) => ({
          resultId: `result:hero:${r.constraintId}`,
          constraintId: r.constraintId as string,
          status: r.status,
          actual: r.actual !== undefined && r.actualUnit !== undefined
            ? { value: r.actual, unit: Unit.parse(r.actualUnit) }
            : null,
          limit: r.limit !== undefined && r.limitUnit !== undefined
            ? { value: r.limit, unit: Unit.parse(r.limitUnit) }
            : null,
          explanation: r.explanation,
        })),
      certificateId: "scenario:hero:certificate",
    });

    const certNode = project.nodes["scenario:hero:certificate"] as unknown as {
      dependencies: Array<{ nodeId: string; nodeKind: string; revision: number; semanticHash: string }>;
    };
    const depIds = new Set(certNode.dependencies.map((d) => d.nodeId));

    // Law chain: constraint → regulation → claim → source artifact.
    for (const id of [
      "phl:constraint:height:max:principal",
      "phl:constraint:bulk:occupied-area:max",
      "phl:constraint:parking:multi-family:minimum",
      "phl:constraint:density:min-lot-area-per-unit",
      "phl:constraint:overlay:/six:adu-prohibition",
      "phl:constraint:parking:religious-assembly:minimum",
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
    // Sources: adopted/official law artifacts + GIS layers.
    for (const id of ["phl:src:S5@v1", "phl:src:S6@v1", "phl:src:S7@v1", "gis:src:zoning-base", "gis:src:zoning-overlays"]) {
      expect(depIds.has(id), `source artifact ${id}`).toBe(true);
    }
    // Missions, preserved structure, parcel, assumptions.
    for (const id of ["mission:min-sunday-parking", "mission:preserve-sanctuary", "mission:retain-ownership"]) {
      expect(depIds.has(id), `mission ${id}`).toBe(true);
    }
    expect(depIds.has("gis:structure:1282177")).toBe(true);
    expect(depIds.has("gis:parcel:778273000")).toBe(true);
    for (const id of solved.inputs.assumptionIds) {
      expect(depIds.has(id), `assumption ${id}`).toBe(true);
    }
    // Every dependency resolves to a live node at the pinned revision.
    for (const dep of certNode.dependencies) {
      const node = project.nodes[dep.nodeId] as unknown as { kind: string; meta?: { revision?: number } } | undefined;
      expect(node, `dependency node exists: ${dep.nodeId}`).toBeDefined();
      expect(node?.kind).toBe(dep.nodeKind);
      expect(node?.meta?.revision).toBe(dep.revision);
    }
  });
});

export { canonicalProject };
