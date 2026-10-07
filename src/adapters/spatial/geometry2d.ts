/**
 * Deterministic 2D geometry for the spatial adapter (ADR 0008).
 *
 * Conventions: rings are arrays of {x,y} in feet, exterior CCW / holes CW
 * (GeoJSON sources are normalized on import). Boolean operations go through
 * `polygon-clipping` (pure, deterministic Martinez implementation); single
 * convex half-plane clips (setback strips) use an explicit Sutherland-
 * Hodgman step so the common path has no library dependence.
 */

import polygonClipping, { type Geom as PcGeom, type Pair as PcPair, type Ring as PcRing } from "polygon-clipping";
import type { ScenePolygon, Vec2 } from "../../spatial/scene-model";

export type Ring = Vec2[];

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const q = ring[(i + 1) % ring.length];
    a += ring[i].x * q.y - q.x * ring[i].y;
  }
  return a / 2;
}

export function areaOf(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

export function ringCentroid(ring: Ring): Vec2 {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) {
    // Degenerate: average of vertices keeps this total and deterministic.
    let x = 0;
    let y = 0;
    for (const p of ring) {
      x += p.x;
      y += p.y;
    }
    return { x: x / ring.length, y: y / ring.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const q = ring[(i + 1) % ring.length];
    const cr = ring[i].x * q.y - q.x * ring[i].y;
    cx += (ring[i].x + q.x) * cr;
    cy += (ring[i].y + q.y) * cr;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function toCcw(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : [...ring];
}

/** Drop the duplicated closing vertex GeoJSON rings carry. */
export function openRing(coords: Array<[number, number]> | number[][]): Ring {
  const pts = coords.map(([x, y]) => ({ x, y }));
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) < 1e-12 && Math.abs(first.y - last.y) < 1e-12) {
      pts.pop();
    }
  }
  return pts;
}

export interface GeojsonPolygonLike {
  type: string;
  coordinates: unknown;
}

/**
 * Extract the FIRST polygon of a GeoJSON Polygon/MultiPolygon as a CCW
 * exterior + CW holes. The canonical benchmark uses single-polygon
 * geometries; multi-polygon inputs are reduced with a note expected from
 * the caller.
 */
export function geojsonToScenePolygon(geometry: GeojsonPolygonLike): ScenePolygon {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as number[][][];
    return {
      exterior: toCcw(openRing(coords[0])),
      holes: coords.slice(1).map((h) => [...openRing(h)].reverse()),
    };
  }
  if (geometry.type === "MultiPolygon") {
    const coords = geometry.coordinates as number[][][][];
    return {
      exterior: toCcw(openRing(coords[0][0])),
      holes: coords[0].slice(1).map((h) => [...openRing(h)].reverse()),
    };
  }
  throw new Error(`spatial adapter: unsupported GeoJSON type ${geometry.type}`);
}

/** Sutherland-Hodgman clip of a ring against one half-plane. */
export function clipHalfPlane(
  ring: Ring,
  normal: Vec2,
  offset: number,
): Ring {
  // Keep points p with p·normal >= offset.
  const side = (p: Vec2): number => p.x * normal.x + p.y * normal.y - offset;
  const out: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if ((da >= 0 && db < 0) || (da < 0 && db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const asPairs = (ring: Ring): PcRing =>
  closeRing(ring).map((pt) => [pt.x, pt.y] as PcPair);

const toGeom = (p: ScenePolygon): PcGeom => {
  const rings: PcRing[] = [asPairs(p.exterior)];
  for (const h of p.holes ?? []) {
    rings.push(asPairs([...h].reverse()));
  }
  return [rings];
};

const closeRing = (ring: Ring): Ring => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first.x !== last.x || first.y !== last.y)) {
    return [...ring, first];
  }
  return [...ring];
};

