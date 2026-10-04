import { ProviderFailure } from "../capabilities";

/**
 * Philadelphia AIS — OPTIONAL keyed enrichment only (issue #4 addendum).
 * Anonymous AIS access is NOT a supported integration; the product never
 * requires AIS. When an approved Gatekeeper key is configured
 * (AIS_GATEKEEPER_KEY), AIS may sharpen address candidates with
 * Philadelphia-specific metadata. Without a key this adapter reports
 * UNAVAILABLE and the pipeline proceeds on the supported path.
 */

export interface AisEnrichment {
  readonly available: boolean;
  readonly providerId: string;
  enrich(query: string): Promise<{
    matchType: string;
    geocodeType: string;
    pwdParcelId?: string;
    opaAccount?: string;
    bin?: string;
    councilDistrict?: string;
  }>;
}

export class KeyedAisEnrichment implements AisEnrichment {
  readonly providerId = "phila-ais";
  readonly available: boolean;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(env: { AIS_GATEKEEPER_KEY?: string }, fetchImpl: typeof fetch = fetch) {
    this.apiKey = env.AIS_GATEKEEPER_KEY?.trim() || undefined;
    this.available = Boolean(this.apiKey);
    this.fetchImpl = fetchImpl;
  }

  async enrich(query: string) {
    if (!this.apiKey) {
      throw new ProviderFailure(this.providerId, "UNAVAILABLE", "no AIS Gatekeeper key configured");
    }
    const url = `https://api.phila.gov/ais/v1/search/${encodeURIComponent(query)}?include_units=false`;
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Gatekeeper ${this.apiKey}`,
        "User-Agent": "Acrevia/0.1 (Gloo AI Hackathon)",
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new ProviderFailure(this.providerId, "PROVIDER_ERROR", `AIS HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      features?: Array<{
        match_type?: string;
        geocode_type?: string;
        properties?: Record<string, unknown>;
      }>;
    };
    const feature = payload.features?.[0];
    if (!feature?.properties) {
      throw new ProviderFailure(this.providerId, "NO_MATCH", "AIS returned no features");
    }
    const props = feature.properties;
    return {
      matchType: feature.match_type ?? "unknown",
      geocodeType: feature.geocode_type ?? "unknown",
      pwdParcelId: props.pwd_parcel_id ? String(props.pwd_parcel_id) : undefined,
      opaAccount: props.opa_account_num ? String(props.opa_account_num) : undefined,
      bin: props.bin ? String(props.bin) : undefined,
      councilDistrict: props.council_district_2024 ? String(props.council_district_2024) : undefined,
    };
  }
}
