import { AddressCandidate, Geocoder, ProviderFailure } from "../capabilities";
import { sha256Of } from "../capture-store";
import { fetchWithTiers, type FetchTiers } from "./provider-fetch";

/**
 * US Census Geocoder — the public, supported, keyless address-candidate source.
 * Census points are MAF/TIGER address-range interpolations: they are HINTS for
 * parcel discovery, never parcel identity (issue #4 non-negotiable). Anonymous
 * AIS access is not a supported integration; AIS is keyed enrichment only.
 */

const PROVIDER_ID = "us-census-geocoder";
const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const BENCHMARK = "Public_AR_Current";
const VINTAGE = "Census2020_Current";

function fixtureKeyFor(query: string): string {
  return `census-${query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

export class CensusGeocoder implements Geocoder {
  readonly providerId = PROVIDER_ID;

  constructor(
    private readonly tiers: FetchTiers,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async geocode(query: string): Promise<AddressCandidate[]> {
    const url = `${ENDPOINT}?address=${encodeURIComponent(query)}&benchmark=${BENCHMARK}&vintage=${VINTAGE}&format=json`;
    const { body, mode, retrievedAt, rawEvidenceRef } = await fetchWithTiers(
      PROVIDER_ID,
      url,
      fixtureKeyFor(query),
      this.tiers,
      this.fetchImpl,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ProviderFailure(PROVIDER_ID, "MALFORMED_PAYLOAD", "response is not JSON");
    }
    const result = (parsed as { result?: { addressMatches?: unknown[] } }).result;
    const matches = Array.isArray(result?.addressMatches) ? result!.addressMatches : [];

    return matches.map((match) => {
      const m = match as {
        matchedAddress?: string;
        coordinates?: { x?: number; y?: number };
        addressComponents?: { fromAddress?: string; streetName?: string; zip?: string };
        tigerLine?: { side?: string };
        geographies?: Record<string, Array<{ NAME?: string; GEOID?: string }>>;
      };
      if (
        !m.matchedAddress ||
        typeof m.coordinates?.x !== "number" ||
        typeof m.coordinates?.y !== "number"
      ) {
        throw new ProviderFailure(PROVIDER_ID, "MALFORMED_PAYLOAD", "address match missing address/coordinates");
      }
      // Census x = longitude, y = latitude; RFC 7946 order is [lon, lat].
      const point: [number, number] = [m.coordinates.x, m.coordinates.y];
      const jurisdictions: AddressCandidate["jurisdictions"] = [];
      const geos = m.geographies ?? {};
      for (const layer of ["States", "Counties", "Census Tracts", "Congressional Districts"]) {
        const entry = geos[layer]?.[0];
        if (entry?.NAME) {
          jurisdictions.push({
            layer: layer.replace("Census ", ""),
            name: entry.NAME,
            geoid: entry.GEOID,
          });
        }
      }
      return AddressCandidate.parse({
        capture: {
          provider: "US Census Geocoder (MAF/TIGER)",
          providerId: PROVIDER_ID,
          mode,
          retrievedAt,
          canonicalQuery: url,
          rawContentHash: sha256Of(body),
          rawEvidenceRef,
          authority: "OFFICIAL_GIS",
          logicalCaptureKey: `${PROVIDER_ID}:geocode:${encodeURIComponent(query).slice(0, 60)}`,
          note:
            mode === "FIXTURE"
              ? "committed fixture evidence (captured 2026-10-04); not a live retrieval"
              : mode === "CACHED"
                ? "served from runtime capture"
                : undefined,
        },
        matchedAddress: m.matchedAddress,
        point,
        geocodeType: `tiger-interpolated${m.tigerLine?.side ? ` (side ${m.tigerLine.side})` : ""}`,
        houseNumber: m.addressComponents?.fromAddress,
        street: m.addressComponents?.streetName,
        zip: m.addressComponents?.zip,
        jurisdictions,
      });
    });
  }
}
