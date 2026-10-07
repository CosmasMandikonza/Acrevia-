/**
 * Development Graph / Scenario -> SpatialSceneModel adapter (ADR 0008).
 *
 * This is where zoning semantics end. The adapter reads the graph through
 * the public domain surface (`selectExecutableConstraints`, `nodesOfKind`)
 * plus the Scenario-compatible massing fixture, derives every visible
 * polygon EXPLICITLY (setbacks, occupied-area cap, mission clips, parking
 * placement, cameras), and emits the pure SpatialSceneModel the renderer
 * consumes. Nothing here mutates the project.
 *
 * Derivation rules (documented for ADR 0008; each also lands in
 * `derivationNotes` on the model):
 * - Frame: local ENU feet anchored at the parcel ring's shoelace centroid.
 * - Frontage: parcel edges within 60 ft of the published address geocode
 *   hint. The hint is used ONLY for orientation (which way the street is),
 *   never as geometry or parcel identity — GIS hint-not-truth discipline.
 * - Faces: frontage edges = front (contextual in RM-1); the longest
 *   non-frontage edge = rear; every other edge = side.
 * - Maximum legal envelope: minimum derivable setbacks (side range uses its
 *   min, rear its numeric min; contextual front contributes no plane and is
 *   shown as unresolved), then the occupied-area cap as a deterministic
 *   bisection trim advancing from the longest frontage edge.
 * - Lot type is not in the graph, so the cap uses the conservative
 *   intermediate-lot percentage.
 * - Mission envelope: legal envelope minus preserved structures minus the
 *   derived parking field, height-capped by the mission max-height.
 * - Scenario volumes are VALIDATED here: a volume outside the mission
 *   envelope or above the cap is rendered as CONFLICT regardless of what
 *   the fixture claims.
 */

