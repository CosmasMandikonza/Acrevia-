import booleanValid from "@turf/boolean-valid";
import area from "@turf/area";
import centroid from "@turf/centroid";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import distance from "@turf/distance";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { Wgs84Geometry, ProviderFailure } from "./capabilities";

/**
 * Geometry discipline (issue #4). Canonical CRS is EPSG:4326 / RFC 7946
 * [lon, lat]; anything else is a typed UNSUPPORTED_CRS failure — never a
 * silent reprojection. Polygon/MultiPolygon are preserved; no silent repair;
 * validity is checked and recorded; recorded area is never recomputed over.
 */

export type GeometryValidity = "valid" | "invalid" | "unchecked";

export function toFeature(geometry: Wgs84Geometry): Feature<Polygon | MultiPolygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: geometry as unknown as Polygon | MultiPolygon,
  };
}

/**
 * Guard a provider geometry object. `crs` may be provided when the payload
 * declares one (GeoJSON proper does not). Non-4326 declarations fail loudly.
 */
export function ensureWgs84(
  providerId: string,
  geometry: unknown,
  declaredCrs?: string,
): Wgs84Geometry {
  if (declaredCrs && !declaredCrs.toUpperCase().includes("4326")) {
    throw new ProviderFailure(
      providerId,
      "UNSUPPORTED_CRS",
      `provider declared CRS ${declaredCrs}; Acrevia #4 supports EPSG:4326 only and will not silently reproject`,
    );
  }
  const parsed = Wgs84Geometry.safeParse(geometry);
  if (!parsed.success) {
    throw new ProviderFailure(
      providerId,
      "MALFORMED_PAYLOAD",
      `geometry is not a Polygon/MultiPolygon: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  return parsed.data;
}

function rings(geometry: Wgs84Geometry): number[][][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as number[][][])
    : (geometry.coordinates as number[][][][]).flat();
}

/** Structural + topological validation. Returns a recorded verdict; no repair. */
export function checkValidity(geometry: Wgs84Geometry): { validity: GeometryValidity; problems: string[] } {
  const problems: string[] = [];
  for (const ring of rings(geometry)) {
    if (ring.length < 4) problems.push(`ring has ${ring.length} positions; a closed ring needs at least 4`);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      problems.push("ring is not closed (first position != last position)");
    }
    for (const position of ring) {
      const [lon, lat] = position;
      if (
        typeof lon !== "number" || typeof lat !== "number" ||
        lon < -180 || lon > 180 || lat < -90 || lat > 90
      ) {
        problems.push(`position out of range: [${lon}, ${lat}]`);
        break;
      }
    }
  }
  if (problems.length === 0) {
    const valid = booleanValid(toFeature(geometry));
    if (!valid) problems.push("self-intersecting or topologically invalid (turf boolean-valid)");
  }
  return problems.length === 0 ? { validity: "valid", problems: [] } : { validity: "invalid", problems };
}

/** Geodesic computed area in sq ft (WGS84 ellipsoid via turf). */
export function computedAreaSqFt(geometry: Wgs84Geometry): number {
  return area(toFeature(geometry)) * 10.7639;
}

export function centroidOf(geometry: Wgs84Geometry): [number, number] {
  const point = centroid(toFeature(geometry));
  return [point.geometry.coordinates[0], point.geometry.coordinates[1]];
}

export function pointInGeometry(point: [number, number], geometry: Wgs84Geometry): boolean {
  return booleanPointInPolygon(point, toFeature(geometry));
}

export function distanceMeters(a: [number, number], b: [number, number]): number {
  return distance(a as never, b as never, { units: "meters" });
}
