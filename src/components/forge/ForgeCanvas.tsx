"use client";

/**
 * Forge production renderer (issue #9) — React Three Fiber scene that
 * consumes ONLY the SpatialSceneModel. It knows nothing about regulations
 * or project state: every volume, plane, status, and label arrives as
 * derived data from the adapter (enforced by the strengthened isolation
 * test). Improvements over the spike: floor-band massing (stories read at
 * a glance), a ground grid for scale, a draggable before/after reveal via
 * clipping planes, per-scenario parking fields, and honest refused-mass
 * treatment. Reduced motion snaps cameras instantly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type {
  MissionClipScene,
  SavedCamera,
  ScenarioVolumeScene,
  SpatialSceneModel,
  StructureScene,
  ParkingFieldScene,
} from "@/spatial/scene-model";
import { palette as SpikePalette, opacity as O } from "@/spatial/renderer/theme";
import { edgesOf, extrudedVolume, footprintOutline } from "@/spatial/renderer/scene-geometry";
import type { Moment, Selection } from "./forge-shared";

export type { Moment, Selection };

/**
 * Forge palette — the spike's token vocabulary with production massing
 * separation (visual-QA round: the scenario mass and the existing
 * sanctuary were near-identical ivories). Existing structures read as
 * stone; the scenario mass reads as warm study-model card; conflicts stay
 * rust. Every color still means a state.
 */
const C = {
  ...SpikePalette,
  structureWall: "#d9d5c2", // darker stone so existing vs new never reads as one
  scenarioFill: "#f3ead0", // warm card stock — clearly distinct from structures
  scenarioEdge: "#4a4432",
};

export interface CanvasController {
  moment: Moment;
  scenarioId: string;
  cameraId: string;
  cameraNonce: number;
  onCameraSettled: (id: string) => void;
  onUserInteract: () => void;
  onSelect: (s: Selection) => void;
  onFirstFrame: () => void;
  compare: { enabled: boolean; fraction: number };
}

function flatGeometry(polygon: { exterior: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(
    new THREE.Shape(polygon.exterior.map((p) => new THREE.Vector2(p.x, p.y))),
  );
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function probeWebgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

export default function ForgeCanvas({
  model,
  controller,
  stale = false,
}: {
  model: SpatialSceneModel;
  controller: CanvasController;
  stale?: boolean;
}) {
  const [webglOk] = useState<boolean>(() => probeWebgl());
  const reducedMotion = useReducedMotion();

  const bbox = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of model.parcel.polygon.exterior) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }, [model]);
  const diagonal = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);

  if (!webglOk) {
    // Parent decides fallback rendering; this component refuses to fake 3D.
    return null;
  }

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 40, near: 1, far: diagonal * 12, position: [0, diagonal, 0] }}
      className="forge-canvas-root"
      data-testid="forge-canvas"
      onCreated={({ gl, scene }) => {
        gl.localClippingEnabled = true;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.background = new THREE.Color(C.sky);
        scene.fog = new THREE.Fog(C.sky, diagonal * 1.7, diagonal * 5.2);
      }}
    >
      <SceneContent
        model={model}
        controller={controller}
        bbox={bbox}
        diagonal={diagonal}
        stale={stale}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  );
}

