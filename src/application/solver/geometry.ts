import area from "@turf/area";
import buffer from "@turf/buffer";
import { polygon as turfPolygon } from "@turf/helpers";
import type { SolverInputs } from "./inputs";

/**
 * Deterministic site geometry (issue #7). All areas are computed geodesic
 * (turf, WGS84, sq ft). The occupied-area ceiling (Philadelphia Code
 * §14-202(12): aggregate top-view area of structures above grade) is kept
 * strictly separate from SITE LAND CONSUMPTION (surface parking consumes
 * land but is NOT occupied building area). Legal setback compliance is NOT
 * computed here — lot-line roles are unclassified, so setbacks stay
 * NOT_EVALUATED; the separately-labeled planning envelope is an
 * assumption-derived massing concept, never verified legal compliance.
 */

const SQFT_PER_M2 = 10.7639;

export type SiteGeometry = {
  parcelAreaSqFt: number;
  preservedStructureAreaSqFt: number;
  occupiedAreaCeilingPct: number; // 0..100 (law, from occupied-area constraint)
  occupiedAreaCeilingSqFt: number;
  heightCeilingFt: number; // law (mission max-height can lower it; see floors computation)
  maxStoriesCap: number; // mission max-stories (law height also caps floors)
  floorsCap: number; // min(floor(heightCeiling/story), mission stories cap)
  parkingStallsRequired: number; // max(law fixed requirement, mission min-parking)
  parkingLandAreaSqFt: number; // stalls × stall-gross assumption
  developableFootprintMaxSqFt: number; // min(physical land room, occupied-area room)
  physicalLandRoomSqFt: number;
  occupiedRoomSqFt: number;
  planningEnvelopeAreaSqFt: number; // assumption-derived, separately labeled
  planningEnvelopeGeojson: unknown;
  warnings: string[];
};

function toFeature(geometry: unknown): GeoJSON.Feature {
  return { type: "Feature", properties: {}, geometry: geometry as GeoJSON.Geometry };
}

function geodesicAreaSqFt(geometry: unknown): number {
  return area(toFeature(geometry)) * SQFT_PER_M2;
}

function lawValue(
  inputs: SolverInputs,
  kind: string,
  pick: (constraint: SolverInputs["law"][number]) => number,
): number | null {
  const matches = inputs.law.filter((constraint) => constraint.constraintKind === kind);
  if (matches.length === 0) return null;
  let best: number | null = null;
  for (const constraint of matches) {
    const value = pick(constraint);
    if (value === null || !Number.isFinite(value)) continue;
    if (best === null || value < best) best = value; // strictest cap wins
  }
  return best;
}

