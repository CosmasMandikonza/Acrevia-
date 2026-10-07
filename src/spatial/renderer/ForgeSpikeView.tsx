"use client";

/**
 * Forge spike renderer (ADR 0008) — React Three Fiber scene that consumes
 * ONLY the SpatialSceneModel. It knows nothing about regulations: every volume,
 * plane, and status arrives as derived data. Four moments (Existing /
 * Legal / Mission / Scenario), four deterministic saved cameras, click-to-
 * provenance selection, and an SVG plan fallback when WebGL is unavailable.
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
} from "../scene-model";
import { palette as C, opacity as O } from "./theme";
import { edgesOf, extrudedVolume, footprintOutline } from "./scene-geometry";
import { ForgeSpikeFallback } from "./FallbackPlan";
import { ForgeHud } from "./Hud";

export type Moment = "existing" | "legal" | "mission" | "scenario";
export const MOMENTS: Moment[] = ["existing", "legal", "mission", "scenario"];

export interface Selection {
  id: string;
  title: string;
  status: string | null;
  detail: string;
  provenance: { nodeId: string; nodeKind: string; label: string }[];
}

interface ViewProps {
  model: SpatialSceneModel;
  forceFallback?: boolean;
  buildMs?: number;
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

export default function ForgeSpikeView({ model, forceFallback = false, buildMs }: ViewProps) {
  // Dynamically imported with ssr:false — this initializer only runs in the
  // browser, so probing WebGL here cannot break server rendering.
  const [webglOk] = useState<boolean | null>(() => (forceFallback ? false : probeWebgl()));
  const [moment, setMoment] = useState<Moment>("existing");
  const [scenarioId, setScenarioId] = useState(model.scenarios[0]?.scenarioId ?? "");
  const [cameraId, setCameraId] = useState("camera:aerial");
  const [cameraNonce, setCameraNonce] = useState(0);
  const [cameraSettled, setCameraSettled] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rendered, setRendered] = useState(false);

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

  if (webglOk === false) {
    return (
      <ForgeSpikeFallback
        model={model}
        moment={moment}
        setMoment={setMoment}
        scenarioId={scenarioId}
        setScenarioId={setScenarioId}
      />
    );
  }

  return (
    <div
      className="forge-spike-root"
      data-rendered={rendered ? "1" : "0"}
      data-moment={moment}
      data-scenario={scenarioId}
      data-camera-active={cameraId}
      data-camera-settled={cameraSettled ? "1" : "0"}
      data-testid="forge-spike-root"
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: 1, far: diagonal * 12, position: [0, diagonal, 0] }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          scene.background = new THREE.Color(C.sky);
          scene.fog = new THREE.Fog(C.sky, diagonal * 1.6, diagonal * 5);
        }}
      >
        <SceneContent
          model={model}
          moment={moment}
          scenarioId={scenarioId}
          bbox={bbox}
          diagonal={diagonal}
          onFirstFrame={() => setRendered(true)}
          onSelect={setSelection}
        />
        <CameraRig
          cameras={model.cameras}
          activeId={cameraId}
          nonce={cameraNonce}
          onSettled={(id) => {
            setCameraSettled(true);
            setCameraId(id);
          }}
          onUserInteract={() => {
            setCameraId((current) => (current === "free" ? current : "free"));
          }}
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
      </Canvas>
      <ForgeHud
        model={model}
        moment={moment}
        setMoment={setMoment}
        scenarioId={scenarioId}
        setScenarioId={setScenarioId}
        cameraId={cameraId}
        setCameraId={(id) => {
          setCameraSettled(false);
          setCameraId(id);
          setCameraNonce((n) => n + 1);
        }}
        selection={selection}
        clearSelection={() => setSelection(null)}
        webgl={webglOk === true}
        buildMs={buildMs}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------

function SceneContent({
  model,
  moment,
  scenarioId,
  bbox,
  diagonal,
  onFirstFrame,
  onSelect,
}: {
  model: SpatialSceneModel;
  moment: Moment;
  scenarioId: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  diagonal: number;
  onFirstFrame: () => void;
  onSelect: (s: Selection) => void;
}) {
  const first = useRef(true);
  useFrame(() => {
    if (first.current) {
      first.current = false;
      onFirstFrame();
    }
  });

  const center = { x: (bbox.minX + bbox.maxX) / 2, z: -(bbox.minY + bbox.maxY) / 2 };

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
  const scenario = model.scenarios.find((s) => s.scenarioId === scenarioId) ?? model.scenarios[0];

  return (
    <>
      <hemisphereLight args={[0xf3f5ee, 0xd8d4c6, 0.85]} />
      <directionalLight
        castShadow
        position={[center.x - diagonal * 0.6, diagonal * 0.85, center.z + diagonal * 0.35]}
        intensity={1.45}
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

      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} position={[center.x, 0, center.z]} receiveShadow>
        <planeGeometry args={[diagonal * 6, diagonal * 6]} />
        <meshStandardMaterial color={C.ground} roughness={1} />
      </mesh>

      {/* Street band (schematic, derived from frontage edges) */}
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

      {/* Existing structures */}
      {model.structures.map((st) => (
        <StructureMesh key={st.id} structure={st} moment={moment} onSelect={onSelect} />
      ))}

      {/* Legal envelope + height plane */}
      {legal && moment !== "existing" && (
        <>
          {legal.polygons.map((poly, i) => (
            <VolumeMesh
              key={`legal-${i}`}
              geometry={extrudedVolume(poly, legal.heightFt)}
              fill={C.legalFill}
              edge={C.legalEdge}
              opacity={moment === "legal" ? O.envelope : O.envelopeDim}
              id="volume:legal-envelope"
              title="Planning envelope — assumption-derived"
              status={`${legal.areaSqFt.toFixed(0)} sq ft × ${legal.heightFt} ft · ${legal.verification}`}
              detail={[legal.verificationNote, ...legal.bindingNotes].join(" ")}
              provenance={legal.provenance}
              onSelect={onSelect}
            />
          ))}
          {moment === "legal" && model.heightPlaneFt !== null && (
            <HeightPlane model={model} bbox={bbox} />
          )}
        </>
      )}

      {/* Mission clips (the removal story) */}
      {mission && moment === "mission" && (
        <>
          {mission.clips.map((clip) => (
            <ClipMesh key={clip.id} clip={clip} onSelect={onSelect} />
          ))}
        </>
      )}

      {/* Mission envelope */}
      {mission && (moment === "mission" || moment === "scenario") && (
        <>
          {mission.polygons.map((poly, i) => (
            <VolumeMesh
              key={`mission-${i}`}
              geometry={extrudedVolume(poly, mission.heightFt)}
              fill={C.missionFill}
              edge={C.missionEdge}
              opacity={moment === "mission" ? O.envelope : O.envelopeDim}
              id="volume:mission-envelope"
              title="Mission-constrained planning envelope — assumption-derived"
              status={`${mission.areaSqFt.toFixed(0)} sq ft × ${mission.heightFt} ft · ${mission.verification}`}
              detail={[mission.verificationNote, ...mission.bindingNotes].join(" ")}
              provenance={mission.provenance}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {/* Parking */}
      {model.parking && (moment === "mission" || moment === "scenario") && (
        <ParkingMesh parking={model.parking} onSelect={onSelect} />
      )}

      {/* Scenario massing */}
      {moment === "scenario" && scenario && (
        <>
          {scenario.volumes.map((volume) => (
            <ScenarioVolumeMesh key={volume.id} volume={volume} onSelect={onSelect} />
          ))}
        </>
      )}

      {/* Annotation badges (text derives from the adapter's annotations) */}
      {moment === "legal" &&
        model.annotations
          .filter((a) => a.kind === "height-plane")
          .map((a) => (
            <Html
              key={a.id}
              position={[a.at.x, a.elevationFt + 4, -a.at.y]}
              center
              zIndexRange={[20, 0]}
            >
              <div className="forge-badge forge-badge-legal">{a.text}</div>
            </Html>
          ))}

    </>
  );
}

function StructureMesh({
  structure,
  moment,
  onSelect,
}: {
  structure: StructureScene;
  moment: Moment;
  onSelect: (s: Selection) => void;
}) {
  const geometry = useMemo(() => extrudedVolume(structure.polygon, structure.heightFt), [structure]);
  const edges = useMemo(() => edgesOf(geometry), [geometry]);
  const protectedRing = useMemo(
    () => (structure.protectedByMission ? footprintOutline(structure.polygon, 0.5) : null),
    [structure],
  );
  const showRing = protectedRing !== null && (moment === "mission" || moment === "scenario");
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
        <meshStandardMaterial color={C.structureWall} roughness={0.95} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={C.structureEdge} transparent opacity={0.9} />
      </lineSegments>
      {showRing && protectedRing && (
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
  parking: NonNullable<SpatialSceneModel["parking"]>;
  onSelect: (s: Selection) => void;
}) {
  const surface = useMemo(() => flatGeometry(parking.polygon), [parking]);
  const boundary = useMemo(() => footprintOutline(parking.polygon, 0.14), [parking]);
  const stallTicks = useMemo(() => {
    // Paint stall separators perpendicular to the block's longest edge,
    // two rows around the aisle (9x18 stalls, 24 ft aisle).
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
    // Point the perpendicular INTO the block (toward ring centroid).
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
        status: "RESERVED — mission",
        detail: `${parking.stalls.count} stalls (${parking.stalls.widthFt}×${parking.stalls.depthFt} ft, ${parking.stalls.aisleFt} ft aisle) = ${parking.areaSqFt.toFixed(0)} sq ft. ${parking.requirementLabel}.`,
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
  onSelect,
}: {
  volume: ScenarioVolumeScene;
  onSelect: (s: Selection) => void;
}) {
  const geometry = useMemo(() => extrudedVolume(volume.polygon, volume.heightFt), [volume]);
  const edges = useMemo(() => edgesOf(geometry), [geometry]);
  const conflict = volume.status !== "VALID";
  const select = useCallback(
    () =>
      onSelect({
        id: volume.id,
        title: volume.label,
        status: conflict ? "NOT BUILDABLE" : "BUILDABLE",
        detail: volume.statusDetail,
        provenance: volume.provenance,
      }),
    [volume, conflict, onSelect],
  );
  return (
    <group>
      <mesh geometry={geometry} receiveShadow onClick={select}>
        <meshStandardMaterial
          color={conflict ? C.conflictFill : C.scenarioFill}
          transparent
          opacity={conflict ? O.conflict : 0.96}
          depthWrite={!conflict}
          side={THREE.DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <lineSegments geometry={edges}>
        {conflict ? (
          <lineDashedMaterial color={C.conflictEdge} dashSize={8} gapSize={5} />
        ) : (
          <lineBasicMaterial color={C.scenarioEdge} />
        )}
      </lineSegments>
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
  onSettled,
  onUserInteract,
}: {
  cameras: SavedCamera[];
  activeId: string;
  nonce: number;
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
    settledId.current = null; // a new tween must always re-report settlement
    tween.current = {
      t0: performance.now(),
      duration: 950,
      fromPos: persp.position.clone(),
      fromTarget: ctl ? ctl.target.clone() : new THREE.Vector3(0, 6, 0),
      toPos: new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z),
      toTarget: new THREE.Vector3(cam.target.x, cam.target.y, cam.target.z),
      toFov: cam.fovDeg,
      fromFov: persp.fov,
      id: cam.id,
    };
  }, [activeId, nonce, cameras, camera, controls]);

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
    const t = Math.min(1, (performance.now() - tw.t0) / tw.duration);
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