function SceneContent({
  model,
  controller,
  bbox,
  diagonal,
  stale,
  reducedMotion,
}: {
  model: SpatialSceneModel;
  controller: CanvasController;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  diagonal: number;
  stale: boolean;
  reducedMotion: boolean;
}) {
  const first = useRef(true);
  useFrame(() => {
    if (first.current) {
      first.current = false;
      controller.onFirstFrame();
    }
  });

  const center = { x: (bbox.minX + bbox.maxX) / 2, z: -(bbox.minY + bbox.maxY) / 2 };

  // Before/after reveal: a deterministic world-x curtain.
  const { enabled: compareOn, fraction } = controller.compare;
  const revealX = bbox.minX - 10 + (bbox.maxX - bbox.minX + 20) * fraction;
  const leftPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(1, 0, 0), -revealX),
    [revealX],
  );
  const rightPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(-1, 0, 0), revealX),
    [revealX],
  );
  const clipLeft = compareOn ? [leftPlane] : null;
  const clipRight = compareOn ? [rightPlane] : null;

  const parcelFlat = useMemo(() => flatGeometry(model.parcel.polygon), [model]);
  const parcelLine = useMemo(() => footprintOutline(model.parcel.polygon, 0.35), [model]);

  const streetGeometries = useMemo(() => {
    const ring = model.parcel.polygon.exterior;
    return model.frontage.edgeIndices.map(([s, e]) => {
      const a = ring[s];
      const b = ring[e];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dy / len;
      const ny = -dx / len;
      const w = 55;
      const shape = new THREE.Shape([
        new THREE.Vector2(a.x + nx * 6, a.y + ny * 6),
        new THREE.Vector2(b.x + nx * 6, b.y + ny * 6),
        new THREE.Vector2(b.x + nx * w, b.y + ny * w),
        new THREE.Vector2(a.x + nx * w, a.y + ny * w),
      ]);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      return geo;
    });
  }, [model]);

  const legal = model.legalEnvelope;
  const mission = model.missionEnvelope;
  const scenario = model.scenarios.find((s) => s.scenarioId === controller.scenarioId) ?? model.scenarios[0];

  const grid = useMemo(() => {
    const g = new THREE.GridHelper(diagonal * 4, Math.round(diagonal * 4) / 25, 0xd3cfbc, 0xe4e1d1);
    g.position.set(center.x, 0.02, center.z);
    return g;
  }, [diagonal, center.x, center.z]);

  return (
    <>
      <hemisphereLight args={[0xf3f5ee, 0xd8d4c6, 0.85]} />
      <directionalLight
        castShadow
        position={[center.x - diagonal * 0.55, diagonal * 0.9, center.z + diagonal * 0.4]}
        intensity={1.5}
        color={0xfff6e8}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-diagonal * 0.8}
        shadow-camera-right={diagonal * 0.8}
        shadow-camera-top={diagonal * 0.8}
        shadow-camera-bottom={-diagonal * 0.8}
        shadow-camera-near={1}
        shadow-camera-far={diagonal * 4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />

      {/* Ground + scale grid */}
      <mesh rotation-x={-Math.PI / 2} position={[center.x, 0, center.z]} receiveShadow>
        <planeGeometry args={[diagonal * 6, diagonal * 6]} />
        <meshStandardMaterial color={C.ground} roughness={1} />
      </mesh>
      <primitive object={grid} />

      {/* Street band */}
      {streetGeometries.map((geo, i) => (
        <mesh key={`street-${i}`} geometry={geo} position={[0, 0.04, 0]}>
          <meshStandardMaterial color={C.street} roughness={1} />
        </mesh>
      ))}

      {/* Parcel fill + boundary */}
      <mesh geometry={parcelFlat} position={[0, 0.06, 0]}>
        <meshStandardMaterial color={C.groundParcel} roughness={1} />
      </mesh>
      <lineSegments geometry={parcelLine}>
        <lineBasicMaterial color={C.parcelLine} />
      </lineSegments>

      {/* Existing structures — left side of the reveal curtain when comparing */}
      {model.structures.map((st) => (
        <StructureMesh
          key={st.id}
          structure={st}
          highlight={controller.moment === "mission" || controller.moment === "scenario"}
          dimmed={stale}
          onSelect={controller.onSelect}
          clippingPlanes={compareOn ? clipLeft : null}
        />
      ))}

      {/* Law-informed planning envelope + height plane */}
      {legal && !compareOn && controller.moment !== "existing" && (
        <>
          {legal.polygons.map((poly, i) => (
            <VolumeMesh
              key={`legal-${i}`}
              geometry={extrudedVolume(poly, legal.heightFt)}
              fill={C.legalFill}
              edge={C.legalEdge}
              opacity={controller.moment === "legal" ? O.envelope : O.envelopeDim}
              id="volume:legal-envelope"
              title="Law-informed planning envelope — assumption-derived"
              status={`${legal.areaSqFt.toFixed(0)} sq ft × ${legal.heightFt} ft · ${legal.verification}`}
              detail={[legal.verificationNote, ...legal.bindingNotes].join(" ")}
              provenance={legal.provenance}
              onSelect={controller.onSelect}
            />
          ))}
          {controller.moment === "legal" && model.heightPlaneFt !== null && (
            <HeightPlane model={model} bbox={bbox} />
          )}
        </>
      )}

      {/* Mission clips (the removal story) */}
      {mission && !compareOn && controller.moment === "mission" && (
        <>
          {mission.clips.map((clip) => (
            <ClipMesh key={clip.id} clip={clip} onSelect={controller.onSelect} />
          ))}
        </>
      )}

      {/* Mission envelope */}
      {mission && !compareOn && (controller.moment === "mission" || controller.moment === "scenario") && (
        <>
          {mission.polygons.map((poly, i) => (
            <VolumeMesh
              key={`mission-${i}`}
              geometry={extrudedVolume(poly, mission.heightFt)}
              fill={C.missionFill}
              edge={C.missionEdge}
              opacity={controller.moment === "mission" ? O.envelope : O.envelopeDim}
              id="volume:mission-envelope"
              title="Mission-constrained planning envelope — assumption-derived"
              status={`${mission.areaSqFt.toFixed(0)} sq ft × ${mission.heightFt} ft · ${mission.verification}`}
              detail={[mission.verificationNote, ...mission.bindingNotes].join(" ")}
              provenance={mission.provenance}
              onSelect={controller.onSelect}
            />
          ))}
        </>
      )}

      {/* Scenario massing + parking (right side of the reveal curtain) */}
      {(controller.moment === "scenario" || compareOn) && scenario && (
        <>
          {scenario.volumes.map((volume) => (
            <ScenarioVolumeMesh
              key={volume.id}
              volume={volume}
              floors={scenario.point?.floors ?? 1}
              dimmed={stale}
              onSelect={controller.onSelect}
              clippingPlanes={compareOn ? clipRight : null}
            />
          ))}
          {scenario.parking?.fields.map((field) => (
            <ParkingMesh key={field.id} parking={field} onSelect={controller.onSelect} />
          ))}
        </>
      )}

      {/* Height annotation badge (text from the adapter) */}
      {controller.moment === "legal" &&
        !compareOn &&
        model.annotations
          .filter((a) => a.kind === "height-plane")
          .map((a) => (
            <Html key={a.id} position={[a.at.x, a.elevationFt + 4, -a.at.y]} center zIndexRange={[20, 0]}>
              <div className="forge-badge forge-badge-legal">{a.text}</div>
            </Html>
          ))}

      <CameraRig
        cameras={model.cameras}
        activeId={controller.cameraId}
        nonce={controller.cameraNonce}
        reducedMotion={reducedMotion}
        onSettled={controller.onCameraSettled}
        onUserInteract={controller.onUserInteract}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={diagonal * 0.08}
        maxDistance={diagonal * 2.4}
        target={[0, 6, 0]}
      />
    </>
  );
}

