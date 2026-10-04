import {
  ContextProvider,
  ProviderFailure,
  SiteContextResult,
  StructureProvider,
  StructureRecord,
  ZoningAssignmentResult,
  ZoningProvider,
} from "../capabilities";
import { sha256Of } from "../capture-store";
import { ensureWgs84 } from "../geometry";
import { fetchWithTiers, type FetchTiers } from "./provider-fetch";

/**
 * City of Philadelphia L&I ArcGIS layers — zoning assignment (base district +
 * overlays), building footprints, and site context (flood / historic / RCO).
 * Point intersects are performed at parcel centroids; the method string in the
 * result records exactly that (per the benchmark's method-scoped statement
 * convention). Zoning ASSIGNMENT lives here; regulatory INTERPRETATION is #5.
 */

const ORG = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services";

function pointQuery(
  service: string,
  point: [number, number],
  outFields: string,
  layer = 0,
): string {
  return (
    `${ORG}/${service}/FeatureServer/${layer}/query?geometry=${point[0]},${point[1]}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${outFields}&returnGeometry=false&f=json`
  );
}

function keyFor(prefix: string, point: [number, number]): string {
  return `${prefix}-${point[0].toFixed(5)}-${point[1].toFixed(5)}`;
}

async function fetchJson(
  providerId: string,
  url: string,
  fixtureKey: string,
  tiers: FetchTiers,
  fetchImpl: typeof fetch,
): Promise<{ payload: unknown; mode: "LIVE" | "CACHED" | "FIXTURE"; retrievedAt: string; url: string; body: string; rawEvidenceRef?: string }> {
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
  return { payload, mode, retrievedAt, url, body, rawEvidenceRef };
}

function featuresOf(providerId: string, payload: unknown): Array<Record<string, unknown>> {
  const p = payload as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: unknown };
  if (p.error || !Array.isArray(p.features)) {
    throw new ProviderFailure(providerId, "MALFORMED_PAYLOAD", "response is not an ArcGIS feature set");
  }
  return p.features.map((feature) => feature.attributes ?? {});
}

const FIXTURE_NOTE = "committed fixture evidence (captured 2026-10-04); not a live retrieval";

// ---------------------------------------------------------------------------

export class LiZoningProvider implements ZoningProvider {
  readonly providerId = "phl-li-zoning";
  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async assignAtPoint(point: [number, number]): Promise<ZoningAssignmentResult> {
    const base = await fetchJson(
      this.providerId,
      pointQuery("Zoning_BaseDistricts", point, "code,long_code,pending"),
      keyFor("zoning-base", point),
      this.tiers,
      this.fetchImpl,
    );
    const baseAttrs = featuresOf(this.providerId, base.payload)[0] as
      | { code?: string; long_code?: string }
      | undefined;
    if (!baseAttrs?.code) {
      throw new ProviderFailure(this.providerId, "NO_MATCH", "no zoning base district at point");
    }
    const pending = (baseAttrs as { pending?: string }).pending === "Yes";

    const overlaysResponse = await fetchJson(
      this.providerId,
      pointQuery("Zoning_Overlays", point, "overlay_name,code_section"),
      keyFor("zoning-overlays", point),
      this.tiers,
      this.fetchImpl,
    );
    const overlays = featuresOf(this.providerId, overlaysResponse.payload)
      .map((attributes) => ({
        name: String(attributes.overlay_name ?? "overlay"),
        codeSection: attributes.code_section ? String(attributes.code_section) : undefined,
      }))
      .filter((overlay) => overlay.name && overlay.name !== "N/A");

    return ZoningAssignmentResult.parse({
      capture: {
        provider: "Philadelphia L&I zoning layers (official GIS)",
        providerId: this.providerId,
        mode: base.mode,
        retrievedAt: base.retrievedAt,
        canonicalQuery: base.url,
        rawContentHash: sha256Of(base.body),
        rawEvidenceRef: base.rawEvidenceRef,
        authority: "OFFICIAL_GIS",
        note: base.mode === "FIXTURE" ? FIXTURE_NOTE : undefined,
      },
      baseDistrict: baseAttrs.code,
      baseDistrictLong: baseAttrs.long_code,
      overlays,
      method: `official-gis-point-intersect at parcel centroid (${point[0].toFixed(6)}, ${point[1].toFixed(6)})${pending ? "; pending rezoning bill flagged by layer" : ""}`,
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

  async findByParcelPoint(point: [number, number]): Promise<StructureRecord[]> {
    const url =
      `${ORG}/LI_BUILDING_FOOTPRINTS/FeatureServer/0/query?geometry=${point[0]},${point[1]}` +
      `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      this.providerId,
      url,
      keyFor("footprints", point),
      this.tiers,
      this.fetchImpl,
    );
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
          capture: {
            provider: "Philadelphia L&I building footprints (official GIS)",
            providerId: this.providerId,
            mode,
            retrievedAt,
            canonicalQuery: url,
            rawContentHash: sha256Of(body),
            rawEvidenceRef,
            authority: "OFFICIAL_GIS",
            note: mode === "FIXTURE" ? FIXTURE_NOTE : undefined,
          },
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

  async contextAtPoint(point: [number, number]): Promise<SiteContextResult> {
    const [flood, historic, rco] = await Promise.all([
      fetchJson(
        this.providerId,
        pointQuery("fema_floodplain_2023", point, "fld_zone,zone_subty,sfha_tf"),
        keyFor("flood", point),
        this.tiers,
        this.fetchImpl,
      ),
      fetchJson(
        this.providerId,
        pointQuery("HistoricDistricts_Local", point, "objectid"),
        keyFor("historic", point),
        this.tiers,
        this.fetchImpl,
      ),
      fetchJson(
        this.providerId,
        pointQuery("Zoning_RCO", point, "organization_name,expirationyear"),
        keyFor("rco", point),
        this.tiers,
        this.fetchImpl,
      ),
    ]);
    const floodAttrs = featuresOf(this.providerId, flood.payload)[0] as
      | { fld_zone?: string; zone_subty?: string }
      | undefined;
    const historicCount = featuresOf(this.providerId, historic.payload).length;
    const rcoNames = featuresOf(this.providerId, rco.payload)
      .map((attributes) => attributes.organization_name)
      .filter((name): name is string => typeof name === "string");

    return SiteContextResult.parse({
      capture: {
        provider: "Philadelphia GIS context layers (FEMA 2023 republication, local historic districts, RCO)",
        providerId: this.providerId,
        mode: flood.mode,
        retrievedAt: flood.retrievedAt,
        canonicalQuery: flood.url,
        rawContentHash: sha256Of(flood.body),
        rawEvidenceRef: flood.rawEvidenceRef,
        authority: "OFFICIAL_GIS",
        note: flood.mode === "FIXTURE" ? FIXTURE_NOTE : undefined,
      },
      floodZone: floodAttrs?.fld_zone,
      floodZoneDescription: floodAttrs?.zone_subty,
      historicDistrict: historicCount > 0 ? "local historic district feature(s) intersect the sampled point" : "no local historic district feature at the sampled point",
      rcoNames,
    });
  }
}
