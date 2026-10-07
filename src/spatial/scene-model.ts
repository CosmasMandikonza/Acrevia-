/**
 * SpatialSceneModel — the renderer boundary for Acrevia Forge (ADR 0008).
 *
 * Everything the 3D renderer is allowed to know lives here as pure data:
 * projected polygons in a local east-north frame, feet, no domain enums, no
 * zoning vocabulary beyond display labels the adapter already derived. The
 * renderer never imports from `src/domain` or `src/commands` (enforced by
 * tests/spatial/isolation.test.ts); the model is the ONLY contract between
 * Development Graph / Scenario state and any renderer (WebGL, SVG, export).
 *
 * Frame convention:
 * - origin: the parcel ring's shoelace centroid (WGS84), recorded in `frame`
 * - plan coordinates: `Vec2` = { x: feet east of origin, y: feet north }
 * - polygons: CCW exterior, CW holes, closed (first point NOT repeated)
 * - heights/lengths in feet; areas in square feet
 *
 * Determinism: building the model twice from the same graph + scenario
 * inputs must produce a byte-identical canonical JSON (no timestamps, no
 * randomness, no iteration-order dependence). tests/spatial asserts this.
 */

export const SPATIAL_SCENE_SCHEMA_VERSION = "acrevia.spatial.scene.v1";

export interface Vec2 {
  x: number;
  y: number;
}

export interface ScenePolygon {
  /** CCW exterior ring, NOT auto-closed. */
  exterior: Vec2[];
  /** CW hole rings. */
  holes?: Vec2[][];
}

/** A polygonal footprint extruded from ground to `heightFt`. */
export interface SceneVolume {
  id: string;
  label: string;
  polygon: ScenePolygon;
  heightFt: number;
  baseFt?: number;
}

export type SceneStatus =
  | "VALID" // computed and satisfied every evaluated constraint
  | "CONFLICT" // fails at least one binding constraint — never render as buildable
  | "PROTECTED" // existing structure preserved by mission — not developable
  | "UNRESOLVED"; // derivation could not complete — honest gap, not an error

/** Reference back into the Development Graph for click-to-evidence UX. */
export interface ProvenanceRef {
  nodeId: string;
  nodeKind: string;
  label: string;
}

export interface ParcelScene {
  id: string;
  label: string;
  polygon: ScenePolygon;
  computedAreaSqFt: number;
  recordedAreaSqFt: number | null;
  provenance: ProvenanceRef[];
}

export interface StructureScene extends SceneVolume {
  structureId: string;
  name: string;
  /** True when a confirmed mission constraint preserves this structure. */
  protectedByMission: boolean;
  provenance: ProvenanceRef[];
}

/** How each setback face was derived for THIS parcel. */
export interface SetbackScene {
  face: "front" | "side" | "rear";
  /** Numeric feet applied to the envelope; null when not derivable. */
  appliedFt: number | null;
  specType: "numeric" | "range" | "contextual";
  /** For ranges: the min actually used for a maximum envelope. */
  rangeMinFt: number | null;
  rangeMaxFt: number | null;
  constraintId: string | null;
  note: string;
}

/**
 * How much of an envelope's geometry is trusted (ADR 0008 truth labels).
 * Law-derived scalars (height max, occupied-area cap) can be sourced while
 * the edge-role geometry that shapes the polygon remains a heuristic — the
 * two are stated separately so a renderer can never present an
 * assumption-derived polygon as verified legal geometry.
 */
export type EnvelopeVerification = "VERIFIED" | "ASSUMPTION_DERIVED" | "UNRESOLVED";

export interface EnvelopeScene {
  /**
   * One or more disjoint buildable footprints (boolean subtraction of
   * setbacks/protected volumes can split the envelope).
   */
  polygons: ScenePolygon[];
  heightFt: number;
  areaSqFt: number;
  volumeCuFt: number;
  /** Trust level of the polygon itself (edge roles / setback application). */
  verification: EnvelopeVerification;
  /** Plain-language reason for the verification level. */
  verificationNote: string;
  setbacks: SetbackScene[];
  /** e.g. occupied-area cap trimmed the geometric envelope. */
  bindingNotes: string[];
  provenance: ProvenanceRef[];
}

/** A piece of the legal envelope removed by a mission constraint. */
export interface MissionClipScene {
  id: string;
  label: string;
  polygon: ScenePolygon;
  /** Vertical extent of the removed slice. */
  fromFt: number;
  toFt: number;
  missionConstraintId: string;
  note: string;
}

export interface MissionEnvelopeScene extends EnvelopeScene {
  clips: MissionClipScene[];
}

export interface ParkingFieldScene {
  id: string;
  label: string;
  polygon: ScenePolygon;
  areaSqFt: number;
  stalls: { count: number; widthFt: number; depthFt: number; aisleFt: number };
  requirementLabel: string;
  missionConstraintId: string | null;
  provenance: ProvenanceRef[];
}

export interface ScenarioVolumeScene extends SceneVolume {
  status: SceneStatus;
  statusDetail: string;
  constraintResultIds: string[];
  provenance: ProvenanceRef[];
}

export interface ScenarioScene {
  scenarioId: string;
  label: string;
  /** Copied from the graph scenario node — never invented here. */
  status: string;
  certificateId: string | null;
  volumes: ScenarioVolumeScene[];
  metrics: { metricId: string; label: string; value: string | null }[];
}

export interface SavedCamera {
  id: string;
  label: string;
  /** Camera eye in scene coordinates (x east, y up, z = -north). */
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fovDeg: number;
  note: string;
}

export interface SceneAnnotation {
  id: string;
  kind: "height-plane" | "setback" | "area" | "status";
  text: string;
  /** Anchor in plan coordinates at the given elevation. */
  at: Vec2;
  elevationFt: number;
}

export interface SpatialSceneModel {
  schemaVersion: typeof SPATIAL_SCENE_SCHEMA_VERSION;
  unit: "ft";
  frame: {
    /** WGS84 anchor the plan coordinates are relative to. */
    origin: { lon: number; lat: number };
    description: string;
  };
  title: string;
  subtitle: string;
  parcel: ParcelScene;
  structures: StructureScene[];
  frontage: {
    /** Indices into the parcel's CCW exterior ring: [start, end] pairs. */
    edgeIndices: [number, number][];
    streetLabel: string | null;
    derivation: string;
  };
  legalEnvelope: EnvelopeScene | null;
  missionEnvelope: MissionEnvelopeScene | null;
  parking: ParkingFieldScene | null;
  scenarios: ScenarioScene[];
  heightPlaneFt: number | null;
  heightPlaneProvenance: ProvenanceRef[];
  annotations: SceneAnnotation[];
  cameras: SavedCamera[];
  /** Human-readable derivation trail — the spike's audit surface. */
  derivationNotes: string[];
}

export function polygonAreaSqFt(polygon: ScenePolygon): number {
  const ring = polygon.exterior;
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const q = ring[(i + 1) % ring.length];
    a += ring[i].x * q.y - q.x * ring[i].y;
  }
  let holes = 0;
  for (const hole of polygon.holes ?? []) {
    let h = 0;
    for (let i = 0; i < hole.length; i += 1) {
      const q = hole[(i + 1) % hole.length];
      h += hole[i].x * q.y - q.x * hole[i].y;
    }
    holes += Math.abs(h / 2);
  }
  return Math.abs(a / 2) - holes;
}

export function sceneVolumeCuFt(volume: SceneVolume, polygonArea = polygonAreaSqFt(volume.polygon)): number {
  return polygonArea * (volume.heightFt - (volume.baseFt ?? 0));
}
