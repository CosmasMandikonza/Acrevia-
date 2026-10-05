"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Site canvas — the map is the hero (Design Constitution).
 *
 * Two rendering paths over the SAME real WGS84 GeoJSON:
 * 1. MapLibre (interactive) — the normal path when WebGL is available.
 * 2. SVG fallback — deterministic projection of the same parcel/structure/hint
 *    geometry when MapLibre cannot initialize or the neutral-basemap path is
 *    active. The fallback is a renderer, not a data copy — it projects the
 *    exact same coordinates into a viewBox. This guarantees the verified
 *    church property is visibly there even when OSM tiles fail, WebGL fails,
 *    or the headless browser cannot rasterize MapLibre at all.
 *
 * Browser-testable: the SVG fallback renders data-testid elements
 * (parcel-geometry, structure-geometry, geocode-hint) that Playwright
 * asserts exist as real DOM geometry, not React intent.
 */

export type SiteMapLayers = {
  hintPoint?: { lon: number; lat: number } | null;
  parcels?: Array<{
    id: string;
    geometry: unknown;
    selected?: boolean;
  }>;
  /** `missionProtected` marks structures under a CONFIRMED preserve-structure
   *  mission rule — the sanctuary the church refused to lose reads on the map. */
  structures?: Array<{ id: string; geometry: unknown; missionProtected?: boolean }>;
};

// ---------------------------------------------------------------------------
// SVG fallback renderer
// ---------------------------------------------------------------------------

type Ring = [number, number][];

function extractRings(geometry: unknown): Ring[] {
  const g = geometry as { type: string; coordinates: unknown };
  if (!g || !g.type) return [];
  if (g.type === "Polygon") return g.coordinates as Ring[];
  if (g.type === "MultiPolygon") {
    return (g.coordinates as Ring[][]).flat();
  }
  return [];
}

type Bounds = { minLon: number; minLat: number; maxLon: number; maxLat: number };

function computeBounds(layers: SiteMapLayers): Bounds | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const consider = (rings: Ring[]) => {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  };
  for (const parcel of layers.parcels ?? []) consider(extractRings(parcel.geometry));
  for (const structure of layers.structures ?? []) consider(extractRings(structure.geometry));
  if (layers.hintPoint) {
    minLon = Math.min(minLon, layers.hintPoint.lon);
    maxLon = Math.max(maxLon, layers.hintPoint.lon);
    minLat = Math.min(minLat, layers.hintPoint.lat);
    maxLat = Math.max(maxLat, layers.hintPoint.lat);
  }
  if (minLon === Infinity) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/** Equirectangular projection into a viewBox with padding. */
function projector(bounds: Bounds, width: number, height: number, padding: number) {
  const spanLon = Math.max(bounds.maxLon - bounds.minLon, 1e-6);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 1e-6);
  // Adjust for latitude compression so parcels aren't stretched.
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const latScale = Math.cos((midLat * Math.PI) / 180);
  const adjustedSpanLon = spanLon * latScale;

  const availableW = width - padding * 2;
  const availableH = height - padding * 2;
  const scale = Math.min(availableW / adjustedSpanLon, availableH / spanLat);

  return (lon: number, lat: number): [number, number] => {
    const x = padding + (lon - bounds.minLon) * latScale * scale;
    // Invert Y: SVG origin is top-left, north is up.
    const y = height - padding - (lat - bounds.minLat) * scale;
    return [x, y];
  };
}

function ringToSvgPath(ring: Ring, project: (lon: number, lat: number) => [number, number]): string {
  if (ring.length < 3) return "";
  const points = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")} Z`;
}

function geometryToPaths(geometry: unknown, project: (lon: number, lat: number) => [number, number]): string[] {
  return extractRings(geometry)
    .map((ring) => ringToSvgPath(ring, project))
    .filter((path) => path.length > 0);
}

