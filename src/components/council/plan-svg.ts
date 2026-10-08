import type {
  ScenePolygon,
  SpatialSceneModel,
} from "../../spatial/scene-model";

/**
 * Deterministic top-down site plan for the Council room and export (issue #13).
 *
 * A pure string builder over the SAME SpatialSceneModel the Forge surface
 * renders: parcel, existing structures (mission-protected ones highlighted),
 * the legal envelope, and the selected scenario's conceptual volumes and
 * placed parking. No second geometry derivation — the model is the only
 * contract (ADR 0008); identical scenes produce identical SVG bytes.
 *
 * Council labels this frame CONCEPTUAL everywhere it appears: the massing is
 * preliminary planning geometry, never architectural design.
 */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ringPath(ring: Array<{ x: number; y: number }>): string {
  return (
    ring
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${(-point.y).toFixed(1)}`,
      )
      .join(" ") + " Z"
  );
}

function polygonPaths(polygon: ScenePolygon): string {
  return (
    ringPath(polygon.exterior) +
    (polygon.holes ?? []).map((hole) => ` ${ringPath(hole)}`).join("")
  );
}

function polygonCentroid(polygon: ScenePolygon): { x: number; y: number } {
  const ring = polygon.exterior;
  let sumX = 0;
  let sumY = 0;
  for (const point of ring) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / ring.length, y: -sumY / ring.length };
}

export function buildPlanSvg(
  scene: SpatialSceneModel,
  scenarioId: string,
): string {
  const parcel = scene.parcel.polygon;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of parcel.exterior) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const pad = Math.max(width, height) * 0.12 + 20;
  const x0 = minX - pad;
  const y0 = -(maxY + pad);
  const w = width + pad * 2;
  const h = height + pad * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="Conceptual site plan: parcel, preserved structures, legal envelope, and selected scenario massing" data-testid="council-plan-svg">`,
  );

  // Legal buildable envelope — dashed, never filled: it is a ceiling, not a proposal.
  for (const polygon of scene.legalEnvelope?.polygons ?? []) {
    parts.push(
      `<path d="${polygonPaths(polygon)}" fill="none" stroke="#45583b" stroke-width="1.3" stroke-dasharray="7 4" opacity="0.75"/>`,
    );
  }

  // Existing structures; mission-protected ones carry the solid olive edge.
  for (const structure of scene.structures) {
    parts.push(
      `<path d="${polygonPaths(structure.polygon)}" fill="${structure.protectedByMission ? "#dde2cc" : "#d8d3c4"}" stroke="${structure.protectedByMission ? "#45583b" : "#7d7866"}" stroke-width="${structure.protectedByMission ? 1.8 : 1.1}"/>`,
    );
    const centroid = polygonCentroid(structure.polygon);
    parts.push(
      `<text x="${centroid.x.toFixed(1)}" y="${centroid.y.toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="#45503c">${xmlEscape(structure.name)}${structure.protectedByMission ? " · KEPT" : ""}</text>`,
    );
  }

  // Parcel boundary on top of everything site-derived, with a light ground
  // tint so the frame reads as land, not an empty white card.
  parts.push(
    `<path d="${polygonPaths(parcel)}" fill="#f1efe4" stroke="#29372d" stroke-width="2.2"/>`,
  );

  // Selected scenario: conceptual volumes + placed parking (if proven).
  const scenario =
    scene.scenarios.find((entry) => entry.scenarioId === scenarioId) ??
    scene.scenarios[0];
  let maxHeight = 0;
  if (scenario) {
    for (const volume of scenario.volumes) {
      maxHeight = Math.max(maxHeight, volume.heightFt);
      parts.push(
        `<path d="${polygonPaths(volume.polygon)}" fill="#45583b" fill-opacity="0.34" stroke="#45583b" stroke-width="1.6"/>`,
      );
    }
    if (scenario.parking?.status === "PLACED") {
      for (const field of scenario.parking.fields) {
        parts.push(
          `<path d="${polygonPaths(field.polygon)}" fill="#b98a2f" fill-opacity="0.10" stroke="#b98a2f" stroke-width="1" stroke-dasharray="3 3"/>`,
        );
      }
    }
  }

  // North arrow + street label (frontage) — spatial anchors, not decoration.
  const northX = x0 + w - 26;
  const northY = y0 + 26;
  parts.push(
    `<g stroke="#29372d" stroke-width="1.4" fill="none"><line x1="${northX}" y1="${northY + 10}" x2="${northX}" y2="${northY - 10}"/><path d="M${northX - 4} ${northY - 4} L${northX} ${northY - 10} L${northX + 4} ${northY - 4}"/></g>`,
    `<text x="${northX}" y="${northY + 22}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="#29372d">N</text>`,
  );
  if (scene.frontage.streetLabel) {
    parts.push(
      `<text x="${(x0 + w / 2).toFixed(1)}" y="${(y0 + h - 8).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" letter-spacing="1.5" fill="#8a8674">${xmlEscape(scene.frontage.streetLabel.toUpperCase())}</text>`,
    );
  }

  // Scale note — the plan is in feet; state the parcel's real extent.
  parts.push(
    `<text x="${x0.toFixed(1)}" y="${(y0 + h - 8).toFixed(1)}" font-family="ui-monospace, monospace" font-size="9" fill="#8a8674">PARCEL ${Math.round(scene.parcel.computedAreaSqFt).toLocaleString("en-US")} FT²${maxHeight > 0 ? ` · CONCEPTUAL MASSING ≤ ${Math.round(maxHeight)} FT` : ""}</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}