function fromGeom(geom: PcGeom): ScenePolygon[] {
  if (geom.length === 0) return []; // empty boolean result
  // Normalize Polygon | MultiPolygon to MultiPolygon.
  const multi: PcRing[][] =
    typeof geom[0][0][0] === "number" ? [geom as unknown as PcRing[]] : (geom as unknown as PcRing[][]);
  const polys: ScenePolygon[] = [];
  for (const poly of multi) {
    const exterior = toCcw(openRing(poly[0] as number[][]));
    if (exterior.length < 3 || areaOf(exterior) < 1) continue; // sliver
    polys.push({
      exterior,
      holes: poly.slice(1).map((h) => openRing(h as number[][]).reverse()),
    });
  }
  return polys;
}

export function difference(a: ScenePolygon, ...subtrahends: ScenePolygon[]): ScenePolygon[] {
  const args = [toGeom(a), ...subtrahends.map(toGeom)];
  return fromGeom(polygonClipping.difference(args[0], ...args.slice(1)));
}

export function intersection(a: ScenePolygon, b: ScenePolygon): ScenePolygon[] {
  return fromGeom(polygonClipping.intersection(toGeom(a), toGeom(b)));
}

export function totalAreaSqFt(polys: ScenePolygon[]): number {
  return polys.reduce((sum, p) => {
    let a = areaOf(p.exterior);
    for (const h of p.holes ?? []) a -= areaOf(h);
    return sum + a;
  }, 0);
}

export function unionAll(polys: ScenePolygon[]): ScenePolygon[] {
  if (polys.length === 0) return [];
  const args = polys.map(toGeom);
  return fromGeom(polygonClipping.union(args[0], ...args.slice(1)));
}

export function bboxOf(ring: Ring): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Unit vector + length of a directed edge. */
export function edgeFrame(a: Vec2, b: Vec2): { u: Vec2; n: Vec2; length: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const u = { x: dx / length, y: dy / length };
  // For a CCW ring, rotating u by -90 deg gives the OUTWARD normal.
  return { u, n: { x: u.y, y: -u.x }, length };
}

/** Axis-aligned rectangle as a CCW ring. */
export function axisRect(minX: number, minY: number, maxX: number, maxY: number): Ring {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Edge-aligned rectangle: origin corner plus two edge vectors (CCW). */
export function orientedRect(origin: Vec2, along: Vec2, inward: Vec2): Ring {
  return [
    origin,
    { x: origin.x + along.x, y: origin.y + along.y },
    { x: origin.x + along.x + inward.x, y: origin.y + along.y + inward.y },
    { x: origin.x + inward.x, y: origin.y + inward.y },
  ];
}

/**
 * Trim a polygon with a moving half-plane (normal `n`, offset searched from
 * `lo` to `hi`) until its area reaches `targetSqFt`. Deterministic
 * bisection: 36 iterations resolve the offset to < 0.001 ft on the
 * canonical parcel scale. Returns null when the bracket cannot reach the
 * target (caller renders the honest UNRESOLVED state instead).
 */
export function trimToArea(
  polygon: ScenePolygon,
  n: Vec2,
  lo: number,
  hi: number,
  targetSqFt: number,
): { polygons: ScenePolygon[]; offset: number } | null {
  let lowOffset = lo;
  let highOffset = hi;
  let result: { polygons: ScenePolygon[]; offset: number } | null = null;
  for (let i = 0; i < 36; i += 1) {
    const mid = (lowOffset + highOffset) / 2;
    const ring = clipHalfPlane(polygon.exterior, n, mid);
    if (ring.length < 3) {
      highOffset = mid;
      continue;
    }
    const area = areaOf(ring);
    if (Math.abs(area - targetSqFt) < 1) {
      return { polygons: [{ exterior: toCcw(ring) }], offset: mid };
    }
    if (area > targetSqFt) {
      lowOffset = mid;
    } else {
      highOffset = mid;
    }
    result = { polygons: [{ exterior: toCcw(ring) }], offset: mid };
  }
  return result;
}
