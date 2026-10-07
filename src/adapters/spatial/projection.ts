/**
 * Deterministic WGS84 <-> local-feet projection for the spatial spike.
 *
 * Local ENU anchored at a named origin: x = feet east, y = feet north.
 * Uses the WGS84 meridian/parallel arc-length series evaluated at the
 * anchor latitude — constants per degree, so the projection is exact enough
 * (< 0.01 ft over the ~520 ft canonical parcel) and fully deterministic.
 * The same constants are duplicated in
 * scripts/generate_forge_spike_massing.py (fixture generator); drift is
 * caught by tests/spatial/scene-adapter.test.ts asserting the fixture's
 * volumes land inside the derived envelopes.
 */

const FT_PER_METER = 3.280839895;

export interface LocalFrame {
  origin: { lon: number; lat: number };
  ftPerDegLon: number;
  ftPerDegLat: number;
}

export function frameAt(lon: number, lat: number): LocalFrame {
  const phi = (lat * Math.PI) / 180;
  const metersPerDegLon =
    111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
  const metersPerDegLat =
    111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  return {
    origin: { lon, lat },
    ftPerDegLon: metersPerDegLon * FT_PER_METER,
    ftPerDegLat: metersPerDegLat * FT_PER_METER,
  };
}

export function toLocal(frame: LocalFrame, lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon - frame.origin.lon) * frame.ftPerDegLon,
    y: (lat - frame.origin.lat) * frame.ftPerDegLat,
  };
}

export function toWgs84(frame: LocalFrame, x: number, y: number): { lon: number; lat: number } {
  return {
    lon: frame.origin.lon + x / frame.ftPerDegLon,
    lat: frame.origin.lat + y / frame.ftPerDegLat,
  };
}
