/**
 * Deterministic conceptual placement for Forge (issue #9).
 *
 * #7 provides AREA truth, not architecture: `proposed-footprint` and
 * `parking-reservation` arrive as null geometry plus exact square-foot
 * budgets. This module attempts to construct CONCEPTUAL spatial layouts
 * for those budgets — frontage-aligned bars for the building, edge-aligned
 * multi-bay fields for parking — under one law:
 *
 *   no randomness, no wall-clock, no floating sweeps;
 *   same state in → byte-identical placement out;
 *   every emitted polygon is MECHANICALLY VALIDATED (inside the allowed
 *   planning region, clear of preserved structures, exact aggregate area,
 *   finite coordinates, height under the cap);
 *   anything that cannot be proven is UNRESOLVED — never a plausible shape.
 *
 * All output is ASSUMPTION_DERIVED conceptual massing. Nothing here is an
 * architectural design, a site plan of record, or legal parking approval.
 */

import type { ScenePolygon, Vec2 } from "../../spatial/scene-model";
import {
  areaOf,
  bboxOf,
  difference,
  intersection,
  orientedRect,
  totalAreaSqFt,
  trimToArea,
} from "./geometry2d";

/**
 * Deterministic snap-rounding for chained boolean geometry. Consecutive
 * clip/difference operations accumulate floating error that can make
 * polygon-clipping's Martinez sweep fail to close an output ring. Rounding
 * every vertex to 1e-4 ft (≈ 0.0012 in) BEFORE each boolean op is fully
 * deterministic and removes the degeneracies; ring-completion failures that
 * still occur degrade toward the HONEST direction (no overlap / no fit →
 * UNRESOLVED), never toward a fabricated geometry.
 */
const SNAP_FT = 1e-4;

function snapRing(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const x = Math.round(p.x / SNAP_FT) * SNAP_FT;
    const y = Math.round(p.y / SNAP_FT) * SNAP_FT;
    const last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.x === last.x && first.y === last.y) out.pop();
    else break;
  }
  return out;
}

export function snapPolygon(p: ScenePolygon): ScenePolygon {
  return {
    exterior: snapRing(p.exterior),
    holes: (p.holes ?? []).map(snapRing),
  };
}

export function safeIntersection(a: ScenePolygon, b: ScenePolygon): ScenePolygon[] {
  try {
    return intersection(snapPolygon(a), snapPolygon(b));
  } catch {
    return [];
  }
}

export function safeDifference(a: ScenePolygon, b: ScenePolygon): ScenePolygon[] {
  try {
    return difference(snapPolygon(a), snapPolygon(b));
  } catch {
    return [a]; // conservative: keep the un-subtracted input
  }
}

/** Ray-cast point-in-ring test (holes handled by the caller). */
function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Cheap necessary condition for "rect ⊆ polygon": every corner inside the
 * exterior ring and outside every hole. Concave edges can still cut a side,
 * so the exact boolean check follows — but only for corner-plausible
 * candidates, which prunes the overwhelming majority on complex parcels.
 */
function cornersInside(rect: ScenePolygon, polygon: ScenePolygon): boolean {
  const ring = rect.exterior;
  for (const corner of ring) {
    if (!pointInRing(corner, polygon.exterior)) return false;
    for (const hole of polygon.holes ?? []) {
      if (pointInRing(corner, hole)) return false;
    }
  }
  return true;
}

/** Conceptual double-loaded-corridor bar depths tried in fixed order. */
export const BAR_DEPTHS_FT = [72, 56, 44, 32];

export const STALL = { widthFt: 9, depthFt: 18, aisleFt: 24 } as const;

/** Parking bay block shapes: rows of stalls sharing drive aisles. */
const BAY_ROWS: { rows: number; depthFt: number }[] = [
  { rows: 2, depthFt: 2 * STALL.depthFt + STALL.aisleFt },
  { rows: 1, depthFt: STALL.depthFt + STALL.aisleFt },
  { rows: 3, depthFt: 3 * STALL.depthFt + 2 * STALL.aisleFt },
  { rows: 4, depthFt: 4 * STALL.depthFt + 3 * STALL.aisleFt },
];

