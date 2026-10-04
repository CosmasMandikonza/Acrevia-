import {
  ParcelCandidate,
  ParcelProvider,
  ProviderFailure,
  Wgs84Geometry,
} from "../capabilities";
import { sha256Of } from "../capture-store";
import {
  centroidOf,
  computedAreaSqFt,
  distanceMeters,
  ensureWgs84,
  pointInGeometry,
} from "../geometry";
import { fetchWithTiers, type FetchTiers } from "./provider-fetch";

/**
 * City of Philadelphia PWD_PARCELS ArcGIS FeatureServer — the canonical live
 * parcel source (issue #4 addendum). Two discovery modes, both labeled:
 *   findByAddress — registry address match (strong, e.g. "7200-50 E ROOSEVELT…")
 *   findNearPoint — envelope query around a geocode HINT, then ranked by
 *                   CONTAINS_GEOCODE_POINT / NEAREST with distance.
 * Never silently picks: ranking produces labeled candidates; the pipeline and
 * the user decide.
 */

const PROVIDER_ID = "phl-pwd-parcels";
const BASE =
  "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/PWD_PARCELS/FeatureServer/0/query";

type PwdFeature = {
  geometry?: { type?: string; coordinates?: unknown; crs?: unknown };
  properties: Record<string, unknown>;
};

export class PwdParcelProvider implements ParcelProvider {
  readonly providerId = PROVIDER_ID;

  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async findByAddress(houseNumber: string, street: string): Promise<ParcelCandidate[]> {
    const pattern = `${houseNumber}%${street.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}%`;
    const url = `${BASE}?where=UPPER(ADDRESS)%20LIKE%20'${pattern}'&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      PROVIDER_ID,
      url,
      `pwd-address-${houseNumber}-${street.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      this.tiers,
      this.fetchImpl,
    );
    const features = this.parseFeatures(body);
    return features.map((feature) =>
      this.toCandidate(feature, { mode, retrievedAt, url, body, rawEvidenceRef }, [
        "ADDRESS_REGISTRY_MATCH",
      ]),
    );
  }

  async findNearPoint(
    point: [number, number],
    options: { maxCandidates?: number; radiusMeters?: number } = {},
  ): Promise<ParcelCandidate[]> {
    const radius = options.radiusMeters ?? 120;
    const max = options.maxCandidates ?? 6;
    const dLon = radius / 88_000;
    const dLat = radius / 111_000;
    const bbox = [
      point[0] - dLon,
      point[1] - dLat,
      point[0] + dLon,
      point[1] + dLat,
    ]
      .map((n) => n.toFixed(6))
      .join("%2C");
    const url = `${BASE}?geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      PROVIDER_ID,
      url,
      `pwd-envelope-${point[0].toFixed(5)}-${point[1].toFixed(5)}`,
      this.tiers,
      this.fetchImpl,
    );
    const features = this.parseFeatures(body);

    const ranked = features
      .map((feature) => {
        const geometry = this.geometryOf(feature);
        const contains = pointInGeometry(point, geometry);
        const center = centroidOf(geometry);
        const dist = distanceMeters(point, center);
        return { feature, geometry, contains, dist };
      })
      .sort((a, b) => {
        if (a.contains !== b.contains) return a.contains ? -1 : 1;
        return a.dist - b.dist;
      })
      .slice(0, max);

    return ranked.map(({ feature, contains, dist }) =>
      this.toCandidate(
        feature,
        { mode, retrievedAt, url, body, rawEvidenceRef },
        contains ? ["CONTAINS_GEOCODE_POINT", "NEAREST"] : ["NEAREST"],
        contains ? 0 : dist,
      ),
    );
  }

  private parseFeatures(body: string): PwdFeature[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ProviderFailure(PROVIDER_ID, "MALFORMED_PAYLOAD", "response is not JSON");
    }
    const fc = parsed as { type?: string; features?: PwdFeature[]; error?: unknown };
    if (fc.error || !Array.isArray(fc.features)) {
      throw new ProviderFailure(PROVIDER_ID, "MALFORMED_PAYLOAD", "response is not a GeoJSON FeatureCollection");
    }
    return fc.features.filter((feature) => feature.geometry && feature.properties);
  }

  private geometryOf(feature: PwdFeature): Wgs84Geometry {
    return ensureWgs84(PROVIDER_ID, feature.geometry, undefined);
  }

  private toCandidate(
    feature: PwdFeature,
    captureInfo: {
      mode: "LIVE" | "CACHED" | "FIXTURE";
      retrievedAt: string;
      url: string;
      body: string;
      rawEvidenceRef?: string;
    },
    matchReasons: ParcelCandidate["matchReasons"],
    distanceMetersValue?: number,
  ): ParcelCandidate {
    const props = feature.properties as {
      brt_id?: string;
      parcelid?: number | string;
      address?: string;
      owner1?: string;
      gross_area?: number;
    };
    const geometry = this.geometryOf(feature);
    return ParcelCandidate.parse({
      capture: {
        provider: "Philadelphia Water Department parcel service (PWD_PARCELS)",
        providerId: PROVIDER_ID,
        mode: captureInfo.mode,
        retrievedAt: captureInfo.retrievedAt,
        canonicalQuery: captureInfo.url,
        rawContentHash: sha256Of(captureInfo.body),
        rawEvidenceRef: captureInfo.rawEvidenceRef,
        authority: "OFFICIAL_GIS",
        note:
          captureInfo.mode === "FIXTURE"
            ? "committed fixture evidence (captured 2026-10-04); not a live retrieval"
            : undefined,
      },
      parcelId: String(props.parcelid ?? props.brt_id ?? ""),
      parcelIdSystem: "PWD parcel id",
      brtId: props.brt_id ? String(props.brt_id) : undefined,
      address: props.address,
      ownerName: props.owner1,
      recordedAreaSqFt: props.gross_area,
      geometry,
      matchReasons,
      distanceMeters: distanceMetersValue ?? computedAreaSqFt(geometry) === 0 ? distanceMetersValue : distanceMetersValue,
    });
  }
}
