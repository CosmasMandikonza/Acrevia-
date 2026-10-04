import {
  ContextProvider,
  HistoricResult,
  FloodResult,
  ProviderFailure,
  RcoResult,
  StructureProvider,
  StructureRecord,
  Wgs84Geometry,
  ZoningBaseResult,
  ZoningOverlaysResult,
  ZoningProvider,
} from "../capabilities";
import { sha256Of } from "../capture-store";
import { centroidOf, ensureWgs84, pointInGeometry } from "../geometry";
import { fetchWithTiers, type FetchTiers } from "./provider-fetch";

/**
 * City of Philadelphia L&I ArcGIS layers — zoning assignment (base district +
 * overlays as SEPARATE captures), building footprints (by official parcel link
 * or polygon intersection), and site context (flood / historic / RCO each with
 * their own capture). Every fact gets its own source artifact.
 */

const ORG = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services";

function pointQuery(service: string, point: [number, number], outFields: string, layer = 0): string {
  return (
    `${ORG}/${service}/FeatureServer/${layer}/query?geometry=${point[0]},${point[1]}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${outFields}&returnGeometry=false&f=json`
  );
}

function envelopeFromGeometry(geometry: Wgs84Geometry): string {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys as number[][][][]) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat].map((n) => n.toFixed(6)).join("%2C");
}

function keyFor(prefix: string, point: [number, number]): string {
  return `${prefix}-${point[0].toFixed(5)}-${point[1].toFixed(5)}`;
}

async function fetchFeatures(
  providerId: string,
  url: string,
  fixtureKey: string,
  tiers: FetchTiers,
  fetchImpl: typeof fetch,
): Promise<{
  attrs: Array<Record<string, unknown>>;
  mode: "LIVE" | "CACHED" | "FIXTURE";
  retrievedAt: string;
  url: string;
  body: string;
  rawEvidenceRef?: string;
}> {
  const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
    providerId,
    url,
    fixtureKey,
    tiers,
    fetchImpl,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ProviderFailure(providerId, "MALFORMED_PAYLOAD", "response is not JSON");
  }
  const p = payload as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: unknown };
  if (p.error || !Array.isArray(p.features)) {
    throw new ProviderFailure(providerId, "MALFORMED_PAYLOAD", "not an ArcGIS feature set");
  }
  return {
    attrs: p.features.map((f) => f.attributes ?? {}),
    mode,
    retrievedAt,
    url,
    body,
    rawEvidenceRef,
  };
}

function makeCapture(info: {
  provider: string;
  providerId: string;
  logicalCaptureKey: string;
  mode: "LIVE" | "CACHED" | "FIXTURE";
  retrievedAt: string;
  url: string;
  body: string;
  rawEvidenceRef?: string;
}) {
  return {
    provider: info.provider,
    providerId: info.providerId,
    mode: info.mode,
    retrievedAt: info.retrievedAt,
    canonicalQuery: info.url,
    rawContentHash: sha256Of(info.body),
    rawEvidenceRef: info.rawEvidenceRef,
    authority: "OFFICIAL_GIS" as const,
    logicalCaptureKey: info.logicalCaptureKey,
    note: info.mode === "FIXTURE" ? "committed fixture evidence (captured 2026-10-04); not a live retrieval" : undefined,
  };
}

// ---------------------------------------------------------------------------

export class LiZoningProvider implements ZoningProvider {
  readonly providerId = "phl-li-zoning";
  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async baseDistrictAtPoint(point: [number, number]): Promise<ZoningBaseResult> {
    const info = await fetchFeatures(
      this.providerId,
      pointQuery("Zoning_BaseDistricts", point, "code,long_code,pending"),
      keyFor("zoning-base", point),
      this.tiers,
      this.fetchImpl,
    );
    const attrs = info.attrs[0] as { code?: string; long_code?: string; pending?: string } | undefined;
    if (!attrs?.code) {
      throw new ProviderFailure(this.providerId, "NO_MATCH", "no zoning base district at point");
    }
    return ZoningBaseResult.parse({
      capture: makeCapture({
        provider: "Philadelphia L&I Zoning_BaseDistricts (official GIS)",
        providerId: this.providerId,
        logicalCaptureKey: `${this.providerId}:zoning-base:${point[0].toFixed(5)},${point[1].toFixed(5)}`,
        mode: info.mode,
        retrievedAt: info.retrievedAt,
        url: info.url,
        body: info.body,
        rawEvidenceRef: info.rawEvidenceRef,
      }),
      district: attrs.code,
      districtLong: attrs.long_code,
      method: `official-gis-point-intersect at (${point[0].toFixed(6)}, ${point[1].toFixed(6)})${attrs.pending === "Yes" ? "; pending rezoning flagged" : ""}`,
    });
  }

