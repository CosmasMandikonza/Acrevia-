import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CensusGeocoder,
  FixtureCaptureStore,
  KeyedAisEnrichment,
  LiContextProvider,
  LiStructureProvider,
  LiZoningProvider,
  MemoryCaptureStore,
  PwdParcelProvider,
} from "./index";

/**
 * Server-side provider composition root. Stateless across requests: memory
 * captures are best-effort this-process only; the durable fallback is the
 * committed fixture store. No writable-filesystem dependence, no keys in the
 * client (all providers are keyless; AIS enrichment activates only when a
 * Gatekeeper key exists server-side).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let cached: ReturnType<typeof buildProviders> | undefined;

export function buildProviders() {
  const memory = new MemoryCaptureStore();
  const fixture = new FixtureCaptureStore(
    join(repoRoot, "docs", "benchmarks", "calvary-memorial-philadelphia", "raw", "gis"),
  );
  const tiers = { memory, fixture };
  return {
    geocoder: new CensusGeocoder(tiers),
    parcels: new PwdParcelProvider(tiers),
    zoning: new LiZoningProvider(tiers),
    structures: new LiStructureProvider(tiers),
    context: new LiContextProvider(tiers),
    ais: new KeyedAisEnrichment({ AIS_GATEKEEPER_KEY: process.env.AIS_GATEKEEPER_KEY }),
  };
}

export function providers() {
  cached ??= buildProviders();
  return cached;
}