const SWEEP_STEP_FT = 12;
const MAX_PARKING_FIELDS = 8;
/**
 * Explicit candidate bound for the parking sweep. Exceeding it is a DESIGNED
 * honest refusal ("refusing to guess"), not a truncated optimum — the same
 * discipline as the solver's MAX_ENUM_POINTS. Deterministic by construction
 * (fixed iteration order, fixed bound).
 */
const MAX_PARKING_FIT_CHECKS = 6_000;
const AREA_TOLERANCE_SQFT = 1;

export interface PlacedPiece {
  polygon: ScenePolygon;
  areaSqFt: number;
  label: string;
}

export interface MassingPlacement {
  status: "PLACED" | "UNRESOLVED";
  pieces: PlacedPiece[];
  strategy: string;
  reasons: string[];
}

export interface ParkingFieldPlan {
  polygon: ScenePolygon;
  areaSqFt: number;
  stalls: number;
  rows: number;
  perRow: number;
}

export interface ParkingPlan {
  status: "PLACED" | "UNRESOLVED";
  requiredStalls: number;
  placedStalls: number;
  fields: ParkingFieldPlan[];
  reasons: string[];
}

export interface PlacementRegion {
  /** Allowed planning region (mission envelope with preserved structures removed). */
  envelope: ScenePolygon[];
  /** Preserved structures — massing and parking may never touch these. */
  sanctuary: ScenePolygon[];
}

export interface MassingPlacementInput extends PlacementRegion {
  requiredAreaSqFt: number;
  /** Extrusion height of the conceptual mass (floors × floor-to-floor). */
  heightFt: number;
  heightCapFt: number;
  /** Frontage anchor point and OUTWARD normal (site front line). */
  front: { point: Vec2; outward: Vec2 };
}

function finitePolygon(polygon: ScenePolygon): boolean {
  const ring = polygon.exterior;
  if (ring.length < 3) return false;
  return ring.every(
    (pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y),
  );
}

function areaInside(piece: ScenePolygon, region: ScenePolygon[]): number {
  let sum = 0;
  for (const part of region) {
    for (const overlap of safeIntersection(piece, part)) {
      sum += totalAreaSqFt([overlap]);
    }
  }
  return sum;
}

function overlapArea(piece: ScenePolygon, others: ScenePolygon[]): number {
  return areaInside(piece, others);
}

/**
 * Mechanical validation shared by every placement: finite rings, positive
 * area, fully inside the allowed region, clear of every preserved
 * structure, exact aggregate area, height under the cap. Returns the list
 * of violations (empty = valid).
 */
export function validatePlacement(
  pieces: PlacedPiece[],
  region: PlacementRegion,
  requiredAreaSqFt: number,
  heightFt: number,
  heightCapFt: number,
): string[] {
  const reasons: string[] = [];
  for (const piece of pieces) {
    if (!finitePolygon(piece.polygon)) {
      reasons.push("a placement polygon has non-finite or degenerate geometry");
      return reasons;
    }
    if (piece.areaSqFt < 1) {
      reasons.push("a placement polygon has non-positive area");
      return reasons;
    }
    const inside = areaInside(piece.polygon, region.envelope);
    if (inside < piece.areaSqFt - AREA_TOLERANCE_SQFT) {
      reasons.push(
        `a placement polygon extends outside the allowed planning region (${inside.toFixed(0)} of ${piece.areaSqFt.toFixed(0)} sq ft inside)`,
      );
      return reasons;
    }
    if (overlapArea(piece.polygon, region.sanctuary) > AREA_TOLERANCE_SQFT) {
      reasons.push("a placement polygon overlaps a preserved structure");
      return reasons;
    }
  }
  const total = pieces.reduce((sum, p) => sum + p.areaSqFt, 0);
  if (Math.abs(total - requiredAreaSqFt) > AREA_TOLERANCE_SQFT) {
    reasons.push(
      `aggregate placement area ${total.toFixed(0)} sq ft does not match the required ${requiredAreaSqFt.toFixed(0)} sq ft`,
    );
  }
  if (!(heightFt > 0) || !Number.isFinite(heightFt)) {
    reasons.push("placement height is not a positive finite number");
  } else if (heightFt > heightCapFt + 1e-9) {
    reasons.push(
      `placement height ${heightFt.toFixed(0)} ft exceeds the modeled ${heightCapFt.toFixed(0)} ft cap`,
    );
  }
  return reasons;
}