  async overlaysAtPoint(point: [number, number]): Promise<ZoningOverlaysResult> {
    const info = await fetchFeatures(
      this.providerId,
      pointQuery("Zoning_Overlays", point, "overlay_name,code_section"),
      keyFor("zoning-overlays", point),
      this.tiers,
      this.fetchImpl,
    );
    const overlays = info.attrs
      .map((attributes) => ({
        name: String(attributes.overlay_name ?? ""),
        codeSection: attributes.code_section ? String(attributes.code_section) : undefined,
      }))
      .filter((o) => o.name && o.name !== "N/A");
    return ZoningOverlaysResult.parse({
      capture: makeCapture({
        provider: "Philadelphia L&I Zoning_Overlays (official GIS)",
        providerId: this.providerId,
        logicalCaptureKey: `${this.providerId}:zoning-overlays:${point[0].toFixed(5)},${point[1].toFixed(5)}`,
        mode: info.mode,
        retrievedAt: info.retrievedAt,
        url: info.url,
        body: info.body,
        rawEvidenceRef: info.rawEvidenceRef,
      }),
      overlays,
      method: `official-gis-point-intersect at (${point[0].toFixed(6)}, ${point[1].toFixed(6)})`,
    });
  }
}

// ---------------------------------------------------------------------------

export class LiStructureProvider implements StructureProvider {
  readonly providerId = "phl-li-building-footprints";
  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async findByParcel(parcel: {
    parcelId: string;
    geometry: Wgs84Geometry;
  }): Promise<StructureRecord[]> {
    // Strategy 1: official parcel link (parcel_id_num field in the footprints
    // layer links directly to PWD parcel ids) — the most authoritative path.
    const byLink = await this.tryByParcelLink(parcel.parcelId);
    if (byLink.length > 0) return byLink;

    // Strategy 2: envelope intersection + spatial filter against parcel geometry.
    return this.tryByEnvelope(parcel);
  }

  private async tryByParcelLink(pwdParcelId: string): Promise<StructureRecord[]> {
    const url =
      `${ORG}/LI_BUILDING_FOOTPRINTS/FeatureServer/0/query?where=parcel_id_num%3D%27${encodeURIComponent(pwdParcelId)}%27` +
      `&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      this.providerId,
      url,
      `footprints-parcel-${pwdParcelId}`,
      this.tiers,
      this.fetchImpl,
    );
    return this.parseGeoJson(body, mode, retrievedAt, url, rawEvidenceRef, `parcel-link:${pwdParcelId}`);
  }

  private async tryByEnvelope(parcel: {
    parcelId: string;
    geometry: Wgs84Geometry;
  }): Promise<StructureRecord[]> {
    const bbox = envelopeFromGeometry(parcel.geometry);
    const url =
      `${ORG}/LI_BUILDING_FOOTPRINTS/FeatureServer/0/query?geometry=${bbox}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      this.providerId,
      url,
      `footprints-envelope-${parcel.parcelId}`,
      this.tiers,
      this.fetchImpl,
    );
    const all = this.parseGeoJson(body, mode, retrievedAt, url, rawEvidenceRef, `envelope:${parcel.parcelId}`);
    // Spatial filter: keep only footprints whose centroid is inside the parcel.
    return all.filter((structure) => {
      const center = centroidOf(structure.footprint);
      return pointInGeometry(center, parcel.geometry);
    });
  }

  private parseGeoJson(
    body: string,
    mode: "LIVE" | "CACHED" | "FIXTURE",
    retrievedAt: string,
    url: string,
    rawEvidenceRef: string | undefined,
    captureKeySuffix: string,
  ): StructureRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ProviderFailure(this.providerId, "MALFORMED_PAYLOAD", "response is not JSON");
    }
    const fc = parsed as {
      features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> }>;
      error?: unknown;
    };
    if (fc.error || !Array.isArray(fc.features)) {
      throw new ProviderFailure(this.providerId, "MALFORMED_PAYLOAD", "not a GeoJSON FeatureCollection");
    }
    return fc.features
      .filter((feature) => feature.geometry && feature.properties)
      .map((feature) => {
        const props = feature.properties as {
          bin?: string | number;
          building_name?: string;
          address?: string;
          approx_hgt?: number;
          square_ft?: number;
          parcel_id_num?: string;
        };
        return StructureRecord.parse({
          capture: makeCapture({
            provider: "Philadelphia L&I building footprints (official GIS)",
            providerId: this.providerId,
            logicalCaptureKey: `${this.providerId}:${captureKeySuffix}`,
            mode,
            retrievedAt,
            url,
            body,
            rawEvidenceRef,
          }),
          structureId: String(props.bin ?? "unknown-bin"),
          buildingName: props.building_name ?? undefined,
          address: props.address ?? undefined,
          footprint: ensureWgs84(this.providerId, feature.geometry, undefined),
          approxHeightFt: props.approx_hgt,
          footprintSqFt: props.square_ft,
          parcelLink: props.parcel_id_num,
        });
      });
  }
}

