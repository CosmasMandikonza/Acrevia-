/**
 * Production Forge scene adapter (issue #9).
 *
 * Maps the LIVE pipeline output — verified Development Graph project,
 * deterministic #7 SolveResult, recorded ScenarioCertificates — into the
 * SpatialSceneModel the renderer consumes. This is the #8 rulebook running
 * on real truth instead of spike fixtures:
 *
 * - frame: local ENU feet anchored at the parcel ring's shoelace centroid;
 * - frontage: parcel edges within 60 ft of the VERIFIED address point
 *   (orientation only — the signed session's geocode, never client input);
 * - legal envelope: finite setback quads + occupied-area cap bisection trim,
 *   EnvelopeVerification = ASSUMPTION_DERIVED (edge roles unclassified);
 * - mission envelope: legal − preserved structures, mission clips explicit;
 * - scenario massing + parking: deterministic placement from
 *   forge-placement.ts, mechanically validated, ASSUMPTION_DERIVED or
 *   UNRESOLVED — a green polygon has to earn the right to be green.
 *
 * No spike fixture is read here. Nothing mutates the project. The model
 * stays byte-deterministic: no wall-clock, no randomness, no
 * iteration-order drift (nodes are read through deterministic ordering).
 */

import { nodesOfKind, type Project } from "../../domain";
import { selectExecutableConstraints } from "../../application/regulatory/executable";
import { SOLVER_VERSION, type SolveResult, type SolvedScenario } from "../../application/solver/solve";
import type { RecordedScenario } from "../../application/solver/record";
import {
  SPATIAL_SCENE_SCHEMA_VERSION,
  type EnvelopeScene,
  type MissionClipScene,
  type MissionEnvelopeScene,
  type ParkingPlanScene,
  type ProvenanceRef,
  type SavedCamera,
  type SceneAnnotation,
  type ScenePolygon,
  type ScenarioScene,
  type ScenarioVolumeScene,
  type SetbackScene,
  type SpatialSceneModel,
  type StructureScene,
  type Vec2,
} from "../../spatial/scene-model";
import { frameAt, toLocal, type LocalFrame } from "./projection";
import {
  bboxOf,
  edgeFrame,
  geojsonToScenePolygon,
  ringCentroid,
  toCcw,
  totalAreaSqFt,
  trimToArea,
} from "./geometry2d";
import {
  STALL,
  placeScenarioMassing,
  planParking,
  safeDifference,
  safeIntersection,
  type ParkingPlan,
} from "./forge-placement";

const FRONTAGE_HINT_MAX_DIST_FT = 60;

export interface ForgeSceneInput {
  project: Project;
  solveResult: SolveResult;
  recorded: RecordedScenario[];
  /** Verified address geocode point (orientation only — never geometry). */
  addressHint: { lon: number; lat: number };
  title: string;
  subtitle: string;
}

interface ConstraintNode {
  id: string;
  regulationId: string;
  constraintKind: string;
  [key: string]: unknown;
}

function provenance(nodeId: string, nodeKind: string, label: string): ProvenanceRef {
  return { nodeId, nodeKind, label };
}

function anchorFrameFor(geometry: unknown): LocalFrame {
  const geo = geometry as { type: string; coordinates: unknown };
  let coords: number[][];
  if (geo.type === "MultiPolygon") {
    coords = (geo.coordinates as number[][][][])[0][0];
  } else {
    coords = (geo.coordinates as number[][][])[0];
  }
  const pts = coords.map(([lon, lat]) => ({ x: lon, y: lat }));
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const q = pts[(i + 1) % pts.length];
    const cr = pts[i].x * q.y - q.x * pts[i].y;
    a += cr;
    cx += (pts[i].x + q.x) * cr;
    cy += (pts[i].y + q.y) * cr;
  }
  a /= 2;
  const c =
    Math.abs(a) < 1e-15
      ? {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        }
      : { x: cx / (6 * a), y: cy / (6 * a) };
  return frameAt(c.x, c.y);
}

function structureHeightFt(project: Project, structureId: string): number | null {
  const claim = nodesOfKind(project, "claim").find((n) => {
    const c = n as unknown as { subjectNodeId: string; predicate: string };
    return c.subjectNodeId === structureId && c.predicate === "building-height";
  }) as unknown as { value: { type: string; quantity?: { value: number } } } | undefined;
  if (claim && claim.value?.type === "quantity" && claim.value.quantity) {
    return claim.value.quantity.value;
  }
  return null;
}

function structureName(project: Project): string {
  const claim = nodesOfKind(project, "claim").find(
    (n) => (n as unknown as { predicate: string }).predicate === "building-name",
  ) as unknown as { value: { text?: string } } | undefined;
  return claim?.value?.text ?? "Existing structure";
}

