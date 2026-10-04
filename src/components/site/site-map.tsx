"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Site canvas — the map is the hero (Design Constitution). MapLibre renders
 * the OSM raster basemap as NON-CRITICAL visual context: if the style fails
 * to load (offline venue, blocked tiles), the map falls back to a neutral
 * canvas and the parcel/structure/evidence layers still render. Geometry
 * arrives as plain GeoJSON sources — the same WGS84 polygons that live in the
 * Development Graph, never decorative pins.
 */

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
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.92 } },
  ],
};

const NEUTRAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#efece5" } }],
};

export type SiteMapLayers = {
  hintPoint?: { lon: number; lat: number } | null;
  parcels?: Array<{
    id: string;
    geometry: unknown;
    selected?: boolean;
  }>;
  structures?: Array<{ id: string; geometry: unknown }>;
};

export function SiteMap({ layers }: { layers: SiteMapLayers }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const basemapFailedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;

    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (disposed || !containerRef.current) return;
      map = new maplibre.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [-75.0564, 40.0438],
        zoom: 16,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.on("error", (event) => {
        const target = event.error as { message?: string } | undefined;
        // Basemap tile/style failures degrade to the neutral canvas; the
        // product data layers are unaffected (non-negotiable).
        if (!basemapFailedRef.current && target?.message?.toLowerCase().includes("tile")) {
          basemapFailedRef.current = true;
          const target = mapRef.current ?? map;
          target?.setStyle(NEUTRAL_STYLE, { diff: false });
        }
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Data layers: re-derived whenever the resolution layers change. These are
  // added on top of whatever style is active, so they survive a basemap swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      // hint point (geocode HINT — visually distinct from confirmed geometry)
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
            "circle-radius": 7,
            "circle-color": "#b8860b",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
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
            "fill-color": ["case", ["==", ["get", "selected"], "yes"], "#5a7d4f", "#8ea487"],
            "fill-opacity": ["case", ["==", ["get", "selected"], "yes"], 0.35, 0.16],
          },
        });
        map.addLayer({
          id: "parcel-outline",
          type: "line",
          source: "parcels",
          paint: {
            "line-color": ["case", ["==", ["get", "selected"], "yes"], "#3f5c37", "#6f7f6a"],
            "line-width": ["case", ["==", ["get", "selected"], "yes"], 3, 1.6],
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
              properties: { id: structure.id },
              geometry: structure.geometry as never,
            })),
          },
        });
        map.addLayer({
          id: "structure-fill",
          type: "fill",
          source: "structures",
          paint: { "fill-color": "#7a5c3e", "fill-opacity": 0.85 },
        });
        map.addLayer({
          id: "structure-outline",
          type: "line",
          source: "structures",
          paint: { "line-color": "#4b3423", "line-width": 1 },
        });
      }
    };

    const cleanup = () => {
      for (const id of ["structure-outline", "structure-fill", "parcel-outline", "parcel-fill", "hint-point"]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };

    if (map.isStyleLoaded()) {
      cleanup();
      render();
    } else {
      map.once("load", () => {
        cleanup();
        render();
      });
    }
    return cleanup;
  }, [layers]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      aria-label="Property resolution map. Parcel boundaries, building footprints, and evidence appear as they resolve."
      role="img"
    />
  );
}