function StructureMesh({
  structure,
  highlight,
  dimmed,
  onSelect,
  clippingPlanes,
}: {
  structure: StructureScene;
  highlight: boolean;
  dimmed: boolean;
  onSelect: (s: Selection) => void;
  clippingPlanes: THREE.Plane[] | null;
}) {
  const geometry = useMemo(() => extrudedVolume(structure.polygon, structure.heightFt), [structure]);
  const edges = useMemo(() => edgesOf(geometry), [geometry]);
  const protectedRing = useMemo(
    () => (structure.protectedByMission ? footprintOutline(structure.polygon, 0.5) : null),
    [structure],
  );
  const select = useCallback(() => {
    onSelect({
      id: structure.id,
      title: structure.name,
      status: structure.protectedByMission ? "PROTECTED — mission" : "EXISTING",
      detail: `${structure.heightFt} ft existing structure${
        structure.protectedByMission ? " · preserved by a confirmed mission constraint" : ""
      }`,
      provenance: structure.provenance,
    });
  }, [structure, onSelect]);
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow onClick={select}>
        <meshStandardMaterial
          color={dimmed ? "#cfccba" : C.structureWall}
          roughness={0.95}
          clippingPlanes={clippingPlanes ?? undefined}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={C.structureEdge} transparent opacity={0.9} />
      </lineSegments>
      {highlight && protectedRing && (
        <lineSegments geometry={protectedRing}>
          <lineDashedMaterial color={C.protectedRing} dashSize={6} gapSize={4} />
        </lineSegments>
      )}
    </group>
  );
}