function SvgFallback({ layers, note }: { layers: SiteMapLayers; note?: string }) {
  const bounds = useMemo(() => computeBounds(layers), [layers]);
  const W = 800;
  const H = 600;
  const PADDING = 50;
  // Always call useMemo in the same order — compute projector even when bounds
  // is null (returns identity in that case, unused).
  const project = useMemo(
    () => (bounds ? projector(bounds, W, H, PADDING) : (() => [0, 0] as [number, number])),
    [bounds],
  );
  if (!bounds) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#e8e5de]">
        <p className="text-sm text-stone-500">Waiting for property geometry…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#e8e5de]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Property parcel and building footprint (verified geometry)"
        data-testid="spatial-fallback"
      >
        {/* Parcel polygons */}
        {(layers.parcels ?? []).map((parcel) => {
          const paths = geometryToPaths(parcel.geometry, project);
          const isSel = parcel.selected ? "yes" : "no";
          return paths.map((path, i) => (
            <path
              key={`${parcel.id}-${i}`}
              data-testid="parcel-geometry"
              data-parcel-id={parcel.id}
              data-selected={isSel}
              d={path}
              fill={isSel === "yes" ? "#22c55e" : "#86efac"}
              fillOpacity={isSel === "yes" ? 0.30 : 0.12}
              stroke={isSel === "yes" ? "#166534" : "#4ade80"}
              strokeWidth={isSel === "yes" ? 3 : 1.5}
              strokeLinejoin="round"
            />
          ));
        })}

        {/* Structure footprints (drawn after parcels so they're on top).
            Mission-protected structures carry an olive ring — the sanctuary
            the congregation refused to lose reads directly on the canvas. */}
        {(layers.structures ?? []).map((structure) => {
          const paths = geometryToPaths(structure.geometry, project);
          return paths.map((path, i) => (
            <path
              key={`${structure.id}-${i}`}
              data-testid="structure-geometry"
              data-structure-id={structure.id}
              data-mission-protected={structure.missionProtected ? "yes" : "no"}
              d={path}
              fill={structure.missionProtected ? "#3f6212" : "#78350f"}
              fillOpacity={structure.missionProtected ? 0.92 : 0.88}
              stroke={structure.missionProtected ? "#365314" : "#451a03"}
              strokeWidth={structure.missionProtected ? 3.5 : 1.5}
              strokeLinejoin="round"
            />
          ));
        })}

        {/* Census hint point */}
        {layers.hintPoint ? (() => {
          const [cx, cy] = project(layers.hintPoint.lon, layers.hintPoint.lat);
          return (
            <circle
              data-testid="geocode-hint"
              cx={cx}
              cy={cy}
              r={7}
              fill="#d97706"
              stroke="#ffffff"
              strokeWidth={3}
            />
          );
        })() : null}
      </svg>

      {/* Subtle fallback note */}
      {note ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/85 px-2 py-1 text-xs text-stone-600 shadow-sm">
          {note}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MapLibre interactive path (kept from before)
// ---------------------------------------------------------------------------

const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: undefined,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f5f2ec" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.85 } },
  ],
};

const ACREVIA_LAYER_IDS = [
  "structure-outline",
  "structure-fill",
  "parcel-outline",
  "parcel-fill",
  "hint-point",
];

