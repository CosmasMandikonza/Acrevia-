/**
 * Server-side spike bootstrap (ADR 0008): canonical benchmark pack in,
 * Development Graph with mission + scenario state out.
 *
 * This module is the spike's stand-in for the real product pipeline
 * (#4 GIS commit -> #5 regulatory compile -> #6 mission -> #7 solver). It
 * is the ONLY place fixture interpretation happens:
 *
 * 1. `mapBenchmarkToProject` maps the canonical pack through domain
 *    commands (ADR 0002/0003 boundary, unchanged).
 * 2. The benchmark adapter does not map GIS structure geometry (rules
 *    only), so this step records the sanctuary footprint + height from the
 *    benchmark's own captured GIS fixture (S8 building_footprints) — with
 *    real claims and source links, exactly as the live GIS commit would.
 * 3. Mission constraints are confirmed through the real command boundary
 *    (USER_DECLARED, hard) — the CANONICAL Calvary mission flow: preserve
 *    sanctuary, keep >= 110 Sunday parking, retain ownership. No invented
 *    height cap.
 * 4. The two scenarios are recorded through `recordScenario` with results
 *    "computed elsewhere" (the sanctioned pre-#7 pattern; the massing
 *    geometry itself lives in the spike fixture, NOT the graph). Both are
 *    HYPOTHETICAL SPIKE FIXTURES — synthetic visual test inputs, never
 *    canonical user decisions or pitch evidence. Setback results are the
 *    honest trusted states (front EXPERT_REQUIRED, side/rear
 *    NOT_EVALUATED) because lot-line roles are not classified yet.
 *
 * A fixed clock keeps the whole bootstrap byte-deterministic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapBenchmarkToProject } from "../benchmarks/map-benchmark";
import {
  confirmMissionConstraint,
  recordClaim,
  recordScenario,
  type CommandContext,
} from "../../commands";
import type { Project } from "../../domain";
import { touchNode } from "../../domain/graph/node";
import { parseMassingFixture } from "./massing-fixture";
import { buildSpatialScene } from "./scene-adapter";

const SPIKE_CLOCK = "2026-10-07T00:00:00.000Z";

export interface SpikeBootstrap {
  project: Project;
  addressHint: { lon: number; lat: number };
  fixtureDir: string;
}

export function bootstrapSpikeProject(fixtureDir: string): SpikeBootstrap {
  const readJson = (rel: string): unknown =>
    JSON.parse(readFileSync(join(fixtureDir, rel), "utf-8"));

  const project = mapBenchmarkToProject({
    fixtureDir,
    actor: "forge-spike-bootstrap",
    now: () => SPIKE_CLOCK,
    projectId: "forge-spike:calvary-memorial",
  });
  const ctx: CommandContext = { project, actor: "forge-spike-bootstrap", now: () => SPIKE_CLOCK };
  const now = () => SPIKE_CLOCK;

  // --- 2. Structure geometry from the benchmark's captured GIS fixture ------
  const structureId = "phl:structure:bin-1282177";
  const footprints = readJson("raw/gis/footprints-parcel-494018.json") as {
    features: Array<{
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: number[][][] };
    }>;
  };
  const feature = footprints.features[0];
  if (!feature) throw new Error("spike bootstrap: footprints fixture has no features");
  const bin = String(feature.properties.bin);
  const approxHgtFt = Number(feature.properties.approx_hgt);

  const footprintClaimId = "phl:claim:structure-footprint-bin-1282177";
  const heightClaimId = "phl:claim:building-height-bin-1282177";
  recordClaim(ctx, {
    id: footprintClaimId,
    kind: "claim",
    subjectNodeId: structureId,
    predicate: "structure-footprint",
    value: { type: "qualitative", text: `PWD building_footprints polygon, BIN ${bin}, 31,272 sq ft` },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["phl:src:S8@v1"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: `building_footprints: {"bin": "${bin}", "square_ft": 31272}`,
    notes: "Spike augmentation: footprint geometry from the benchmark's captured GIS layer (what the live #4 commit records).",
  });
  recordClaim(ctx, {
    id: heightClaimId,
    kind: "claim",
    subjectNodeId: structureId,
    predicate: "building-height",
    value: { type: "quantity", quantity: { value: approxHgtFt, unit: "ft" } },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: ["phl:src:S8@v1"],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: `approx_hgt: ${approxHgtFt}`,
    notes: "Approximate roof height from the city footprints layer.",
  });
  // Footprint geometry rides on the structure node the same way the GIS
  // commit stores it (mapper-precedented direct write at fixture-mapping
  // time, immediately validated by the codec in tests).
  const structureNode = project.nodes[structureId] as unknown as {
    footprint?: unknown;
    attributeClaimIds: string[];
  };
  structureNode.footprint = {
    geojson: feature.geometry,
    crs: "EPSG:4326",
    validity: "unchecked",
    derived: false,
    sourceClaimId: footprintClaimId,
  };
  structureNode.attributeClaimIds.push(footprintClaimId, heightClaimId);
  touchNode(project.nodes[structureId], now());

  // --- 3. Mission constraints (the demo mission for Calvary) ------------------
  confirmMissionConstraint(ctx, {
    id: "phl:mission:preserve-sanctuary",
    kind: "mission-constraint",
    intentText: "The sanctuary stays — worship continues during and after any development.",
    normalized: { type: "preserve-structure", structureId },
    origin: { kind: "USER_DECLARED" },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
  confirmMissionConstraint(ctx, {
    id: "phl:mission:min-parking-110",
    kind: "mission-constraint",
    intentText: "Keep at least 110 Sunday parking stalls on site.",
    normalized: { type: "min-parking", spaces: { value: 110, unit: "spaces" } },
    origin: { kind: "USER_DECLARED" },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
  confirmMissionConstraint(ctx, {
    id: "phl:mission:retain-ownership",
    kind: "mission-constraint",
    intentText: "The church retains ownership of the property.",
    normalized: { type: "retain-ownership" },
    origin: { kind: "USER_DECLARED" },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });

  // --- 4. Scenarios (results computed elsewhere — the sanctioned pre-#7 path)
  const constraintIds = [
    "phl:constraint:height-max",
    "phl:constraint:setback-front",
    "phl:constraint:setback-side",
    "phl:constraint:setback-rear",
    "phl:constraint:occupied-area-max",
    "phl:constraint:parking-multifamily",
  ];
  const missionIds = [
    "phl:mission:preserve-sanctuary",
    "phl:mission:min-parking-110",
    "phl:mission:retain-ownership",
  ];

  recordScenario(ctx, {
    scenarioId: "phl:scenario:homes-24",
    label: "HYPOTHETICAL SPIKE FIXTURE — 24 homes",
    solverVersion: "forge-spike-fixture/0.2 (visual test fixture; solver #7 pending)",
    status: "COMPUTED",
    metrics: [
      { metricId: "units", label: "Homes (fixture)", value: { value: 24, unit: "dwelling_units" } },
      { metricId: "new-height", label: "Fixture height", value: { value: 28, unit: "ft" } },
      { metricId: "occupied", label: "Occupied area", value: { value: 39, unit: "percent" } },
    ],
    constraintIds,
    missionIds,
    assumptionIds: [],
    parcelId: "phl:parcel:778273000",
    results: [
      {
        resultId: "phl:result:homes-24:height",
        constraintId: "phl:constraint:height-max",
        status: "SATISFIED",
        actual: { value: 28, unit: "ft" },
        limit: { value: 38, unit: "ft" },
        explanation: "New massing tops at 28 ft, inside the 38 ft RM-1 cap.",
      },
      {
        resultId: "phl:result:homes-24:setback-front",
        constraintId: "phl:constraint:setback-front",
        status: "EXPERT_REQUIRED",
        explanation:
          "Front setback is contextual and lot-line roles are not classified in trusted state — a professional must resolve the blockface before compliance can be evaluated.",
      },
      {
        resultId: "phl:result:homes-24:setback-side",
        constraintId: "phl:constraint:setback-side",
        status: "NOT_EVALUATED",
        explanation:
          "Side lot-line roles are not classified in trusted state — compliance against the 5 ft minimum is NOT_EVALUATED (the spike's envelope polygon is assumption-derived).",
      },
      {
        resultId: "phl:result:homes-24:setback-rear",
        constraintId: "phl:constraint:setback-rear",
        status: "NOT_EVALUATED",
        explanation:
          "Rear lot-line role is not classified in trusted state — compliance against the 9 ft minimum is NOT_EVALUATED (the spike's envelope polygon is assumption-derived).",
      },
      {
        resultId: "phl:result:homes-24:occupied",
        constraintId: "phl:constraint:occupied-area-max",
        status: "SATISFIED",
        actual: { value: 39, unit: "percent" },
        limit: { value: 75, unit: "percent" },
        explanation: "Sanctuary + new footprint occupy 39% of the parcel.",
      },
      {
        resultId: "phl:result:homes-24:parking",
        constraintId: "phl:constraint:parking-multifamily",
        status: "SATISFIED",
        actual: { value: 24, unit: "spaces" },
        limit: { value: 0, unit: "spaces" },
        explanation:
          "Zoning requires 0 spaces for multi-family (sourced). The canonical mission's 110-stall reservation is real but NOT designed by this spike — parking geometry is UNRESOLVED here.",
      },
    ],
  });

  recordScenario(ctx, {
    scenarioId: "phl:scenario:optimistic-tower",
    label: "HYPOTHETICAL SPIKE FIXTURE — optimistic six-story mass",
    solverVersion: "forge-spike-fixture/0.2 (visual test fixture; solver #7 pending)",
    status: "REFUSED",
    metrics: [
      { metricId: "units", label: "Homes (fixture claim)", value: { value: 96, unit: "dwelling_units" } },
      { metricId: "new-height", label: "Fixture height", value: { value: 45, unit: "ft" } },
    ],
    constraintIds,
    missionIds,
    assumptionIds: [],
    parcelId: "phl:parcel:778273000",
    results: [
      {
        resultId: "phl:result:tower:height",
        constraintId: "phl:constraint:height-max",
        status: "VIOLATED",
        actual: { value: 45, unit: "ft" },
        limit: { value: 38, unit: "ft" },
        explanation: "45 ft mass exceeds the 38 ft RM-1 maximum — refused.",
      },
      {
        resultId: "phl:result:tower:setback-front",
        constraintId: "phl:constraint:setback-front",
        status: "EXPERT_REQUIRED",
        explanation: "Contextual front setback needs professional resolution regardless of the refusal.",
      },
      {
        resultId: "phl:result:tower:setback-side",
        constraintId: "phl:constraint:setback-side",
        status: "UNKNOWN",
        explanation: "Not evaluated: the scenario was refused on height.",
      },
      {
        resultId: "phl:result:tower:setback-rear",
        constraintId: "phl:constraint:setback-rear",
        status: "UNKNOWN",
        explanation: "Not evaluated: the scenario was refused on height.",
      },
      {
        resultId: "phl:result:tower:occupied",
        constraintId: "phl:constraint:occupied-area-max",
        status: "UNKNOWN",
        explanation: "Not evaluated: the scenario was refused on height.",
      },
      {
        resultId: "phl:result:tower:parking",
        constraintId: "phl:constraint:parking-multifamily",
        status: "UNKNOWN",
        explanation: "Not evaluated: the scenario was refused on height.",
      },
    ],
  });

  // --- Address hint from the benchmark's captured Census geocode --------------
  const census = readJson("raw/gis/census-7200-roosevelt-blvd-philadelphia-pa-19149.json") as {
    result?: {
      addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }>;
    };
  };
  const match = census.result?.addressMatches?.[0]?.coordinates;
  if (!match || typeof match.x !== "number" || typeof match.y !== "number") {
    throw new Error("spike bootstrap: no census geocode hint in fixture");
  }

  return { project, addressHint: { lon: match.x, lat: match.y }, fixtureDir };
}

/**
 * One-call spike pipeline: benchmark -> graph -> SpatialSceneModel, with the
 * derivation timed. Timing is metadata for the HUD only — the model itself
 * stays byte-deterministic.
 */
export function buildSpikeScene(fixtureDir: string): { model: ReturnType<typeof buildSpatialScene>; buildMs: number } {
  const t0 = Date.now();
  const boot = bootstrapSpikeProject(fixtureDir);
  const model = buildSpatialScene({
    project: boot.project,
    massing: loadMassingFixture(),
    addressHint: boot.addressHint,
    title: "Calvary Memorial Church",
    subtitle: "7200-50 E Roosevelt Blvd · RM-1 · Philadelphia, PA",
  });
  return { model, buildMs: Date.now() - t0 };
}

export function loadMassingFixture() {
  // Repo-root relative: vitest and `next dev`/`next start` both run from
  // the project root. (import.meta.url is an http URL under jsdom.)
  return parseMassingFixture(
    JSON.parse(
      readFileSync(
        join(process.cwd(), "src", "adapters", "spatial", "fixtures", "forge-spike-massing.json"),
        "utf-8",
      ),
    ),
  );
}

export { SPIKE_CLOCK };
