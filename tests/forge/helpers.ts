/**
 * Shared Forge test fixtures (issue #9). Mirrors the canonical solver
 * benchmark builder (tests/solver/canonical.test.ts) — the SAME real
 * geometry, law, and mission state — plus the building-height claim the
 * scene adapter reads. No spike fixture is ever loaded here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contextFor } from "../domain/helpers";
import type { Project } from "../../src/domain/graph/project";
import { seedSolverAssumptions } from "../../src/application/solver/assumptions";
import { solve } from "../../src/application/solver/solve";
import { recordSolverScenarios } from "../../src/application/solver/record";
import {
  confirmMissionConstraint,
  addSourceArtifact,
  recordClaim,
  upsertRegulation,
  materializeConstraint,
} from "../../src/commands";

export const PARCEL_GEOJSON = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia/raw/gis/pwd-parcel-brt-778273000.geojson"),
    "utf8",
  ),
).features[0].geometry;

export const SANCTUARY_FEATURE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia/raw/gis/footprints-parcel-494018.json"),
    "utf8",
  ),
).features[0];

export const ADDRESS_HINT = (() => {
  const census = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia/raw/gis/census-7200-roosevelt-blvd-philadelphia-pa-19149.json"),
      "utf8",
    ),
  );
  const match = census.result?.addressMatches?.[0]?.coordinates;
  if (typeof match?.x !== "number" || typeof match?.y !== "number") {
    throw new Error("forge test fixture: no census geocode hint");
  }
  return { lon: match.x, lat: match.y };
})();

const NOW = "2026-10-09T12:00:00.000Z";

export function canonicalForgeProject(parkingSpaces = 110): Project {
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
    footprint: { geojson: SANCTUARY_FEATURE.geometry, crs: "EPSG:4326", validity: "valid", derived: false },
    attributeClaimIds: [],
    meta: { revision: 1, semanticHash: "s", createdAt: NOW, lastModifiedAt: NOW },
  } as never;

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

  // Building height claim from the captured footprints layer (approx_hgt).
  recordClaim(ctx, {
    id: "phl:claim:building-height:bin-1282177",
    kind: "claim",
    subjectNodeId: sanctuaryId,
    predicate: "building-height",
    value: { type: "quantity", quantity: { value: Number(SANCTUARY_FEATURE.properties.approx_hgt), unit: "ft" } },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["gis:src:zoning-base"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: `approx_hgt: ${SANCTUARY_FEATURE.properties.approx_hgt}`,
  });

  const law: Array<{
    artifactId: string;
    key: string;
    claimId: string;
    predicate: Parameters<typeof recordClaim>[1]["predicate"];
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
      quote: 'Religious Assembly — "1/10 seats or 1/1,000 sq. ft., whichever is greater"',
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

  confirmMissionConstraint(ctx, {
    id: "mission:min-sunday-parking",
    kind: "mission-constraint",
    intentText: `Keep at least ${parkingSpaces} Sunday parking spaces.`,
    normalized: { type: "min-parking", spaces: { value: parkingSpaces, unit: "spaces" } },
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

/** Solve + record on a fresh copy of the canonical project. */
export function canonicalSolveAndRecord(parkingSpaces = 110, targetHomes?: number) {
  const project = canonicalForgeProject(parkingSpaces);
  const ctx = contextFor(project);
  const result = solve(project, targetHomes === undefined ? {} : { targetHomes });
  const recorded = result.status === "SOLVED" ? recordSolverScenarios(ctx, result) : [];
  return { project, ctx, result, recorded };
}