function syncAcreviaLayers(map: MapLibreMap, layers: SiteMapLayers): void {
  for (const id of ACREVIA_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
    const sourceId = id === "hint-point" ? "hint" : id.replace(/-(fill|outline|point)$/, "");
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
  if (layers.hintPoint) {
    map.addSource("hint", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [layers.hintPoint.lon, layers.hintPoint.lat] },
          },
        ],
      },
    });
    map.addLayer({
      id: "hint-point",
      type: "circle",
      source: "hint",
      paint: {
        "circle-radius": 8,
        "circle-color": "#d97706",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  }
  if (layers.parcels && layers.parcels.length > 0) {
    map.addSource("parcels", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: layers.parcels.map((parcel) => ({
          type: "Feature",
          properties: { id: parcel.id, selected: parcel.selected ? "yes" : "no" },
          geometry: parcel.geometry as never,
        })),
      },
    });
    map.addLayer({
      id: "parcel-fill",
      type: "fill",
      source: "parcels",
      paint: {
        "fill-color": ["case", ["==", ["get", "selected"], "yes"], "#22c55e", "#86efac"],
        "fill-opacity": ["case", ["==", ["get", "selected"], "yes"], 0.35, 0.15],
      },
    });
    map.addLayer({
      id: "parcel-outline",
      type: "line",
      source: "parcels",
      paint: {
        "line-color": ["case", ["==", ["get", "selected"], "yes"], "#166534", "#4ade80"],
        "line-width": ["case", ["==", ["get", "selected"], "yes"], 4, 2],
      },
    });
  }
  if (layers.structures && layers.structures.length > 0) {
    map.addSource("structures", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: layers.structures.map((structure) => ({
          type: "Feature",
          properties: {
            id: structure.id,
            protected: structure.missionProtected ? "yes" : "no",
          },
          geometry: structure.geometry as never,
        })),
      },
    });
    map.addLayer({
      id: "structure-fill",
      type: "fill",
      source: "structures",
      paint: {
        "fill-color": ["case", ["==", ["get", "protected"], "yes"], "#3f6212", "#92400e"],
        "fill-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "structure-outline",
      type: "line",
      source: "structures",
      paint: {
        "line-color": ["case", ["==", ["get", "protected"], "yes"], "#365314", "#451a03"],
        "line-width": ["case", ["==", ["get", "protected"], "yes"], 4, 2],
      },
    });
  }
  // Fit camera
  const bounds = computeBounds(layers);
  if (bounds) {
    map.fitBounds(
      [
        [bounds.minLon, bounds.minLat],
        [bounds.maxLon, bounds.maxLat],
      ],
      { padding: 60, duration: 0, maxZoom: 18 },
    );
  }
}

// ---------------------------------------------------------------------------
// Main component: tries MapLibre, falls back to SVG on failure
// ---------------------------------------------------------------------------

export function SiteMap({ layers }: { layers: SiteMapLayers }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const layersRef = useRef<SiteMapLayers>(layers);
  const [mapMode, setMapMode] = useState<"initializing" | "maplibre" | "fallback">("initializing");

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        const map = new maplibre.Map({
          container: containerRef.current,
          style: OSM_STYLE,
          center: [-75.0564, 40.0438],
          zoom: 16,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.on("style.load", () => {
          if (!disposed) {
            setMapMode("maplibre");
            syncAcreviaLayers(map, layersRef.current);
          }
        });
        map.on("error", (event) => {
          const msg = (event.error as { message?: string })?.message ?? "";
          if (msg.toLowerCase().includes("tile") || msg.toLowerCase().includes("style")) {
            // Basemap tiles failed — geometry layers still render in MapLibre
            // but also show the fallback SVG underneath for guaranteed visibility.
            if (!disposed) setMapMode("fallback");
          }
        });
      } catch {
        // MapLibre/WebGL failed to initialize — deterministic SVG fallback.
        if (!disposed) setMapMode("fallback");
      }
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-sync MapLibre layers on data change (when MapLibre is active)
  useEffect(() => {
    if (mapMode !== "maplibre") return;
    const map = mapRef.current;
    if (!map) return;
    const attempt = (delay: number): void => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      try {
        syncAcreviaLayers(currentMap, layersRef.current);
      } catch {
        if (delay < 5000) setTimeout(() => attempt(delay * 2), delay);
      }
    };
    attempt(100);
  }, [layers, mapMode]);

  // Timeout: if MapLibre hasn't initialized within 3s, switch to fallback
  useEffect(() => {
    if (mapMode !== "initializing") return;
    const timer = setTimeout(() => {
      setMapMode((current) => (current === "initializing" ? "fallback" : current));
    }, 3000);
    return () => clearTimeout(timer);
  }, [mapMode]);

  return (
    <div className="relative h-full w-full">
      {/* MapLibre container (hidden in fallback mode) */}
      <div
        ref={containerRef}
        className={mapMode === "fallback" ? "hidden" : "h-full w-full"}
        aria-label="Interactive property map"
        role="img"
      />
      {/* Deterministic SVG fallback — always renders the same real geometry */}
      {mapMode === "fallback" ? (
        <SvgFallback
          layers={layers}
          note={mapMode === "fallback" ? "Basemap unavailable — verified property geometry still shown" : undefined}
        />
      ) : null}
    </div>
  );
}