export function computeSiteGeometry(inputs: SolverInputs): SiteGeometry {
  const warnings: string[] = [];
  const parcelAreaSqFt = geodesicAreaSqFt(inputs.parcelGeojson);
  if (!Number.isFinite(parcelAreaSqFt) || parcelAreaSqFt <= 0) {
    throw new Error("parcel geodesic area is not a positive finite number");
  }

  const preservedStructureAreaSqFt = inputs.structures
    .filter((structure) => structure.preserved)
    .reduce((sum, structure) => {
      const computed = geodesicAreaSqFt(structure.footprintGeojson);
      if (!Number.isFinite(computed) || computed <= 0) {
        throw new Error(`preserved structure ${structure.graphId} has invalid computed area`);
      }
      return sum + computed;
    }, 0);

  const occupiedAreaCeilingPct = lawValue(inputs, "occupied-area", (c) =>
    c.constraintKind === "occupied-area" ? c.byLotType.intermediate ?? Number.NaN : Number.NaN,
  );
  if (occupiedAreaCeilingPct === null) {
    throw new Error("occupied-area ceiling not found in executable law");
  }
  const occupiedAreaCeilingSqFt = (occupiedAreaCeilingPct / 100) * parcelAreaSqFt;

  const heightCeilingLaw = lawValue(inputs, "height", (c) =>
    c.constraintKind === "height" ? c.limit?.value ?? Number.NaN : Number.NaN,
  );
  if (heightCeilingLaw === null) {
    throw new Error("height ceiling not found in executable law");
  }

  let heightCeilingFt = heightCeilingLaw;
  let maxStoriesCap = Number.POSITIVE_INFINITY;
  for (const mission of inputs.missions) {
    if (mission.normalized.type === "max-height" && Number.isFinite(mission.normalized.limit?.value)) {
      heightCeilingFt = Math.min(heightCeilingFt, mission.normalized.limit.value);
    }
    if (mission.normalized.type === "max-stories" && Number.isFinite(mission.normalized.stories?.value)) {
      maxStoriesCap = Math.min(maxStoriesCap, mission.normalized.stories.value);
    }
  }
  const floorsByHeight = Math.floor(heightCeilingFt / inputs.assumptions.storyFloorToFloorFt);
  const floorsCap = Math.max(0, Math.min(floorsByHeight, Number.isFinite(maxStoriesCap) ? maxStoriesCap : floorsByHeight));

  // Parking: law requirement (fixed multifamily count) vs mission minimum.
  let lawParkingSpaces = 0;
  for (const constraint of inputs.law) {
    if (
      constraint.constraintKind === "parking-requirement" &&
      constraint.requirement.type === "fixed" &&
      constraint.use === "multi-family"
    ) {
      lawParkingSpaces = Math.max(lawParkingSpaces, constraint.requirement.spaces.value);
    }
  }
  let missionParking = 0;
  for (const mission of inputs.missions) {
    if (mission.normalized.type === "min-parking" && Number.isFinite(mission.normalized.spaces?.value)) {
      missionParking = Math.max(missionParking, mission.normalized.spaces.value);
    }
  }
  const parkingStallsRequired = Math.max(lawParkingSpaces, missionParking);
  const parkingLandAreaSqFt = parkingStallsRequired * inputs.assumptions.parkingStallGrossLandArea;

  const physicalLandRoomSqFt = Math.max(0, parcelAreaSqFt - preservedStructureAreaSqFt - parkingLandAreaSqFt);
  const occupiedRoomSqFt = Math.max(0, occupiedAreaCeilingSqFt - preservedStructureAreaSqFt);
  const developableFootprintMaxSqFt = Math.min(physicalLandRoomSqFt, occupiedRoomSqFt);

  // Planning envelope: uniform assumed setback buffered inward on the REAL
  // polygon (never its bounding rectangle), explicitly assumption-derived.
  const setbackFt = inputs.assumptions.planningEnvelopeSetbackFt;
  let planningEnvelopeGeojson: unknown = null;
  let planningEnvelopeAreaSqFt = 0;
  try {
    const buffered = buffer(toFeature(inputs.parcelGeojson), -setbackFt, { units: "feet" });
    if (buffered && buffered.geometry) {
      planningEnvelopeGeojson = buffered.geometry;
      planningEnvelopeAreaSqFt = geodesicAreaSqFt(buffered.geometry);
    }
  } catch {
    warnings.push("planning-envelope buffer failed; envelope unavailable");
  }

  return {
    parcelAreaSqFt,
    preservedStructureAreaSqFt,
    occupiedAreaCeilingPct,
    occupiedAreaCeilingSqFt,
    heightCeilingFt,
    maxStoriesCap: Number.isFinite(maxStoriesCap) ? maxStoriesCap : floorsByHeight,
    floorsCap,
    parkingStallsRequired,
    parkingLandAreaSqFt,
    developableFootprintMaxSqFt,
    physicalLandRoomSqFt,
    occupiedRoomSqFt,
    planningEnvelopeAreaSqFt,
    planningEnvelopeGeojson,
    warnings,
  };
}

/** Legal density capacity from the RM-1 tiered lot-area-per-unit formula. */
export function legalDensityCapacity(inputs: SolverInputs, parcelAreaSqFt: number): number | null {
  const density = inputs.law.find((constraint) => constraint.constraintKind === "density");
  if (!density || density.spec.type !== "tiered-min-lot-area-per-unit") return null;
  // Single-tier fallback; canonical RM-1 uses tiers [{1440,360},{1440,480}]
  // meaning 360/unit for the first 1,440 sq ft, 480/unit above.
  const first = density.spec.tiers[0];
  if (!first) return null;
  const firstHomes = Math.floor(first.firstSqFt / first.perUnit);
  const remainder = Math.max(0, parcelAreaSqFt - first.firstSqFt);
  const above = density.spec.tiers[1] ?? first;
  const aboveHomes = Math.floor(remainder / above.perUnit);
  return firstHomes + aboveHomes;
}

export { turfPolygon };