import {
  nodesOfKind,
  type Project,
} from "../../domain";
import { selectExecutableConstraints } from "../../application/regulatory/executable";
import { frameAt, toLocal, type LocalFrame } from "./projection";
import {
  areaOf,
  bboxOf,
  difference,
  edgeFrame,
  geojsonToScenePolygon,
  intersection,
  orientedRect,
  ringCentroid,
  toCcw,
  totalAreaSqFt,
  trimToArea,
} from "./geometry2d";
import {
  SPATIAL_SCENE_SCHEMA_VERSION,
  type EnvelopeScene,
  type MissionClipScene,
  type MissionEnvelopeScene,
  type ParkingFieldScene,
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
import type { SpikeMassingFixture } from "./massing-fixture";

const FRONTAGE_HINT_MAX_DIST_FT = 60;
const STALL_WIDTH_FT = 9;
const STALL_DEPTH_FT = 18;
const AISLE_FT = 24;

export interface BuildSceneInput {
  project: Project;
  massing: SpikeMassingFixture;
  /** Published address geocode point (orientation only — never geometry). */
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

export function buildSpatialScene(input: BuildSceneInput): SpatialSceneModel {
  const notes: string[] = [];
  const project = input.project;

  // --- Parcel ---------------------------------------------------------------
  const parcels = nodesOfKind(project, "parcel");
  if (parcels.length !== 1) {
    throw new Error(`spatial adapter: expected exactly one parcel, got ${parcels.length}`);
  }
  const parcelNode = parcels[0] as unknown as {
    id: string;
    geometry: { geojson: unknown };
    recordedArea?: { value: number; unit: string };
  };
  const parcelPolygon = geojsonToScenePolygon(parcelNode.geometry.geojson as never);
  const frame = anchorFrameFor(parcelNode.geometry.geojson as never);
  // Project every ring into the local feet frame (x east, y north).
  const projectRing = (ring: Vec2[]): Vec2[] => toCcw(ring.map((p) => toLocal(frame, p.x, p.y)));
  const parcelRing = projectRing(parcelPolygon.exterior);
  const parcelHoles = (parcelPolygon.holes ?? []).map(projectRing);
  const parcelLocal: ScenePolygon = {
    exterior: parcelRing,
    holes: parcelHoles,
  };
  const parcelAreaSqFt = totalAreaSqFt([parcelLocal]);
  notes.push(
    `Parcel projected to local feet at ring centroid; computed area ${parcelAreaSqFt.toFixed(0)} sq ft vs recorded ${parcelNode.recordedArea?.value ?? "n/a"} sq ft.`,
  );

  const bbox = bboxOf(parcelRing);
  const diagonalFt = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const centroid = ringCentroid(parcelRing);

  // --- Address hint (orientation only) --------------------------------------
  const hint = toLocal(frame, input.addressHint.lon, input.addressHint.lat);

  // --- Structures -------------------------------------------------------------
  const missionNodes = nodesOfKind(project, "mission-constraint").map((n) => {
    const node = n as unknown as {
      id: string;
      intentText: string;
      confirmationState: string;
      hardOrSoft: string;
      normalized: { type: string; structureId?: string; limit?: { value: number }; spaces?: { value: number } };
    };
    return node;
  });
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

  const structures: StructureScene[] = [];
  for (const node of nodesOfKind(project, "structure")) {
    const s = node as unknown as {
      id: string;
      parcelId: string;
      footprint?: { geojson: unknown };
    };
    if (s.footprint?.geojson) {
      const poly = geojsonToScenePolygon(s.footprint.geojson as never);
      const height = structureHeightFt(project, s.id);
      const protectedByMission = preserveIds.has(s.id);
      structures.push({
        id: `structure:${s.id}`,
        structureId: s.id,
        name: structureName(project),
        polygon: {
          exterior: projectRing(poly.exterior),
          holes: (poly.holes ?? []).map(projectRing),
        },
        heightFt: height ?? 0,
        protectedByMission,
        label: protectedByMission ? "Sanctuary — protected by mission" : "Existing structure",
        provenance: [
          provenance(s.id, "structure", "Structure node"),
          ...(height === null
            ? []
            : [provenance("building-height claim", "claim", "Building height claim")]),
        ],
      });
      if (height === null) {
        notes.push(`Structure ${s.id}: no building-height claim — height UNRESOLVED (rendered flat).`);
      }
    } else {
      notes.push(`Structure ${s.id}: no footprint geometry in the graph — not rendered (honest gap).`);
    }
  }

  // --- Executable constraints (solver gate) ----------------------------------
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

  // --- Frontage classification ------------------------------------------------
  const frontageEdgeIdx: number[] = [];
  for (let i = 0; i < parcelRing.length; i += 1) {
    const a = parcelRing[i];
    const b = parcelRing[(i + 1) % parcelRing.length];
    if (edgeFrame(a, b).length < 80) continue; // serrated micro-edges never front a street
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(mid.x - hint.x, mid.y - hint.y);
    // distance to either endpoint counts too (hint may sit beyond the edge)
    const dEnd = Math.min(
      Math.hypot(a.x - hint.x, a.y - hint.y),
      Math.hypot(b.x - hint.x, b.y - hint.y),
    );
    if (Math.min(d, dEnd) <= FRONTAGE_HINT_MAX_DIST_FT) {
      frontageEdgeIdx.push(i);
    }
  }
  if (frontageEdgeIdx.length === 0) {
    // Honest fallback: longest edge fronts the street.
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
    notes.push("Frontage: no edge within 60 ft of the address hint — fell back to the longest edge.");
  } else {
    notes.push(
      `Frontage: edges ${frontageEdgeIdx.join(", ")} lie within ${FRONTAGE_HINT_MAX_DIST_FT} ft of the published address point (orientation only, never geometry).`,
    );
  }
  const frontageSet = new Set(frontageEdgeIdx);

  // Face classification: rear = longest non-frontage edge, rest = side.
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
    const c = setbackConstraints.find(
      (x) => (x as unknown as { face: string }).face === face,
    ) as (ConstraintNode & { face: string; spec: { type: string; min?: { value: number }; range?: { min: number; max: number } } }) | undefined;
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
      note: `Contextual ${face} setback — no numeric plane derivable from the graph; front plane stays at the parcel line until #7 resolves the blockface.`,
    };
  };

  const setbacks = [
    appliedSetbackFor("front"),
    appliedSetbackFor("side"),
    appliedSetbackFor("rear"),
  ].filter((s): s is SetbackScene => s !== null);

  // --- Legal envelope ----------------------------------------------------------
  let legalEnvelope: EnvelopeScene | null = null;
  let setbackOnly: ScenePolygon[] = [];
  const annotations: SceneAnnotation[] = [];

  if (legalHeightFt === null) {
    notes.push("Legal envelope: no executable height constraint — envelope UNRESOLVED.");
  } else {
    // Setback strips are finite quads along each edge (an infinite
    // half-plane per edge would gut the parcel at concave serrations).
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
      envelopeParts = envelopeParts.flatMap((p) => difference(p, strip));
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
      // Trim advances from the LONGEST frontage edge (front placement is the
      // unresolved contextual plane, so the envelope yields there first).
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
      const { n } = edgeFrame(fa, fb); // outward
      const c = fa.x * n.x + fa.y * n.y;
      // Trim the largest part from the frontage (single-part expected on the
      // canonical parcel; multi-part envelopes keep their smaller parts).
      const partsByArea = [...setbackOnly].sort((p, q) => totalAreaSqFt([q]) - totalAreaSqFt([p]));
      const main = partsByArea[0] ?? { exterior: parcelRing };
      const trimmed = trimToArea(main, n, c - diagonalFt, c, target - (setbackArea - totalAreaSqFt([main])));
      if (trimmed) {
        envelopePolygons = [...partsByArea.slice(1), ...trimmed.polygons];
        bindingNotes = [
          `Occupied-area cap ${capPct}% (intermediate lot — conservative; lot type not in graph) binds at ${target.toFixed(0)} sq ft; envelope trimmed ${(c - trimmed.offset).toFixed(1)} ft back from the Roosevelt frontage.`,
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
        "Edge roles (frontage from the address hint, rear = longest non-frontage edge) are a visualization heuristic — lot-line roles are not yet classified in trusted state. The height max and occupied-area percentage are sourced law; the setback polygon is assumption-derived.",
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
      text: `${legalHeightFt} ft — zoning height max (RM-1)`,
      at: { x: bbox.minX + 12, y: bbox.minY + 12 },
      elevationFt: legalHeightFt,
    });
  }

  // --- Parking field (mission-derived) ---------------------------------------
  let parking: ParkingFieldScene | null = null;
  let parkingLocal: ScenePolygon | null = null;
  if (missionParking) {
    const spaces = missionParking.normalized.spaces?.value ?? 0;
    // Deterministic placement search: row counts ascending, frontage edges
    // longest-first, then along-edge position, then inward depth.
    const frontagesSorted = [...frontageEdgeIdx].sort((i, j) => {
      const lenOf = (k: number) =>
        edgeFrame(parcelRing[k], parcelRing[(k + 1) % parcelRing.length]).length;
      return lenOf(j) - lenOf(i);
    });
    const layouts = [2, 3, 4, 5, 6]
      .map((rows) => {
        const perRow = Math.ceil(spaces / rows);
        return {
          rows,
          perRow,
          blockLen: perRow * STALL_WIDTH_FT,
          blockDepth: rows * STALL_DEPTH_FT + (rows - 1) * AISLE_FT,
        };
      })
      .filter((l) => l.blockLen > 0);
    outer: for (const { rows, perRow, blockLen, blockDepth } of layouts) {
      const blockArea = blockLen * blockDepth;
      for (const edgeIdx of frontagesSorted) {
        const a = parcelRing[edgeIdx];
        const b = parcelRing[(edgeIdx + 1) % parcelRing.length];
        const { u, n, length } = edgeFrame(a, b);
        const inward = { x: -n.x, y: -n.y };
        for (let s = 0; s + blockLen <= length; s += 10) {
          for (let d = 12; d <= 160; d += 4) {
            const origin = {
              x: a.x + u.x * s + inward.x * d,
              y: a.y + u.y * s + inward.y * d,
            };
            const rect: ScenePolygon = {
              exterior: orientedRect(origin, { x: u.x * blockLen, y: u.y * blockLen }, { x: inward.x * blockDepth, y: inward.y * blockDepth }),
            };
            const insideParcel = totalAreaSqFt(intersection(rect, parcelLocal));
            if (insideParcel < blockArea - 1) continue;
            let hitsStructure = false;
            for (const st of structures) {
              if (totalAreaSqFt(intersection(rect, st.polygon)) > 1) {
                hitsStructure = true;
                break;
              }
            }
            if (hitsStructure) continue;
            if (totalAreaSqFt(intersection(rect, { exterior: setbackOnly[0]?.exterior ?? parcelRing })) < blockArea - 1) {
              continue;
            }
            parkingLocal = rect;
            parking = {
              id: `parking:${missionParking.id}`,
              label: `Mission parking — ${spaces} surface stalls`,
              polygon: rect,
              areaSqFt: blockArea,
              stalls: { count: spaces, widthFt: STALL_WIDTH_FT, depthFt: STALL_DEPTH_FT, aisleFt: AISLE_FT },
              requirementLabel: `min ${spaces} spaces (mission)`,
              missionConstraintId: missionParking.id,
              provenance: [provenance(missionParking.id, "mission-constraint", "Mission min-parking")],
            };
            notes.push(
              `Parking field: ${spaces} stalls as ${rows} row(s) of ${perRow} (${blockLen} x ${blockDepth} ft = ${blockArea.toFixed(0)} sq ft), first-fit placement along frontage edge ${edgeIdx} at ${d} ft depth (search is deterministic: rows ascending, longest frontage, then along-edge, then depth).`,
            );
            break outer;
          }
        }
      }
    }
    if (!parking) {
      notes.push(
        `Parking field UNRESOLVED: no deterministic rectangular placement for ${spaces} stalls fits the setback strips without overlapping the preserved sanctuary (searched 2-6 rows along every frontage). The canonical mission's parking requirement is real; this spike's surface-lot heuristic cannot design it — solver #7 owns the parking geometry (podium/structured/multi-field). Nothing is subtracted from the mission envelope for parking.`,
      );
    }
  }

  // --- Mission envelope ---------------------------------------------------------
  let missionEnvelope: MissionEnvelopeScene | null = null;
  if (legalEnvelope && legalHeightFt !== null) {
    const missionHeight = Math.min(legalHeightFt, missionMaxHeight);
    const preservedPolys = structures
      .filter((s) => s.protectedByMission)
      .map((s) => s.polygon);
    let missionPolys = legalEnvelope.polygons;
    const clips: MissionClipScene[] = [];

    for (const poly of preservedPolys) {
      for (const envPoly of missionPolys) {
        for (const piece of intersection(envPoly, poly)) {
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
      missionPolys = missionPolys.flatMap((p) => difference(p, poly));
    }

    if (parkingLocal && parking) {
      for (const envPoly of missionPolys) {
        for (const piece of intersection(envPoly, parkingLocal)) {
          if (totalAreaSqFt([piece]) > 1) {
            clips.push({
              id: `clip:parking:${parking.id}`,
              label: "Surface parking reservation",
              polygon: piece,
              fromFt: 0,
              toFt: missionHeight,
              missionConstraintId: parking.missionConstraintId ?? "",
              note: "Mission min-parking reserves this ground area.",
            });
          }
        }
      }
      missionPolys = missionPolys.flatMap((p) => difference(p, parkingLocal));
    }

    if (missionHeight < legalHeightFt) {
      for (const envPoly of missionPolys) {
        clips.push({
          id: `clip:height:${envPoly.exterior[0].x.toFixed(1)}-${envPoly.exterior[0].y.toFixed(1)}`,
          label: `Mission height cap ${missionHeight} ft (below sanctuary roofline)`,
          polygon: envPoly,
          fromFt: missionHeight,
          toFt: legalHeightFt,
          missionConstraintId:
            confirmedMissions.find((m) => m.normalized.type === "max-height")?.id ?? "",
          note: `Mission max-height removes the ${missionHeight}–${legalHeightFt} ft slab.`,
        });
      }
      notes.push(
        `Mission height cap: ${missionHeight} ft (mission max-height below the ${legalHeightFt} ft legal max) clips the envelope's upper slab.`,
      );
    }

    const missionArea = totalAreaSqFt(missionPolys);
    missionEnvelope = {
      polygons: missionPolys,
      heightFt: missionHeight,
      areaSqFt: missionArea,
      volumeCuFt: missionArea * missionHeight,
      verification: "ASSUMPTION_DERIVED",
      verificationNote: `${legalEnvelope.verificationNote} Mission clips remove confirmed preserve-structure footprints${parking ? " and the derived parking field" : ""}; no numeric mission height cap exists in the canonical flow.`,
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
      `Mission envelope: ${missionArea.toFixed(0)} sq ft at ${missionHeight} ft (${((missionArea / legalEnvelope.areaSqFt) * 100).toFixed(0)}% of legal footprint, ${((missionArea * missionHeight) / legalEnvelope.volumeCuFt * 100).toFixed(0)}% of legal volume).`,
    );
  }

  // --- Scenario massing (validated) ---------------------------------------------
  const scenarios: ScenarioScene[] = [];
  for (const fixtureScenario of input.massing.scenarios) {
    const scenarioNode = nodesOfKind(project, "scenario").find(
      (n) => (n as unknown as { id: string }).id === fixtureScenario.scenarioId,
    ) as unknown as
      | { id: string; label: string; status: string; certificateId?: string; metrics: { metricId: string; label: string; value: { value: number | null; unit: string } | null }[]; constraintResultIds: string[] }
      | undefined;
    const volumes: ScenarioVolumeScene[] = [];
    for (const v of fixtureScenario.volumes) {
      // Project the WGS84 footprint into the local feet frame.
      const exterior = (v.geometry.coordinates[0] ?? [])
        .slice(0, -1)
        .map(([lon, lat]) => toLocal(frame, lon, lat));
      const volArea = areaOf(exterior);

      const reasons: string[] = [];
      let status: ScenarioVolumeScene["status"] = "VALID";
      if (scenarioNode?.status === "REFUSED" || scenarioNode?.status === "FAILED") {
        status = "CONFLICT";
        reasons.push(`scenario ${scenarioNode.status} in the graph`);
      }
      if (legalEnvelope && v.heightFt > legalEnvelope.heightFt) {
        status = "CONFLICT";
        reasons.push(`height ${v.heightFt} ft exceeds the ${legalEnvelope.heightFt} ft legal max`);
      }
      if (missionEnvelope && v.heightFt > missionEnvelope.heightFt && status !== "CONFLICT") {
        status = "CONFLICT";
        reasons.push(`height ${v.heightFt} ft exceeds the ${missionEnvelope.heightFt} ft mission cap`);
      }
      if (missionEnvelope) {
        const inside = missionEnvelope.polygons.reduce(
          (sum, p) => sum + totalAreaSqFt(intersection({ exterior }, p)),
          0,
        );
        if (inside < volArea - 1) {
          status = "CONFLICT";
          reasons.push(
            `only ${inside.toFixed(0)} of ${volArea.toFixed(0)} sq ft lies inside the mission envelope`,
          );
        }
      }
      volumes.push({
        id: v.volumeId,
        label: v.label,
        polygon: { exterior },
        heightFt: v.heightFt,
        status,
        statusDetail:
          status === "VALID"
            ? "Inside the mission envelope at or below every cap."
            : `NOT BUILDABLE — ${reasons.join("; ")}.`,
        constraintResultIds: scenarioNode?.constraintResultIds ?? [],
        provenance: [
          provenance(fixtureScenario.scenarioId, "scenario", "Scenario node"),
          ...(scenarioNode?.certificateId
            ? [provenance(scenarioNode.certificateId, "scenario-certificate", "Certificate")]
            : []),
        ],
      });
    }
    scenarios.push({
      scenarioId: fixtureScenario.scenarioId,
      label: scenarioNode?.label ?? fixtureScenario.scenarioId,
      status: scenarioNode?.status ?? "UNKNOWN",
      certificateId: scenarioNode?.certificateId ?? null,
      volumes,
      metrics: (scenarioNode?.metrics ?? []).map((m) => ({
        metricId: m.metricId,
        label: m.label,
        value: m.value === null || m.value === undefined ? null : `${m.value.value} ${m.value.unit}`,
      })),
    });
  }

  // --- Cameras (all derived from geometry — deterministic) ----------------------
  const sceneX = (p: Vec2): number => p.x;
  const sceneZ = (p: Vec2): number => -p.y; // north => -Z
  const center = { x: sceneX(centroid), z: sceneZ(centroid) };
  const sanctuary = structures[0];
  const sanctCenter = sanctuary ? ringCentroid(sanctuary.polygon.exterior) : centroid;

  // Average outward normal of the frontage (weighted by edge length).
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

  const cameras: SavedCamera[] = [
    {
      id: "camera:aerial",
      label: "Aerial",
      position: { x: center.x + diagonalFt * 0.5, y: diagonalFt * 0.58, z: center.z + diagonalFt * 0.6 },
      target: { x: center.x, y: 6, z: center.z },
      fovDeg: 40,
      note: "Parcel-fit aerial: offset is half/three-fifths of the bbox diagonal SE-up.",
    },
    {
      id: "camera:entry",
      label: "Church entry",
      position: {
        x: sceneX(sanctCenter) + frontOut.x * diagonalFt * 0.4,
        y: 26,
        z: sceneZ(sanctCenter) - frontOut.y * diagonalFt * 0.4,
      },
      target: { x: sceneX(sanctCenter), y: 16, z: sceneZ(sanctCenter) },
      fovDeg: 42,
      note: "From the Roosevelt frontage toward the sanctuary, 26 ft eye line.",
    },
    {
      id: "camera:pedestrian",
      label: "Pedestrian",
      position: { x: hint.x, y: 5.5, z: sceneZ(hint) },
      target: { x: sceneX(sanctCenter), y: 22, z: sceneZ(sanctCenter) },
      fovDeg: 46,
      note: "Eye height 5.5 ft at the published address point on the boulevard sidewalk.",
    },
    {
      id: "camera:neighbor",
      label: "Neighbor",
      position: {
        x: center.x - frontOut.x * diagonalFt * 0.5,
        y: 22,
        z: center.z + frontOut.y * diagonalFt * 0.5,
      },
      target: { x: center.x, y: 10, z: center.z },
      fovDeg: 44,
      note: "From across the rear/side property line looking back at the site.",
    },
  ];

  // --- Assemble ---------------------------------------------------------------
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
      label: "Calvary Memorial Church parcel",
      polygon: parcelLocal,
      computedAreaSqFt: parcelAreaSqFt,
      recordedAreaSqFt: parcelNode.recordedArea?.value ?? null,
      provenance: [provenance(parcelNode.id, "parcel", "Parcel node")],
    },
    structures,
    frontage: {
      edgeIndices: frontageEdgeIdx.map((i) => [i, (i + 1) % parcelRing.length] as [number, number]),
      streetLabel: "E Roosevelt Blvd",
      derivation:
        "Edges within 60 ft of the published address geocode point (orientation only, never geometry).",
    },
    legalEnvelope,
    missionEnvelope,
    parking,
    scenarios,
    heightPlaneFt: legalHeightFt,
    heightPlaneProvenance: legalEnvelope?.provenance.slice(0, 2) ?? [],
    annotations,
    cameras,
    derivationNotes: notes,
  };
}