export function buildForgeScene(input: ForgeSceneInput): SpatialSceneModel {
  const notes: string[] = [];
  const project = input.project;
  const { solveResult } = input;

  // --- Parcel + frame --------------------------------------------------------
  const parcels = nodesOfKind(project, "parcel");
  if (parcels.length !== 1) {
    throw new Error(`forge scene: expected exactly one parcel, got ${parcels.length}`);
  }
  const parcelNode = parcels[0] as unknown as {
    id: string;
    geometry: { geojson: unknown };
    recordedArea?: { value: number; unit: string };
  };
  const parcelPolygon = geojsonToScenePolygon(parcelNode.geometry.geojson as never);
  const frame = anchorFrameFor(parcelNode.geometry.geojson as never);
  const projectRing = (ring: Vec2[]): Vec2[] => toCcw(ring.map((p) => toLocal(frame, p.x, p.y)));
  const parcelLocal: ScenePolygon = {
    exterior: projectRing(parcelPolygon.exterior),
    holes: (parcelPolygon.holes ?? []).map(projectRing),
  };
  const parcelRing = parcelLocal.exterior;
  const parcelAreaSqFt = totalAreaSqFt([parcelLocal]);
  const bbox = bboxOf(parcelRing);
  const diagonalFt = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const centroid = ringCentroid(parcelRing);
  notes.push(
    `Parcel projected to local feet at ring centroid; computed area ${parcelAreaSqFt.toFixed(0)} sq ft vs recorded ${parcelNode.recordedArea?.value ?? "n/a"} sq ft (solver geodesic basis: ${solveResult.geometry.parcelAreaSqFt.toFixed(0)} sq ft).`,
  );

  const hint = toLocal(frame, input.addressHint.lon, input.addressHint.lat);

  // --- Missions (CONFIRMED typed commands only) -------------------------------
  const missionNodes = nodesOfKind(project, "mission-constraint")
    .map((n) =>
      n as unknown as {
        id: string;
        intentText: string;
        confirmationState: string;
        hardOrSoft: string;
        normalized: { type: string; structureId?: string; limit?: { value: number }; spaces?: { value: number } };
      },
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const confirmedMissions = missionNodes.filter((m) => m.confirmationState === "CONFIRMED");
  const preserveIds = new Set(
    confirmedMissions
      .filter((m) => m.normalized.type === "preserve-structure")
      .map((m) => m.normalized.structureId ?? ""),
  );
  const missionMaxHeight = confirmedMissions
    .filter((m) => m.normalized.type === "max-height")
    .map((m) => m.normalized.limit?.value ?? Number.POSITIVE_INFINITY)
    .reduce((min, v) => Math.min(min, v), Number.POSITIVE_INFINITY);
  const missionParking = confirmedMissions.find((m) => m.normalized.type === "min-parking");

  // --- Structures --------------------------------------------------------------
  const structures: StructureScene[] = [];
  for (const node of nodesOfKind(project, "structure").sort((a, b) =>
    (a as unknown as { id: string }).id.localeCompare((b as unknown as { id: string }).id),
  )) {
    const s = node as unknown as {
      id: string;
      parcelId: string;
      footprint?: { geojson: unknown };
    };
    if (!s.footprint?.geojson) {
      notes.push(`Structure ${s.id}: no footprint geometry in the graph — not rendered (honest gap).`);
      continue;
    }
    const poly = geojsonToScenePolygon(s.footprint.geojson as never);
    const height = structureHeightFt(project, s.id);
    const protectedByMission = preserveIds.has(s.id);
    structures.push({
      id: `structure:${s.id}`,
      structureId: s.id,
      name: structureName(project),
      polygon: { exterior: projectRing(poly.exterior), holes: (poly.holes ?? []).map(projectRing) },
      heightFt: height ?? 0,
      protectedByMission,
      label: protectedByMission ? "Sanctuary — protected by mission" : "Existing structure",
      provenance: [
        provenance(s.id, "structure", "Structure node"),
        ...(height === null ? [] : [provenance("building-height claim", "claim", "Building height claim")]),
      ],
    });
    if (height === null) {
      notes.push(`Structure ${s.id}: no building-height claim — height UNRESOLVED (rendered flat).`);
    }
  }

  // --- Executable law (the #6 gate) ---------------------------------------------
  const gate = selectExecutableConstraints(project);
  const executable = gate.executable.map((c) => c as unknown as ConstraintNode);
  const byKind = (kind: string): ConstraintNode[] =>
    executable.filter((c) => c.constraintKind === kind);

  const heightConstraint = byKind("height")[0];
  const legalHeightFt =
    heightConstraint && typeof heightConstraint.limit === "object"
      ? (heightConstraint.limit as { value: number }).value
      : null;
  const setbackConstraints = byKind("setback");
  const occupiedConstraint = byKind("occupied-area")[0] as
    | (ConstraintNode & { byLotType?: { intermediate?: number; corner?: number } })
    | undefined;

  // --- Frontage classification (verified hint, orientation only) ----------------
  const frontageEdgeIdx: number[] = [];
  for (let i = 0; i < parcelRing.length; i += 1) {
    const a = parcelRing[i];
    const b = parcelRing[(i + 1) % parcelRing.length];
    if (edgeFrame(a, b).length < 80) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(mid.x - hint.x, mid.y - hint.y);
    const dEnd = Math.min(
      Math.hypot(a.x - hint.x, a.y - hint.y),
      Math.hypot(b.x - hint.x, b.y - hint.y),
    );
    if (Math.min(d, dEnd) <= FRONTAGE_HINT_MAX_DIST_FT) {
      frontageEdgeIdx.push(i);
    }
  }
  if (frontageEdgeIdx.length === 0) {
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < parcelRing.length; i += 1) {
      const a = parcelRing[i];
      const b = parcelRing[(i + 1) % parcelRing.length];
      const len = edgeFrame(a, b).length;
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    frontageEdgeIdx.push(best);
    notes.push("Frontage: no edge within 60 ft of the verified address point — fell back to the longest edge.");
  } else {
    notes.push(
      `Frontage: edges ${frontageEdgeIdx.join(", ")} lie within ${FRONTAGE_HINT_MAX_DIST_FT} ft of the VERIFIED session address point (orientation only, never geometry).`,
    );
  }
  const frontageSet = new Set(frontageEdgeIdx);

  let rearIdx = -1;
  let rearLen = -1;
  for (let i = 0; i < parcelRing.length; i += 1) {
    if (frontageSet.has(i)) continue;
    const a = parcelRing[i];
    const b = parcelRing[(i + 1) % parcelRing.length];
    const len = edgeFrame(a, b).length;
    if (len > rearLen) {
      rearLen = len;
      rearIdx = i;
    }
  }

  const appliedSetbackFor = (face: "front" | "side" | "rear"): SetbackScene | null => {
    const c = setbackConstraints.find((x) => (x as unknown as { face: string }).face === face) as
      | (ConstraintNode & { face: string; spec: { type: string; min?: { value: number }; range?: { min: number; max: number } } })
      | undefined;
    if (!c) return null;
    if (c.spec.type === "numeric") {
      return {
        face,
        specType: "numeric",
        appliedFt: c.spec.min?.value ?? null,
        rangeMinFt: null,
        rangeMaxFt: null,
        constraintId: c.id,
        note: `Numeric ${face} setback applied to the maximum envelope.`,
      };
    }
    if (c.spec.type === "range") {
      return {
        face,
        specType: "range",
        appliedFt: c.spec.range?.min ?? null,
        rangeMinFt: c.spec.range?.min ?? null,
        rangeMaxFt: c.spec.range?.max ?? null,
        constraintId: c.id,
        note: `Range ${face} setback — maximum envelope uses the minimum (${c.spec.range?.min} ft).`,
      };
    }
    return {
      face,
      specType: "contextual",
      appliedFt: null,
      rangeMinFt: null,
      rangeMaxFt: null,
      constraintId: c.id,
      note: `Contextual ${face} setback — no numeric plane derivable; the front plane stays at the parcel line.`,
    };
  };

  const setbacks = [appliedSetbackFor("front"), appliedSetbackFor("side"), appliedSetbackFor("rear")].filter(
    (s): s is SetbackScene => s !== null,
  );

  // --- Legal envelope ------------------------------------------------------------
  let legalEnvelope: EnvelopeScene | null = null;
  let setbackOnly: ScenePolygon[] = [];
  const annotations: SceneAnnotation[] = [];

  if (legalHeightFt === null) {
    notes.push("Legal envelope: no executable height constraint — envelope UNRESOLVED.");
  } else {
    let envelopeParts: ScenePolygon[] = [parcelLocal];
    const sideFt = setbacks.find((s) => s.face === "side")?.appliedFt ?? 0;
    const rearFt = setbacks.find((s) => s.face === "rear")?.appliedFt ?? 0;
    for (let i = 0; i < parcelRing.length; i += 1) {
      const a = parcelRing[i];
      const b = parcelRing[(i + 1) % parcelRing.length];
      const { n, length } = edgeFrame(a, b);
      if (length < 3) continue;
      const setbackFt = frontageSet.has(i) ? 0 : i === rearIdx ? rearFt : sideFt;
      if (setbackFt <= 0) continue;
      const strip: ScenePolygon = {
        exterior: [
          { x: a.x, y: a.y },
          { x: b.x, y: b.y },
          { x: b.x - n.x * setbackFt, y: b.y - n.y * setbackFt },
          { x: a.x - n.x * setbackFt, y: a.y - n.y * setbackFt },
        ],
      };
      envelopeParts = envelopeParts.flatMap((p) => safeDifference(p, strip));
    }
    setbackOnly = envelopeParts;
    const setbackArea = totalAreaSqFt(setbackOnly);
    notes.push(
      `Setback envelope: side ${setbacks.find((s) => s.face === "side")?.appliedFt ?? 0} ft (range min), rear ${setbacks.find((s) => s.face === "rear")?.appliedFt ?? 0} ft; area ${setbackArea.toFixed(0)} sq ft (${((setbackArea / parcelAreaSqFt) * 100).toFixed(1)}% of parcel).`,
    );

    let envelopePolygons: ScenePolygon[] = setbackOnly;
    let bindingNotes: string[] = [];
    const capPct = occupiedConstraint?.byLotType?.intermediate ?? null;
    if (capPct !== null) {
      const target = (parcelAreaSqFt * capPct) / 100;
      let longestFront = frontageEdgeIdx[0];
      let longestLen = -1;
      for (const i of frontageEdgeIdx) {
        const a = parcelRing[i];
        const b = parcelRing[(i + 1) % parcelRing.length];
        const len = edgeFrame(a, b).length;
        if (len > longestLen) {
          longestLen = len;
          longestFront = i;
        }
      }
      const fa = parcelRing[longestFront];
      const fb = parcelRing[(longestFront + 1) % parcelRing.length];
      const { n } = edgeFrame(fa, fb);
      const c = fa.x * n.x + fa.y * n.y;
      const partsByArea = [...setbackOnly].sort((p, q) => totalAreaSqFt([q]) - totalAreaSqFt([p]));
      const main = partsByArea[0] ?? { exterior: parcelRing };
      const trimmed = trimToArea(main, n, c - diagonalFt, c, target - (setbackArea - totalAreaSqFt([main])));
      if (trimmed) {
        envelopePolygons = [...partsByArea.slice(1), ...trimmed.polygons];
        bindingNotes = [
          `Occupied-area cap ${capPct}% (intermediate lot — conservative; lot type not in graph) binds at ${target.toFixed(0)} sq ft; envelope trimmed ${(c - trimmed.offset).toFixed(1)} ft back from the street frontage.`,
        ];
        notes.push(bindingNotes[0]);
      } else {
        bindingNotes = ["Occupied-area cap could not be resolved geometrically — cap NOT applied (UNRESOLVED)."];
        notes.push(bindingNotes[0]);
      }
    }

    const envelopeArea = totalAreaSqFt(envelopePolygons);
    legalEnvelope = {
      polygons: envelopePolygons,
      heightFt: legalHeightFt,
      areaSqFt: envelopeArea,
      volumeCuFt: envelopeArea * legalHeightFt,
      verification: "ASSUMPTION_DERIVED",
      verificationNote:
        "LAW-INFORMED PLANNING ENVELOPE, ASSUMPTION-DERIVED: the height max and occupied-area percentage are sourced law; edge roles (frontage from the verified address point, rear = longest non-frontage edge) are a visualization heuristic — lot-line roles are not classified in trusted state.",
      setbacks,
      bindingNotes,
      provenance: [
        ...(heightConstraint
          ? [
              provenance(heightConstraint.id, "constraint", "Height constraint"),
              provenance(heightConstraint.regulationId, "regulation", "Regulation"),
            ]
          : []),
        ...setbacks
          .filter((s) => s.constraintId)
          .map((s) => provenance(s.constraintId as string, "constraint", `${s.face} setback`)),
      ],
    };
    annotations.push({
      id: "annotation:height-max",
      kind: "height-plane",
      text: `${legalHeightFt} ft — zoning height max (sourced law)`,
      at: { x: bbox.minX + 12, y: bbox.minY + 12 },
      elevationFt: legalHeightFt,
    });
  }

  // --- Mission envelope (legal − preserved structures) ---------------------------
  let missionEnvelope: MissionEnvelopeScene | null = null;
  if (legalEnvelope && legalHeightFt !== null) {
    const missionHeight = Math.min(legalHeightFt, missionMaxHeight);
    const preservedPolys = structures.filter((s) => s.protectedByMission).map((s) => s.polygon);
    let missionPolys = legalEnvelope.polygons;
    const clips: MissionClipScene[] = [];

    for (const poly of preservedPolys) {
      for (const envPoly of missionPolys) {
        for (const piece of safeIntersection(envPoly, poly)) {
          if (totalAreaSqFt([piece]) > 1) {
            clips.push({
              id: `clip:preserve:${poly.exterior[0].x.toFixed(1)}-${poly.exterior[0].y.toFixed(1)}`,
              label: "Protected sanctuary — no new build",
              polygon: piece,
              fromFt: 0,
              toFt: missionHeight,
              missionConstraintId:
                confirmedMissions.find((m) => m.normalized.type === "preserve-structure")?.id ?? "",
              note: "Mission preserve-structure removes the sanctuary footprint from developable volume.",
            });
          }
        }
      }
      missionPolys = missionPolys.flatMap((p) => safeDifference(p, poly));
    }

    if (missionHeight < legalHeightFt) {
      for (const envPoly of missionPolys) {
        clips.push({
          id: `clip:height:${envPoly.exterior[0].x.toFixed(1)}-${envPoly.exterior[0].y.toFixed(1)}`,
          label: `Mission height cap ${missionHeight} ft`,
          polygon: envPoly,
          fromFt: missionHeight,
          toFt: legalHeightFt,
          missionConstraintId: confirmedMissions.find((m) => m.normalized.type === "max-height")?.id ?? "",
          note: `Mission max-height removes the ${missionHeight}–${legalHeightFt} ft slab.`,
        });
      }
      notes.push(`Mission height cap: ${missionHeight} ft clips the envelope's upper slab.`);
    }

    const missionArea = totalAreaSqFt(missionPolys);
    missionEnvelope = {
      polygons: missionPolys,
      heightFt: missionHeight,
      areaSqFt: missionArea,
      volumeCuFt: missionArea * missionHeight,
      verification: "ASSUMPTION_DERIVED",
      verificationNote: `${legalEnvelope.verificationNote} Mission clips remove confirmed preserve-structure footprints.`,
      setbacks,
      bindingNotes: [
        ...legalEnvelope.bindingNotes,
        `Mission clips: ${clips.length} removed volume(s) (${clips.map((c) => c.label).join("; ") || "none"}).`,
      ],
      clips,
      provenance: [
        ...legalEnvelope.provenance,
        ...confirmedMissions.map((m) => provenance(m.id, "mission-constraint", "Mission constraint")),
      ],
    };
    notes.push(
      `Mission envelope: ${missionArea.toFixed(0)} sq ft at ${missionHeight} ft (${((missionArea / legalEnvelope.areaSqFt) * 100).toFixed(0)}% of the law-informed planning envelope footprint).`,
    );
  }

  // --- Frontage anchor for placement (deterministic) ------------------------------
  let fnx = 0;
  let fny = 0;
  for (const i of frontageEdgeIdx) {
    const a = parcelRing[i];
    const b = parcelRing[(i + 1) % parcelRing.length];
    const { n, length } = edgeFrame(a, b);
    fnx += n.x * length;
    fny += n.y * length;
  }
  const fnLen = Math.hypot(fnx, fny) || 1;
  const frontOut = { x: fnx / fnLen, y: fny / fnLen };
  const frontAnchorEdge = frontageEdgeIdx[0];
  const frontAnchorPoint = parcelRing[frontAnchorEdge];

  const sanctuaryPolys = structures.filter((s) => s.protectedByMission).map((s) => s.polygon);
  const placementRegion =
    missionEnvelope?.polygons ??
    legalEnvelope?.polygons ??
    ([parcelLocal] as ScenePolygon[]);

  // --- Scenarios: real #7 points → validated placement ----------------------------
  const scenarios: ScenarioScene[] = [];
  const storyFt = solveResult.inputs.assumptions.storyFloorToFloorFt;
  const heightCapFt = solveResult.geometry.heightCeilingFt;

  if (solveResult.status === "SOLVED") {
    solveResult.scenarios.forEach((scenario, index) => {
      const record = input.recorded[index];
      scenarios.push(
        buildScenarioScene({
          scenario,
          record,
          placementRegion,
          sanctuaryPolys,
          front: { point: frontAnchorPoint, outward: frontOut },
          storyFt,
          heightCapFt,
          missionParkingId: missionParking?.id ?? null,
          parkingRequired: scenario.point.parkingStalls,
          stallLandAreaSqFt: solveResult.inputs.assumptions.parkingStallGrossLandArea,
          notes,
        }),
      );
    });
  } else {
    // NO VERIFIED SOLUTION: the refused target renders as an honest ghost,
    // never as buildable massing.
    const target = solveResult.requestedTarget;
    const floorsCap = solveResult.geometry.floorsCap;
    const gross = solveResult.inputs.assumptions.residentialGrossPerUnit;
    const ghostFootprint = Math.ceil((target * gross) / Math.max(1, floorsCap));
    const ghostScenario = {
      point: {
        homes: target,
        floors: Math.max(1, floorsCap),
        parkingStalls: solveResult.geometry.parkingStallsRequired,
        parkingMargin: 0,
        footprintSqFt: ghostFootprint,
      },
      label: null,
      results: [],
      confidence: "EXPERT_REVIEW_REQUIRED",
      professionalQuestions: solveResult.explanationInputs,
    } as SolvedScenario;
    const ghost = buildScenarioScene({
      scenario: ghostScenario,
      record: undefined,
      placementRegion,
      sanctuaryPolys,
      front: { point: frontAnchorPoint, outward: frontOut },
      storyFt,
      heightCapFt,
      missionParkingId: missionParking?.id ?? null,
      parkingRequired: solveResult.geometry.parkingStallsRequired,
      stallLandAreaSqFt: solveResult.inputs.assumptions.parkingStallGrossLandArea,
      notes,
      refused: {
        requestedTarget: target,
        upperBoundHomes: solveResult.modeledUpperBoundHomes,
        explanation: solveResult.explanationInputs.join(" "),
        binding: solveResult.binding.map((p) => ({
          label: `${p.humanLabel}${p.missionLocked ? " (mission-locked)" : ""}`,
          detail: `Limit ${p.currentLimit} → relaxed ${p.relaxedLimit} ${p.unit} unlocks +${p.capacityDelta} homes. ${p.explanation}`,
        })),
        nearestHomes: solveResult.nearestAlternatives.map((a) => a.homes),
      },
    });
    scenarios.push(ghost);
  }

  // --- Parking obligation annotation (per-scenario plans live on scenarios) -------
  if (missionParking) {
    annotations.push({
      id: "annotation:parking-obligation",
      kind: "area",
      text: `Mission parking: at least ${missionParking.normalized.spaces?.value ?? solveResult.geometry.parkingStallsRequired} stalls`,
      at: { x: bbox.minX + 12, y: bbox.maxY - 12 },
      elevationFt: 0,
    });
  }

  // --- Cameras (deterministic, saved-view structure for #13) -----------------------
  const sceneX = (p: Vec2): number => p.x;
  const sceneZ = (p: Vec2): number => -p.y;
  const center = { x: sceneX(centroid), z: sceneZ(centroid) };
  const sanctuary = structures.find((s) => s.protectedByMission) ?? structures[0];
  const sanctCenter = sanctuary ? ringCentroid(sanctuary.polygon.exterior) : centroid;

  const cameras: SavedCamera[] = [
    {
      id: "camera:aerial",
      label: "Aerial",
      position: { x: center.x + diagonalFt * 0.42, y: diagonalFt * 0.62, z: center.z + diagonalFt * 0.52 },
      target: { x: center.x, y: 4, z: center.z },
      fovDeg: 38,
      note: "Parcel-fit aerial from the street corner, high enough to read the whole site.",
      transitionMs: 1050,
    },
    {
      id: "camera:entry",
      label: "Church entry",
      position: {
        x: sceneX(sanctCenter) + frontOut.x * diagonalFt * 0.32,
        y: 24,
        z: sceneZ(sanctCenter) - frontOut.y * diagonalFt * 0.32,
      },
      target: { x: sceneX(sanctCenter), y: 14, z: sceneZ(sanctCenter) },
      fovDeg: 42,
      note: "Approach from the street frontage toward the sanctuary at a 24 ft eye line.",
      transitionMs: 1050,
    },
    {
      id: "camera:pedestrian",
      label: "Pedestrian",
      position: { x: hint.x, y: 5.5, z: sceneZ(hint) },
      target: { x: sceneX(sanctCenter), y: 20, z: sceneZ(sanctCenter) },
      fovDeg: 46,
      note: "Sidewalk eye height at the verified address point.",
      transitionMs: 1050,
    },
    {
      id: "camera:neighbor",
      label: "Neighbor",
      position: {
        x: center.x - frontOut.x * diagonalFt * 0.46,
        y: 20,
        z: center.z + frontOut.y * diagonalFt * 0.46,
      },
      target: { x: center.x, y: 8, z: center.z },
      fovDeg: 44,
      note: "From across the property lines looking back at the site.",
      transitionMs: 1050,
    },
  ];

  return {
    schemaVersion: SPATIAL_SCENE_SCHEMA_VERSION,
    unit: "ft",
    frame: {
      origin: { lon: frame.origin.lon, lat: frame.origin.lat },
      description: "Local ENU feet anchored at the parcel ring's shoelace centroid (WGS84).",
    },
    title: input.title,
    subtitle: input.subtitle,
    parcel: {
      id: parcelNode.id,
      label: "Accepted church parcel",
      polygon: parcelLocal,
      computedAreaSqFt: parcelAreaSqFt,
      recordedAreaSqFt: parcelNode.recordedArea?.value ?? null,
      provenance: [provenance(parcelNode.id, "parcel", "Parcel node")],
    },
    structures,
    frontage: {
      edgeIndices: frontageEdgeIdx.map((i) => [i, (i + 1) % parcelRing.length] as [number, number]),
      streetLabel: null,
      derivation:
        "Edges within 60 ft of the VERIFIED session address point (orientation only, never geometry).",
    },
    legalEnvelope,
    missionEnvelope,
    parking: null, // production parking lives per-scenario (parkingPlan on each scenario)
    scenarios,
    heightPlaneFt: legalHeightFt,
    heightPlaneProvenance: legalEnvelope?.provenance.slice(0, 2) ?? [],
    annotations,
    cameras,
    derivationNotes: notes,
    modeled: {
      solverVersion: SOLVER_VERSION,
      ceilings: {
        legalDensity: solveResult.ceilings.legalDensity,
        massing: solveResult.ceilings.massing,
        physicalSiteAreaBudget: solveResult.ceilings.physicalSiteAreaBudget,
        overall: solveResult.ceilings.overall,
      },
      upperBoundHomes: solveResult.modeledUpperBoundHomes,
      note: "Three modeled ceilings computed independently by the #7 solver; the overall value is their minimum. Area arithmetic does not prove physical placement.",
    },
    ...(solveResult.status === "NO_VERIFIED_SOLUTION"
      ? {
          refusal: {
            requestedTarget: solveResult.requestedTarget,
            upperBoundHomes: solveResult.modeledUpperBoundHomes,
            explanation: solveResult.explanationInputs.join(" "),
            binding: solveResult.binding.map((p) => ({
              label: `${p.humanLabel}${p.missionLocked ? " (mission-locked)" : ""}`,
              detail: `Limit ${p.currentLimit} → relaxed ${p.relaxedLimit} ${p.unit} unlocks +${p.capacityDelta} homes. ${p.explanation}`,
            })),
            nearestHomes: solveResult.nearestAlternatives.map((a) => a.homes),
          },
        }
      : {}),
  };
}

interface BuildScenarioArgs {
  scenario: SolvedScenario;
  record: RecordedScenario | undefined;
  placementRegion: ScenePolygon[];
  sanctuaryPolys: ScenePolygon[];
  front: { point: Vec2; outward: Vec2 };
  storyFt: number;
  heightCapFt: number;
  missionParkingId: string | null;
  parkingRequired: number;
  stallLandAreaSqFt: number;
  notes: string[];
  refused?: {
    requestedTarget: number;
    upperBoundHomes: number;
    explanation: string;
    binding: { label: string; detail: string }[];
    nearestHomes: number[];
  };
}

function buildScenarioScene(args: BuildScenarioArgs): ScenarioScene {
  const { scenario, record, notes } = args;
  const point = scenario.point;
  const heightFt = point.floors * args.storyFt;
  const label = scenario.label ?? `Requested ${point.homes} homes`;

  const massing = placeScenarioMassing({
    envelope: args.placementRegion,
    sanctuary: args.sanctuaryPolys,
    requiredAreaSqFt: point.footprintSqFt,
    heightFt,
    heightCapFt: args.heightCapFt,
    front: args.front,
  });

  const buildingPieces =
    massing.status === "PLACED" ? massing.pieces.map((p) => p.polygon) : [];

  const parking: ParkingPlan =
    args.refused === undefined && buildingPieces.length > 0
      ? planParking({
          envelope: args.placementRegion,
          sanctuary: args.sanctuaryPolys,
          building: buildingPieces,
          requiredStalls: point.parkingStalls,
          front: { outward: args.front.outward },
        })
      : { status: "UNRESOLVED", requiredStalls: point.parkingStalls, placedStalls: 0, fields: [], reasons: ["scenario refused or building placement unresolved — no parking layout attempted"] };

  const parkingPlanScene: ParkingPlanScene = {
    status: parking.status,
    requiredStalls: parking.requiredStalls,
    placedStalls: parking.placedStalls,
    verification: "ASSUMPTION_DERIVED",
    fields: parking.fields.map((f, i) => ({
      id: `parking-field:${record?.scenarioId ?? "scenario"}:${i}`,
      label: `Surface field ${i + 1} — ${f.stalls} stalls (${f.rows} row${f.rows > 1 ? "s" : ""} × ${f.perRow})`,
      polygon: f.polygon,
      areaSqFt: f.areaSqFt,
      stalls: {
        count: f.stalls,
        widthFt: STALL.widthFt,
        depthFt: STALL.depthFt,
        aisleFt: STALL.aisleFt,
      },
      requirementLabel: `scenario point: ${point.parkingStalls} stalls (mission minimum +${point.parkingMargin} margin)`,
      missionConstraintId: args.missionParkingId,
      provenance: args.missionParkingId
        ? [provenance(args.missionParkingId, "mission-constraint", "Mission min-parking")]
        : [],
    })),
    obligation: {
      areaSqFt: point.parkingStalls * args.stallLandAreaSqFt,
      label: `${point.parkingStalls}-stall surface parking obligation`,
      note:
        parking.status === "PLACED"
          ? `ASSUMPTION_DERIVED PLANNING LAYOUT — ${parking.fields.length} field(s), exact stall count validated. Not legal parking approval.`
          : `Requirement stands (${point.parkingStalls} stalls ≈ ${(point.parkingStalls * args.stallLandAreaSqFt).toLocaleString("en-US")} sq ft of land at the solver's stall-area assumption); the deterministic planner could not prove a layout: ${parking.reasons.join("; ")}. Nothing is faked.`,
    },
    reasons: parking.reasons,
    provenance: args.missionParkingId
      ? [provenance(args.missionParkingId, "mission-constraint", "Mission min-parking")]
      : [],
  };

  const placementStatus =
    massing.status === "PLACED" && parking.status === "PLACED"
      ? "PLACED"
      : massing.status === "PLACED"
        ? "PARTIAL"
        : "UNRESOLVED";

  const placementReasons = [
    ...(massing.status === "PLACED" ? [] : massing.reasons),
    ...(parking.status === "PLACED" ? [] : parking.reasons),
  ];

  const placementSummary =
    args.refused !== undefined
      ? `REQUEST REFUSED — ${args.refused.requestedTarget} homes is above the modeled upper bound (${args.refused.upperBoundHomes}). The ghost shows the attempted program; it is NOT buildable.`
      : placementStatus === "PLACED"
        ? `Conceptual site plan placed: building footprint ${point.footprintSqFt.toLocaleString("en-US")} sq ft (${point.floors} floors) + ${point.parkingStalls} parking stalls, all mechanically validated. ASSUMPTION_DERIVED — not architecture.`
        : placementStatus === "PARTIAL"
          ? `Building footprint placed (${point.footprintSqFt.toLocaleString("en-US")} sq ft × ${point.floors} floors), but the ${point.parkingStalls}-stall parking layout could not be proven — the modeled numbers stand, PLACEMENT NOT FULLY PROVEN.`
          : `PLACEMENT NOT PROVEN — ${massing.reasons[0] ?? "no validated layout"}.`;

  const volumes: ScenarioVolumeScene[] = massing.pieces.map((piece, i) => ({
    id: `${record?.scenarioId ?? "scenario"}:volume:${i}`,
    label: `${label} — massing ${i + 1}`,
    polygon: piece.polygon,
    heightFt,
    status: args.refused !== undefined ? "CONFLICT" : massing.status === "PLACED" ? "VALID" : "UNRESOLVED",
    statusDetail:
      args.refused !== undefined
        ? `NOT BUILDABLE — requested ${args.refused.requestedTarget} homes exceeds the modeled upper bound ${args.refused.upperBoundHomes}. ${args.refused.explanation}`
        : massing.status === "PLACED"
          ? `ASSUMPTION_DERIVED conceptual massing (${massing.strategy}). Inside the law-informed planning envelope, clear of the sanctuary, exact aggregate area.`
          : `PLACEMENT NOT PROVEN — ${massing.reasons.join("; ")}.`,
    constraintResultIds: [],
    provenance: [
      ...(record ? [provenance(record.scenarioId, "scenario", "Scenario node")] : []),
      ...(record?.certificateId ? [provenance(record.certificateId, "scenario-certificate", "Certificate")] : []),
      provenance(
        "assumption:planning-envelope-uniform-setback",
        "assumption",
        "Planning envelope assumption",
      ),
    ],
  }));

  notes.push(
    `${label}: homes ${point.homes}, floors ${point.floors}, footprint ${point.footprintSqFt.toLocaleString("en-US")} sq ft, stalls ${point.parkingStalls} → massing ${massing.status} (${massing.strategy}); parking ${parking.status}${parking.status === "PLACED" ? ` (${parking.fields.map((f) => `${f.stalls} stalls`).join(" + ")})` : `: ${parking.reasons[0] ?? "unresolved"}`}.`,
  );

  return {
    scenarioId: record?.scenarioId ?? `requested:${point.homes}:refused`,
    label,
    status: args.refused !== undefined ? "REFUSED" : "COMPUTED",
    certificateId: record?.certificateId ?? null,
    volumes,
    metrics: [
      { metricId: "homes", label: "Homes", value: String(point.homes) },
      { metricId: "floors", label: "Floors", value: String(point.floors) },
      { metricId: "footprint", label: "Footprint", value: `${point.footprintSqFt.toLocaleString("en-US")} sq ft` },
      { metricId: "parking-stalls", label: "Parking stalls", value: String(point.parkingStalls) },
    ],
    freshness: record?.freshness,
    confidence:
      args.refused !== undefined ? "NO_VERIFIED_SOLUTION" : String(scenario.confidence),
    placement: {
      status: placementStatus,
      summary: placementSummary,
      reasons: placementReasons,
    },
    parking: parkingPlanScene,
    point: {
      homes: point.homes,
      parkingStalls: point.parkingStalls,
      parkingMargin: point.parkingMargin,
      footprintSqFt: point.footprintSqFt,
      floors: point.floors,
    },
  };
}
