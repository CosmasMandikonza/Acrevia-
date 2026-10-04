import { ProviderFailure } from "../capabilities";
import type { CaptureStore } from "../capture-store";

/**
 * Shared LIVE → CACHED → FIXTURE fetch helper for keyless public providers.
 * Tier semantics are truthful: a memory hit is CACHED (this-process capture),
 * a committed-fixture hit is FIXTURE (real evidence captured earlier, labeled),
 * a fresh network response is LIVE. rawEvidenceRef is only produced for the
 * durable fixture tier — in-memory bodies never masquerade as durable refs.
 */

export type FetchTiers = {
  memory: CaptureStore;
  fixture?: CaptureStore;
  fixtureDirPrefix?: string;
};

export type TieredResponse = {
  body: string;
  mode: "LIVE" | "CACHED" | "FIXTURE";
  retrievedAt: string;
  rawEvidenceRef?: string;
};

export async function fetchWithTiers(
  providerId: string,
  url: string,
  fixtureKey: string,
  tiers: FetchTiers,
  fetchImpl: typeof fetch,
  timeoutMs = 8000,
): Promise<TieredResponse> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Acrevia/0.1 (Gloo AI Hackathon; church land feasibility research)",
        Accept: "application/json",
      },
    });
    if (response.status === 429) {
      throw new ProviderFailure(providerId, "RATE_LIMITED", "provider rate limited");
    }
    if (!response.ok) {
      throw new ProviderFailure(providerId, "PROVIDER_ERROR", `HTTP ${response.status}`);
    }
    const body = await response.text();
    const retrievedAt = new Date().toISOString();
    tiers.memory.put(providerId, fixtureKey, { body, retrievedAt });
    return { body, mode: "LIVE", retrievedAt };
  } catch (error) {
    if (error instanceof ProviderFailure && (error.code === "RATE_LIMITED" || error.code === "MALFORMED_PAYLOAD")) {
      // fall through to caches below
    } else if (!(error instanceof ProviderFailure) && !(error instanceof Error)) {
      throw error;
    }
    const memory = tiers.memory.get(providerId, fixtureKey);
    if (memory) {
      return { body: memory.body, mode: "CACHED", retrievedAt: memory.retrievedAt };
    }
    const fixture = tiers.fixture?.get(providerId, fixtureKey);
    if (fixture) {
      return {
        body: fixture.body,
        mode: "FIXTURE",
        retrievedAt: fixture.retrievedAt,
        rawEvidenceRef: `${tiers.fixtureDirPrefix ?? "docs/benchmarks/calvary-memorial-philadelphia/raw/gis"}/${fixtureKey}.json`,
      };
    }
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(providerId, "PROVIDER_TIMEOUT", "provider unavailable and no capture available");
  }
}
