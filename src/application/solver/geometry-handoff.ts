import type { SolveResult } from "./solve";

/**
 * Neutral solver-geometry handoff for #8/#9 (issue #7). Pure data: WGS84
 * GeoJSON, integers, and a geometry status vocabulary — no renderer, 3D, or
 * engine imports. #9 can visually distinguish verified legal envelope (not
 * asserted here — setbacks are NOT_EVALUATED), assumption-derived planning
 * envelope, preserved regions, parking reservations, and the unresolved
 * boundary via geometryStatus.
 */

export type SolverRegion = {
  regionId: string;
  geojson: unknown; // WGS84 (EPSG:4326) polygon/multipolygon geometry
  areaSqFt: number;
  role:
    | "parcel-boundary"
    | "preserved-structure"
    | "parking-reservation"
    | "proposed-footprint"
    | "planning-envelope-assumption";
  derivedFromIds: string[];
  geometryStatus: "COMPUTED_GEODESIC" | "ASSUMPTION_DERIVED" | "UNRESOLVED_BOUNDARY";
};

export type SolverGeometryHandoff = {
  parcelId: string;
  projectId: string;
  floors: number;
  maxHeightFt: number;
  regions: SolverRegion[];
  /** Setback compliance is NOT asserted: lot-line roles unclassified. */
  legalEnvelopeVerified: false;
  unresolved: string[];
  derivedFromIds: string[];
};

export function buildGeometryHandoff(result: SolveResult): SolverGeometryHandoff {
  if (result.status !== "SOLVED") {
    throw new Error("geometry handoff requires a SOLVED result");
  }
  const { inputs, geometry } = result;
  const best = result.scenarios[0]?.point;
  const regions: SolverRegion[] = [
    {
      regionId: `${inputs.parcelId}:boundary`,
      geojson: inputs.parcelGeojson,
      areaSqFt: Math.round(geometry.parcelAreaSqFt),
      role: "parcel-boundary",
      derivedFromIds: [inputs.parcelId],
      geometryStatus: "COMPUTED_GEODESIC",
    },
  ];
  for (const structure of inputs.structures) {
    if (!structure.preserved) continue;
    regions.push({
      regionId: `${structure.graphId}:preserved`,
      geojson: structure.footprintGeojson,
      areaSqFt: Math.round(
        // recompute deterministically (turf in geometry.ts already validated)
        result.geometry.preservedStructureAreaSqFt /
          Math.max(1, inputs.structures.filter((s) => s.preserved).length),
      ),
      role: "preserved-structure",
      derivedFromIds: [structure.graphId],
      geometryStatus: "COMPUTED_GEODESIC",
    });
  }
  regions.push({
    regionId: `${inputs.parcelId}:parking-reservation`,
    geojson: null, // #9 renders as a labeled area allocation; no fabricated shape
    areaSqFt: Math.round(geometry.parkingLandAreaSqFt),
    role: "parking-reservation",
    derivedFromIds: [
      ...inputs.missions.filter((m) => m.normalized.type === "min-parking").map((m) => m.id),
      "assumption:parking-stall-gross-land-area",
    ],
    geometryStatus: "ASSUMPTION_DERIVED",
  });
  if (best) {
    regions.push({
      regionId: `${inputs.parcelId}:proposed-footprint`,
      geojson: null, // conceptual prism footprint; #9 extrudes floors × height
      areaSqFt: best.footprintSqFt,
      role: "proposed-footprint",
      derivedFromIds: [inputs.parcelId],
      geometryStatus: "ASSUMPTION_DERIVED",
    });
  }
  if (geometry.planningEnvelopeGeojson) {
    regions.push({
      regionId: `${inputs.parcelId}:planning-envelope`,
      geojson: geometry.planningEnvelopeGeojson,
      areaSqFt: Math.round(geometry.planningEnvelopeAreaSqFt),
      role: "planning-envelope-assumption",
      derivedFromIds: ["assumption:planning-envelope-uniform-setback", inputs.parcelId],
      geometryStatus: "ASSUMPTION_DERIVED",
    });
  }

  return {
    parcelId: inputs.parcelId,
    projectId: inputs.projectId,
    floors: best?.floors ?? 0,
    maxHeightFt: Math.round(geometry.heightCeilingFt),
    regions,
    legalEnvelopeVerified: false,
    unresolved: [
      "front/side/rear lot-line roles unclassified — legal setback results are NOT_EVALUATED/EXPERT_REQUIRED",
      "proposed-footprint shape is conceptual (area allocation, not architecture)",
    ],
    derivedFromIds: [...inputs.assumptionIds, inputs.parcelId],
  };
}