function VolumeMesh({
  geometry,
  fill,
  edge,
  opacity: op,
  id,
  title,
  status,
  detail,
  provenance,
  onSelect,
}: {
  geometry: THREE.ExtrudeGeometry;
  fill: string;
  edge: string;
  opacity: number;
  id: string;
  title: string;
  status: string;
  detail: string;
  provenance: { nodeId: string; nodeKind: string; label: string }[];
  onSelect: (s: Selection) => void;
}) {
  const edges = useMemo(() => edgesOf(geometry, 20), [geometry]);
  const select = useCallback(
    () => onSelect({ id, title, status, detail, provenance }),
    [id, title, status, detail, provenance, onSelect],
  );
  return (
    <group>
      <mesh geometry={geometry} onClick={select}>
        <meshStandardMaterial
          color={fill}
          transparent
          opacity={op}
          depthWrite={false}
          side={THREE.DoubleSide}
          roughness={0.7}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={edge} transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}

function ClipMesh({ clip, onSelect }: { clip: MissionClipScene; onSelect: (s: Selection) => void }) {
  const geometry = useMemo(() => extrudedVolume(clip.polygon, clip.toFt, clip.fromFt), [clip]);
  const edges = useMemo(() => edgesOf(geometry, 20), [geometry]);
  const select = useCallback(
    () =>
      onSelect({
        id: clip.id,
        title: clip.label,
        status: "REMOVED BY MISSION",
        detail: clip.note,
        provenance: [
          { nodeId: clip.missionConstraintId, nodeKind: "mission-constraint", label: "Mission constraint" },
        ],
      }),
    [clip, onSelect],
  );
  return (
    <group>
      <mesh geometry={geometry} onClick={select}>
        <meshStandardMaterial
          color={C.clipFill}
          transparent
          opacity={O.clip}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineDashedMaterial color={C.clipEdge} dashSize={7} gapSize={5} />
      </lineSegments>
    </group>
  );
}

function HeightPlane({
  model,
  bbox,
}: {
  model: SpatialSceneModel;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}) {
  const h = model.heightPlaneFt ?? 0;
  const parcelAtH = useMemo(() => footprintOutline(model.parcel.polygon, h), [model, h]);
  const guides = useMemo(() => {
    const pts: number[] = [];
    for (const p of model.parcel.polygon.exterior) {
      pts.push(p.x, 0, -p.y, p.x, h, -p.y);
    }
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(pts, 3),
    );
  }, [model, h]);
  return (
    <group>
      <mesh
        position={[(bbox.minX + bbox.maxX) / 2, h, -((bbox.minY + bbox.maxY) / 2)]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[bbox.maxX - bbox.minX + 20, bbox.maxY - bbox.minY + 20]} />
        <meshBasicMaterial color={C.legalFill} transparent opacity={O.heightPlane} depthWrite={false} />
      </mesh>
      <lineSegments geometry={parcelAtH}>
        <lineDashedMaterial color={C.legalEdge} dashSize={10} gapSize={6} />
      </lineSegments>
      <lineSegments geometry={guides}>
        <lineBasicMaterial color={C.legalEdge} transparent opacity={0.25} />
      </lineSegments>
    </group>
  );
}