function intersectionsAll(a: ScenePolygon, region: ScenePolygon[]): ScenePolygon[] {
  const out: ScenePolygon[] = [];
  for (const part of region) {
    out.push(...safeIntersection(a, part));
  }
  return out;
}

/** Extent of a polygon along a direction, for finite trim brackets. */
function bracketAlong(polygon: ScenePolygon, n: Vec2): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of polygon.exterior) {
    const d = p.x * n.x + p.y * n.y;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return { lo, hi };
}

/**
 * Frontage-aligned strip sweep. Bars of a fixed conceptual depth fill the
 * allowed region from the frontage inward; the final bar is bisection-
 * trimmed so the AGGREGATE area equals the exact #7 footprint budget. If no
 * bar depth yields a validated layout, the fallback trims the whole region
 * to the exact area along the frontage normal. UNRESOLVED otherwise.
 */
export function placeScenarioMassing(input: MassingPlacementInput): MassingPlacement {
  const reasons: string[] = [];
  const envelopeArea = totalAreaSqFt(input.envelope);
  if (!Number.isFinite(envelopeArea) || envelopeArea <= 0) {
    return {
      status: "UNRESOLVED",
      pieces: [],
      strategy: "no allowed planning region",
      reasons: ["the allowed planning region is empty or invalid"],
    };
  }
  if (input.requiredAreaSqFt > envelopeArea + AREA_TOLERANCE_SQFT) {
    return {
      status: "UNRESOLVED",
      pieces: [],
      strategy: "area exceeds the allowed planning region",
      reasons: [
        `required footprint ${input.requiredAreaSqFt.toFixed(0)} sq ft exceeds the allowed planning region (${envelopeArea.toFixed(0)} sq ft)`,
      ],
    };
  }
  if (input.requiredAreaSqFt < 1) {
    return {
      status: "PLACED",
      pieces: [],
      strategy: "zero-area program",
      reasons: [],
    };
  }

  const inward = { x: -input.front.outward.x, y: -input.front.outward.y };
  const lateral = { x: -inward.y, y: inward.x };
  const anchor = input.front.point;
  const rel = (p: Vec2): Vec2 => ({ x: p.x - anchor.x, y: p.y - anchor.y });
  const along = (p: Vec2, dir: Vec2): number => p.x * dir.x + p.y * dir.y;

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const part of input.envelope) {
    for (const p of part.exterior) {
      const r = rel(p);
      const d = along(r, inward);
      const l = along(r, lateral);
      minDepth = Math.min(minDepth, d);
      maxDepth = Math.max(maxDepth, d);
      minLat = Math.min(minLat, l);
      maxLat = Math.max(maxLat, l);
    }
  }
  const latSpan = maxLat - minLat;
  const depthStart = Math.floor(minDepth);
  const depthEnd = Math.ceil(maxDepth);

  for (const barDepth of BAR_DEPTHS_FT) {
    const pieces: PlacedPiece[] = [];
    let remaining = input.requiredAreaSqFt;
    for (let d = depthStart; d < depthEnd && remaining > AREA_TOLERANCE_SQFT; d += barDepth) {
      const band: ScenePolygon = {
        exterior: orientedRect(
          {
            x: anchor.x + lateral.x * (minLat - 4) + inward.x * d,
            y: anchor.y + lateral.y * (minLat - 4) + inward.y * d,
          },
          { x: lateral.x * (latSpan + 8), y: lateral.y * (latSpan + 8) },
          { x: inward.x * barDepth, y: inward.y * barDepth },
        ),
      };
      const parts = intersectionsAll(band, input.envelope)
        .filter((p) => totalAreaSqFt([p]) > AREA_TOLERANCE_SQFT);
      if (parts.length === 0) continue;

      // Sort by area descending, then by a stable coordinate key, so piece
      // selection never depends on polygon-clipping output order.
      parts.sort((a, b) => {
        const areaA = totalAreaSqFt([a]);
        const areaB = totalAreaSqFt([b]);
        if (Math.abs(areaB - areaA) > AREA_TOLERANCE_SQFT) return areaB - areaA;
        const key = (p: ScenePolygon) =>
          p.exterior.reduce((s, q) => s + Math.round(q.x * 100) * 31 + Math.round(q.y * 100), 0);
        return key(a) - key(b);
      });

      for (const part of parts) {
        if (remaining <= AREA_TOLERANCE_SQFT) break;
        const area = totalAreaSqFt([part]);
        if (area <= remaining + AREA_TOLERANCE_SQFT) {
          pieces.push({ polygon: part, areaSqFt: area, label: `Bar ${pieces.length + 1}` });
          remaining -= area;
          continue;
        }
        // Trim this part to the exact residual along the frontage normal:
        // keep the portion nearest the street, drop the deep tail.
        const bracket = bracketAlong(part, input.front.outward);
        const trimmed = trimToArea(
          part,
          input.front.outward,
          bracket.lo,
          bracket.hi,
          remaining,
        );
        if (trimmed) {
          const piece = trimmed.polygons[0];
          const pieceArea = totalAreaSqFt(piece ? [piece] : []);
          if (piece && Math.abs(pieceArea - remaining) <= AREA_TOLERANCE_SQFT) {
            pieces.push({ polygon: piece, areaSqFt: pieceArea, label: `Bar ${pieces.length + 1}` });
            remaining = 0;
            break;
          }
        }
        // Trim failed on this part: keep it whole only if it fits exactly.
        if (area <= remaining + AREA_TOLERANCE_SQFT) {
          pieces.push({ polygon: part, areaSqFt: area, label: `Bar ${pieces.length + 1}` });
          remaining -= area;
        }
      }
    }

    if (remaining > AREA_TOLERANCE_SQFT) continue;

    const violations = validatePlacement(
      pieces,
      input,
      input.requiredAreaSqFt,
      input.heightFt,
      input.heightCapFt,
    );
    if (violations.length === 0) {
      return {
        status: "PLACED",
        pieces,
        strategy: `frontage-aligned bars at ${barDepth} ft conceptual depth, final bar trimmed to the exact footprint area`,
        reasons: [],
      };
    }
    reasons.push(...violations.map((r) => `${barDepth} ft bars: ${r}`));
  }

  // Fallback: trim the largest single region part to the exact area along
  // the frontage normal (keep the street-facing portion).
  const partsByArea = [...input.envelope].sort(
    (a, b) => totalAreaSqFt([b]) - totalAreaSqFt([a]),
  );
  const main = partsByArea[0];
  if (main && totalAreaSqFt([main]) >= input.requiredAreaSqFt - AREA_TOLERANCE_SQFT) {
    const bracket = bracketAlong(main, input.front.outward);
    const trimmed = trimToArea(
      main,
      input.front.outward,
      bracket.lo,
      bracket.hi,
      input.requiredAreaSqFt,
    );
    const piece = trimmed?.polygons[0];
    if (piece) {
      const area = totalAreaSqFt([piece]);
      const candidate: PlacedPiece[] = [{ polygon: piece, areaSqFt: area, label: "Massing volume" }];
      const violations = validatePlacement(
        candidate,
        input,
        input.requiredAreaSqFt,
        input.heightFt,
        input.heightCapFt,
      );
      if (violations.length === 0) {
        return {
          status: "PLACED",
          pieces: candidate,
          strategy:
            "whole-region massing trimmed to the exact footprint area along the frontage normal (region too fragmented for bar sweep)",
          reasons: [],
        };
      }
      reasons.push(...violations.map((r) => `whole-region fallback: ${r}`));
    }
  }

  return {
    status: "UNRESOLVED",
    pieces: [],
    strategy: "no deterministic placement validated",
    reasons: reasons.length > 0 ? reasons : ["placement could not be constructed"],
  };
}

