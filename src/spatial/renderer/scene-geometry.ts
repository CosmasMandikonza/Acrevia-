/**
 * Renderer-side geometry builders — pure functions from ScenePolygon to
 * three.js geometry. No domain knowledge, no regulatory vocabulary.
 *
 * World convention (matches SpatialSceneModel.frame): X = feet east,
 * Y = feet up, Z = -feet north. A plan point (x, y) extruded to height h
 * occupies world (x, [0..h], -y): THREE.Shape uses (x, y) plan coordinates
 * and extrudes toward +Z, then the mesh rotates -90 deg about X, which
 * maps shape (x, y, z) -> world (x, z, -y).
 */

import * as THREE from "three";
import type { ScenePolygon } from "../scene-model";

export function polygonToShape(polygon: ScenePolygon): THREE.Shape {
  const shape = new THREE.Shape(polygon.exterior.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const hole of polygon.holes ?? []) {
    shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
  }
  return shape;
}

export function extrudedVolume(
  polygon: ScenePolygon,
  heightFt: number,
  baseFt = 0,
): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(polygonToShape(polygon), {
    depth: heightFt - baseFt,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, baseFt, 0);
  return geometry;
}

export function footprintOutline(polygon: ScenePolygon, elevationFt: number): THREE.BufferGeometry {
  const points: number[] = [];
  const ring = polygon.exterior;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    points.push(a.x, elevationFt, -a.y);
  }
  const first = ring[0];
  points.push(first.x, elevationFt, -first.y);
  return new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
}

export function edgesOf(geometry: THREE.BufferGeometry, thresholdDeg = 15): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(geometry, thresholdDeg);
}