function ParkingMesh({
  parking,
  onSelect,
}: {
  parking: ParkingFieldScene;
  onSelect: (s: Selection) => void;
}) {
  const surface = useMemo(() => flatGeometry(parking.polygon), [parking]);
  const boundary = useMemo(() => footprintOutline(parking.polygon, 0.14), [parking]);
  const stallTicks = useMemo(() => {
    const ring = parking.polygon.exterior;
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    const a = ring[best];
    const b = ring[(best + 1) % ring.length];
    const ux = (b.x - a.x) / bestLen;
    const uy = (b.y - a.y) / bestLen;
    let px = uy;
    let py = -ux;
    let cx = 0;
    let cy = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
    }
    cx /= ring.length;
    cy /= ring.length;
    if (px * (cx - a.x) + py * (cy - a.y) < 0) {
      px = -px;
      py = -py;
    }
    const perRow = Math.ceil(parking.stalls.count / 2);
    const ticks: number[] = [];
    for (let s = 1; s < perRow; s += 1) {
      const d = s * parking.stalls.widthFt;
      for (const base of [0, parking.stalls.depthFt + parking.stalls.aisleFt]) {
        const x0 = a.x + ux * d + px * base;
        const y0 = a.y + uy * d + py * base;
        const x1 = x0 + px * parking.stalls.depthFt;
        const y1 = y0 + py * parking.stalls.depthFt;
        ticks.push(x0, 0.15, -y0, x1, 0.15, -y1);
      }
    }
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(ticks, 3),
    );
  }, [parking]);

  const select = useCallback(
    () =>
      onSelect({
        id: parking.id,
        title: parking.label,
        status: "ASSUMPTION_DERIVED PLANNING LAYOUT",
        detail: `${parking.stalls.count} stalls (${parking.stalls.widthFt}×${parking.stalls.depthFt} ft, ${parking.stalls.aisleFt} ft aisle) = ${parking.areaSqFt.toFixed(0)} sq ft. ${parking.requirementLabel}. Conceptual surface layout — not legal parking approval.`,
        provenance: parking.provenance,
      }),
    [parking, onSelect],
  );

  return (
    <group>
      <mesh geometry={surface} position={[0, 0.1, 0]} onClick={select}>
        <meshStandardMaterial color={C.parkingSurface} roughness={1} />
      </mesh>
      <lineSegments geometry={boundary}>
        <lineBasicMaterial color={C.clipEdge} />
      </lineSegments>
      <lineSegments geometry={stallTicks}>
        <lineBasicMaterial color={C.parkingLine} />
      </lineSegments>
    </group>
  );
}

function ScenarioVolumeMesh({
  volume,
  floors,
  dimmed,
  onSelect,
  clippingPlanes,
}: {
  volume: ScenarioVolumeScene;
  floors: number;
  dimmed: boolean;
  onSelect: (s: Selection) => void;
  clippingPlanes: THREE.Plane[] | null;
}) {
  const geometry = useMemo(() => extrudedVolume(volume.polygon, volume.heightFt), [volume]);
  const edges = useMemo(() => edgesOf(geometry), [geometry]);
  // Floor bands: story lines across the massing so floors read instantly.
  const floorLines = useMemo(() => {
    const pts: number[] = [];
    const storyFt = floors > 0 ? volume.heightFt / floors : volume.heightFt;
    for (let f = 1; f < floors; f += 1) {
      const ring = volume.polygon.exterior;
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        pts.push(a.x, storyFt * f, -a.y, b.x, storyFt * f, -b.y);
      }
    }
    return new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(pts, 3),
    );
  }, [volume, floors]);
  const conflict = volume.status !== "VALID";
  const select = useCallback(
    () =>
      onSelect({
        id: volume.id,
        title: volume.label,
        status: conflict ? "NOT BUILDABLE" : "ASSUMPTION_DERIVED MASSING",
        detail: volume.statusDetail,
        provenance: volume.provenance,
      }),
    [volume, conflict, onSelect],
  );
  return (
    <group>
      <mesh geometry={geometry} receiveShadow castShadow onClick={select}>
        <meshStandardMaterial
          color={conflict ? C.conflictFill : dimmed ? "#e8e4d0" : C.scenarioFill}
          transparent
          opacity={conflict ? O.conflict : 0.96}
          depthWrite={!conflict}
          side={THREE.DoubleSide}
          roughness={0.9}
          clippingPlanes={clippingPlanes ?? undefined}
        />
      </mesh>
      <lineSegments geometry={edges}>
        {conflict ? (
          <lineDashedMaterial
            color={C.conflictEdge}
            dashSize={8}
            gapSize={5}
            clippingPlanes={clippingPlanes ?? undefined}
          />
        ) : (
          <lineBasicMaterial color={C.scenarioEdge} clippingPlanes={clippingPlanes ?? undefined} />
        )}
      </lineSegments>
      {!conflict && (
        <lineSegments geometry={floorLines}>
          <lineBasicMaterial color={C.scenarioEdge} transparent opacity={0.8} />
        </lineSegments>
      )}
    </group>
  );
}