export interface ParkingPlanInput extends PlacementRegion {
  requiredStalls: number;
  /** Building footprint pieces already placed (parking must avoid them). */
  building: ScenePolygon[];
  /** Frontage direction — the first parking orientation tried. */
  front: { outward: Vec2 };
}

function rectFor(
  side: number,
  dirU: Vec2,
  dirV: Vec2,
  minU: number,
  minV: number,
  maxU: number,
  maxV: number,
  perRow: number,
  depthFt: number,
  u0: number,
  v0: number,
): ScenePolygon {
  // side 0: sweep from minU; side 1: from maxU (mirrored along U).
  const uStart = side === 0 ? minU + u0 : maxU - u0 - perRow * STALL.widthFt;
  const origin = {
    x: dirU.x * uStart + dirV.x * (minV + v0),
    y: dirU.y * uStart + dirV.y * (minV + v0),
  };
  return {
    exterior: orientedRect(
      origin,
      { x: dirU.x * perRow * STALL.widthFt, y: dirU.y * perRow * STALL.widthFt },
      { x: dirV.x * depthFt, y: dirV.y * depthFt },
    ),
  };
}

function fits(
  rect: ScenePolygon,
  available: ScenePolygon[],
  availableBboxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }>,
  obstacles: ScenePolygon[][],
  obstacleBboxes: Array<Array<{ minX: number; minY: number; maxX: number; maxY: number }>>,
  area: number,
): boolean {
  const ring = rect.exterior;
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
  // Necessary condition, cheap: a connected rectangle inside the region
  // must lie within ONE part (difference() outputs disjoint parts), so its
  // bbox must sit inside a single part's bbox. Only then pay for exact
  // boolean geometry.
  let host: ScenePolygon | null = null;
  for (let i = 0; i < available.length; i += 1) {
    const bb = availableBboxes[i];
    if (
      minX >= bb.minX - 1e-9 && maxX <= bb.maxX + 1e-9 &&
      minY >= bb.minY - 1e-9 && maxY <= bb.maxY + 1e-9
    ) {
      host = available[i];
      break;
    }
  }
  if (!host) return false;
  if (!cornersInside({ exterior: ring }, host)) return false;
  const rectPoly = { exterior: ring };
  const inside = totalAreaSqFt(safeIntersection(rectPoly, host));
  if (inside < area - AREA_TOLERANCE_SQFT) return false;
  for (let g = 0; g < obstacles.length; g += 1) {
    for (let i = 0; i < obstacles[g].length; i += 1) {
      const bb = obstacleBboxes[g][i];
      if (
        maxX < bb.minX - 1e-9 || minX > bb.maxX + 1e-9 ||
        maxY < bb.minY - 1e-9 || minY > bb.maxY + 1e-9
      ) {
        continue; // bbox-disjoint: no overlap possible
      }
      if (overlapArea(rectPoly, [obstacles[g][i]]) > AREA_TOLERANCE_SQFT) return false;
    }
  }
  return true;
}