// ---------------------------------------------------------------------------

export class LiContextProvider implements ContextProvider {
  readonly providerId = "phl-site-context";
  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async floodAtPoint(point: [number, number]): Promise<FloodResult> {
    const info = await fetchFeatures(
      this.providerId,
      pointQuery("fema_floodplain_2023", point, "fld_zone,zone_subty,sfha_tf"),
      keyFor("flood", point),
      this.tiers,
      this.fetchImpl,
    );
    const attrs = info.attrs[0] as { fld_zone?: string; zone_subty?: string } | undefined;
    return FloodResult.parse({
      capture: makeCapture({
        provider: "FEMA floodplain 2023 (City of Philadelphia republication)",
        providerId: this.providerId,
        logicalCaptureKey: `${this.providerId}:flood:${point[0].toFixed(5)},${point[1].toFixed(5)}`,
        mode: info.mode,
        retrievedAt: info.retrievedAt,
        url: info.url,
        body: info.body,
        rawEvidenceRef: info.rawEvidenceRef,
      }),
      zone: attrs?.fld_zone,
      description: attrs?.zone_subty,
      method: `official-gis-point-intersect at (${point[0].toFixed(6)}, ${point[1].toFixed(6)})`,
    });
  }

  async historicAtPoint(point: [number, number]): Promise<HistoricResult> {
    const info = await fetchFeatures(
      this.providerId,
      pointQuery("HistoricDistricts_Local", point, "objectid"),
      keyFor("historic", point),
      this.tiers,
      this.fetchImpl,
    );
    return HistoricResult.parse({
      capture: makeCapture({
        provider: "Philadelphia local historic districts (official GIS)",
        providerId: this.providerId,
        logicalCaptureKey: `${this.providerId}:historic:${point[0].toFixed(5)},${point[1].toFixed(5)}`,
        mode: info.mode,
        retrievedAt: info.retrievedAt,
        url: info.url,
        body: info.body,
        rawEvidenceRef: info.rawEvidenceRef,
      }),
      districtFeature:
        info.attrs.length > 0
          ? "local historic district feature(s) intersect the sampled point"
          : undefined,
      method: `official-gis-point-intersect at (${point[0].toFixed(6)}, ${point[1].toFixed(6)})`,
    });
  }

  async rcoAtPoint(point: [number, number]): Promise<RcoResult> {
    const info = await fetchFeatures(
      this.providerId,
      pointQuery("Zoning_RCO", point, "organization_name,expirationyear"),
      keyFor("rco", point),
      this.tiers,
      this.fetchImpl,
    );
    const names = info.attrs
      .map((attributes) => attributes.organization_name)
      .filter((name): name is string => typeof name === "string");
    return RcoResult.parse({
      capture: makeCapture({
        provider: "Philadelphia Registered Community Organizations (official GIS)",
        providerId: this.providerId,
        logicalCaptureKey: `${this.providerId}:rco:${point[0].toFixed(5)},${point[1].toFixed(5)}`,
        mode: info.mode,
        retrievedAt: info.retrievedAt,
        url: info.url,
        body: info.body,
        rawEvidenceRef: info.rawEvidenceRef,
      }),
      names,
      method: `official-gis-point-intersect at (${point[0].toFixed(6)}, ${point[1].toFixed(6)})`,
    });
  }
}