// --- Camera rig ---------------------------------------------------------------

interface Tween {
  t0: number;
  duration: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  toFov: number;
  fromFov: number;
  id: string;
}

function CameraRig({
  cameras,
  activeId,
  nonce,
  reducedMotion,
  onSettled,
  onUserInteract,
}: {
  cameras: SavedCamera[];
  activeId: string;
  nonce: number;
  reducedMotion: boolean;
  onSettled: (id: string) => void;
  onUserInteract: () => void;
}) {
  const { camera, controls, gl } = useThree();
  const tween = useRef<Tween | null>(null);
  const settledId = useRef<string | null>(null);

  useEffect(() => {
    const cam = cameras.find((c) => c.id === activeId);
    if (!cam) return;
    const ctl = controls as unknown as { target: THREE.Vector3 } | null;
    const persp = camera as THREE.PerspectiveCamera;
    settledId.current = null;
    tween.current = {
      t0: performance.now(),
      duration: reducedMotion ? 0 : (cam.transitionMs ?? 1050),
      fromPos: persp.position.clone(),
      fromTarget: ctl ? ctl.target.clone() : new THREE.Vector3(0, 6, 0),
      toPos: new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z),
      toTarget: new THREE.Vector3(cam.target.x, cam.target.y, cam.target.z),
      toFov: cam.fovDeg,
      fromFov: persp.fov,
      id: cam.id,
    };
  }, [activeId, nonce, cameras, camera, controls, reducedMotion]);

  useEffect(() => {
    const el = gl.domElement;
    const interact = () => {
      tween.current = null;
      onUserInteract();
    };
    el.addEventListener("pointerdown", interact, { passive: true });
    el.addEventListener("wheel", interact, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", interact);
      el.removeEventListener("wheel", interact);
    };
  }, [gl, onUserInteract]);

  /* eslint-disable react-hooks/immutability -- the R3F frame loop mutates
     refs and three.js camera objects by design; the React tree is never
     touched here. */
  useFrame(() => {
    const tw = tween.current;
    if (!tw) return;
    const persp = camera as THREE.PerspectiveCamera;
    const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    const t = tw.duration === 0 ? 1 : Math.min(1, (performance.now() - tw.t0) / tw.duration);
    // Longer, calmer ease than the spike: communicate scale without nausea.
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    persp.position.lerpVectors(tw.fromPos, tw.toPos, e);
    if (ctl) {
      ctl.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      ctl.update();
    }
    persp.fov = tw.fromFov + (tw.toFov - tw.fromFov) * e;
    persp.updateProjectionMatrix();
    if (t >= 1) {
      persp.position.copy(tw.toPos);
      if (ctl) {
        ctl.target.copy(tw.toTarget);
        ctl.update();
      }
      persp.fov = tw.toFov;
      persp.updateProjectionMatrix();
      if (settledId.current !== tw.id) {
        settledId.current = tw.id;
        onSettled(tw.id);
      }
      tween.current = null;
    }
  });
  /* eslint-enable react-hooks/immutability */

  return null;
}