/**
 * Deterministic multi-field surface-parking planner. Bays anchor to the
 * available region's bounding sides in a fixed orientation order
 * (frontage-aligned first), sweep quantized at 12 ft, prefer the standard
 * double-loaded bay, and take the exact remaining stall count whenever a
 * block fits. All-or-nothing: if the required count cannot be proven, NO
 * field is returned (UNRESOLVED) — partial layouts would read as solved.
 */
export function planParking(input: ParkingPlanInput): ParkingPlan {
  const reasons: string[] = [];
  if (input.requiredStalls <= 0) {
    return { status: "PLACED", requiredStalls: 0, placedStalls: 0, fields: [], reasons: [] };
  }

  // Area feasibility gate: a stall in ANY bay layout (double-loaded is the
  // densest) occupies at least width × (depth + half the shared aisle) of
  // ground. If even that lower bound exceeds the available ground, no
  // layout exists — refuse immediately with the precise arithmetic.
  const minLandPerStall = STALL.widthFt * (STALL.depthFt + STALL.aisleFt / 2);
  const buildingArea = input.building.reduce((sum, p) => sum + totalAreaSqFt([p]), 0);
  const availableArea = Math.max(0, totalAreaSqFt(input.envelope) - buildingArea);
  const requiredBayArea = input.requiredStalls * minLandPerStall;
  if (requiredBayArea > availableArea + AREA_TOLERANCE_SQFT) {
    return {
      status: "UNRESOLVED",
      requiredStalls: input.requiredStalls,
      placedStalls: 0,
      fields: [],
      reasons: [
        `required parking bay area (≥ ${requiredBayArea.toFixed(0)} sq ft at ${minLandPerStall.toFixed(0)} sq ft per stall: ${STALL.widthFt} ft stall × ${STALL.depthFt} ft depth + shared ${STALL.aisleFt} ft aisle) exceeds the available ground (${availableArea.toFixed(0)} sq ft inside the planning envelope after the building)`,
      ],
    };
  }

  let available = input.envelope;
  const obstacles = [input.sanctuary, input.building];
  const obstacleBboxes = obstacles.map((group) => group.map((p) => bboxOf(p.exterior)));
  const fields: ParkingFieldPlan[] = [];
  let remaining = input.requiredStalls;
  let checks = 0;

  const inward = { x: -input.front.outward.x, y: -input.front.outward.y };
  const orientations: { u: Vec2; v: Vec2 }[] = [
    { u: { x: -inward.y, y: inward.x }, v: inward },
    { u: inward, v: { x: -inward.y, y: inward.x } },
    { u: { x: inward.y, y: -inward.x }, v: inward },
    { u: { x: -inward.x, y: -inward.y }, v: inward },
  ];

  while (remaining > 0 && fields.length < MAX_PARKING_FIELDS) {
    if (available.every((p) => totalAreaSqFt([p]) <= AREA_TOLERANCE_SQFT)) {
      reasons.push("no ground area remains in the allowed planning region");
      break;
    }
    const availableBboxes = available.map((p) => bboxOf(p.exterior));
    let placed: { rect: ScenePolygon; rows: number; perRow: number; stalls: number } | null = null;

    for (const bay of BAY_ROWS) {
      const maxPerRow = Math.min(40, Math.ceil(remaining / bay.rows));
      const perRowCandidates = [
        maxPerRow,
        30, 20, 12, 8, 4, 1,
      ]
        .filter((p) => p >= 1 && p <= maxPerRow)
        .filter((p, i, all) => all.indexOf(p) === i);
      for (const perRow of perRowCandidates) {
        const stalls = bay.rows * perRow;
        if (stalls <= 0 || stalls > remaining) continue;
        for (let orientation = 0; orientation < orientations.length && !placed; orientation += 1) {
          const { u, v } = orientations[orientation];
          let minU = Infinity;
          let maxU = -Infinity;
          let minV = Infinity;
          let maxV = -Infinity;
          for (const part of available) {
            const bbox = bboxOf(part.exterior);
            // Project the part bbox corners — sufficient bracketing for the
            // rect sweep (the fit check is exact).
            for (const p of [
              { x: bbox.minX, y: bbox.minY },
              { x: bbox.maxX, y: bbox.minY },
              { x: bbox.minX, y: bbox.maxY },
              { x: bbox.maxX, y: bbox.maxY },
            ]) {
              minU = Math.min(minU, p.x * u.x + p.y * u.y);
              maxU = Math.max(maxU, p.x * u.x + p.y * u.y);
              minV = Math.min(minV, p.x * v.x + p.y * v.y);
              maxV = Math.max(maxV, p.x * v.x + p.y * v.y);
            }
          }
          const uSpan = Math.ceil(maxU - minU);
          const vSpan = Math.ceil(maxV - minV);
          const blockLen = perRow * STALL.widthFt;
          for (let side = 0; side < 2 && !placed; side += 1) {
            for (let v0 = 0; v0 + bay.depthFt <= vSpan && !placed; v0 += SWEEP_STEP_FT) {
              for (let u0 = 0; u0 + blockLen <= uSpan && !placed; u0 += SWEEP_STEP_FT) {
                checks += 1;
                if (checks > MAX_PARKING_FIT_CHECKS) break;
                const rect = rectFor(side, u, v, minU, minV, maxU, maxV, perRow, bay.depthFt, u0, v0);
                const area = blockLen * bay.depthFt;
                if (fits(rect, available, availableBboxes, obstacles, obstacleBboxes, area)) {
                  placed = { rect, rows: bay.rows, perRow, stalls };
                }
              }
            }
          }
        }
        if (placed) break;
      }
      if (placed) break;
    }

    if (checks > MAX_PARKING_FIT_CHECKS) {
      reasons.push(
        `deterministic parking search exceeded its explicit bound (${MAX_PARKING_FIT_CHECKS} candidate blocks) — refusing to guess`,
      );
      break;
    }
    if (!placed) {
      reasons.push(
        `no validated bay layout fits the remaining ground for ${remaining} stall(s) (searched 1–4 row bays along four orientations, 12 ft grid)`,
      );
      break;
    }

    const area = placed.perRow * STALL.widthFt * BAY_ROWS.find((b) => b.rows === placed!.rows)!.depthFt;
    fields.push({
      polygon: placed.rect,
      areaSqFt: area,
      stalls: placed.stalls,
      rows: placed.rows,
      perRow: placed.perRow,
    });
    remaining -= placed.stalls;
    available = available.flatMap((p) => safeDifference(p, placed!.rect));
  }

  if (remaining > 0) {
    // All-or-nothing: a partial plan would read as solved parking.
    return {
      status: "UNRESOLVED",
      requiredStalls: input.requiredStalls,
      placedStalls: 0,
      fields: [],
      reasons,
    };
  }

  // Final mechanical validation: exact count, no overlap with preserved
  // structures or the building, every field inside the original region.
  const total = fields.reduce((sum, f) => sum + f.stalls, 0);
  if (total !== input.requiredStalls) {
    return {
      status: "UNRESOLVED",
      requiredStalls: input.requiredStalls,
      placedStalls: 0,
      fields: [],
      reasons: [`stall arithmetic ${total} ≠ required ${input.requiredStalls}`],
    };
  }
  const violations = validatePlacement(
    fields.map((f) => ({ polygon: f.polygon, areaSqFt: f.areaSqFt, label: "parking" })),
    input,
    fields.reduce((sum, f) => sum + f.areaSqFt, 0),
    0.25,
    Number.POSITIVE_INFINITY,
  ).filter((r) => !r.includes("height"));
  // Parking sits on the ground INSIDE the region but must also avoid the
  // building footprint — checked against the same obstacle list during the
  // sweep; re-validated here explicitly.
  for (const field of fields) {
    if (overlapArea(field.polygon, input.building) > AREA_TOLERANCE_SQFT) {
      violations.push("a parking field overlaps the building footprint");
    }
    if (overlapArea(field.polygon, input.sanctuary) > AREA_TOLERANCE_SQFT) {
      violations.push("a parking field overlaps a preserved structure");
    }
  }
  // Pairwise field disjointness (sequential subtraction guarantees it; the
  // re-check keeps the invariant mechanical).
  for (let i = 0; i < fields.length; i += 1) {
    for (let j = i + 1; j < fields.length; j += 1) {
      if (overlapArea(fields[i].polygon, [fields[j].polygon]) > AREA_TOLERANCE_SQFT) {
        violations.push("two parking fields overlap");
      }
    }
  }
  if (violations.length > 0) {
    return {
      status: "UNRESOLVED",
      requiredStalls: input.requiredStalls,
      placedStalls: 0,
      fields: [],
      reasons: violations,
    };
  }

  return {
    status: "PLACED",
    requiredStalls: input.requiredStalls,
    placedStalls: total,
    fields,
    reasons: [],
  };
}

/** Convenience for tests: area of a single ring, exported for assertions. */
export const ringArea = areaOf;