// --- helpers -----------------------------------------------------------------

function provenance(nodeId: string, nodeKind: string, label: string): ProvenanceRef {
  return { nodeId, nodeKind, label };
}

/**
 * Recover the WGS84 anchor: the projection origin is defined as the ring
 * centroid, so we compute the centroid in WGS84 directly (shoelace over
 * lon/lat is adequate because the parcel is ~500 ft across).
 */
function anchorFrameFor(geometry: unknown): LocalFrame {
  const geo = geometry as { type: string; coordinates: unknown };
  let coords: number[][];
  if (geo.type === "MultiPolygon") {
    coords = (geo.coordinates as number[][][][])[0][0];
  } else {
    coords = (geo.coordinates as number[][][])[0];
  }
  const pts = coords.map(([lon, lat]) => ({ x: lon, y: lat }));
  const c = ringCentroidAreaAware(pts);
  return frameAt(c.x, c.y);
}

function ringCentroidAreaAware(pts: Vec2[]): Vec2 {
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
  if (Math.abs(a) < 1e-15) {
    return ringMean(pts);
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function ringMean(pts: Vec2[]): Vec2 {
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

function structureHeightFt(project: Project, structureId: string): number | null {
  const claim = nodesOfKind(project, "claim").find(
    (n) => {
      const c = n as unknown as { subjectNodeId: string; predicate: string };
      return c.subjectNodeId === structureId && c.predicate === "building-height";
    },
  ) as unknown as { value: { type: string; quantity?: { value: number } } } | undefined;
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
