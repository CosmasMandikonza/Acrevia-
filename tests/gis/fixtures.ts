import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  CensusGeocoder,
  LiContextProvider,
  LiStructureProvider,
  LiZoningProvider,
  MemoryCaptureStore,
  PwdParcelProvider,
  FixtureCaptureStore,
  AddressCandidate,
  ParcelCandidate,
  type Geocoder,
  type ParcelProvider,
  type StructureProvider,
  type ZoningProvider,
  type ContextProvider,
  type FetchTiers,
} from "../../src/adapters/gis";

/**
 * Deterministic fixture providers over the committed canonical evidence
 * (docs/benchmarks/calvary-memorial-philadelphia/raw/gis). All tests run the
 * exact provider classes against fixture-backed capture stores — the same
 * parsing code paths as live, replaying real captured city responses.
 */

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "benchmarks",
  "calvary-memorial-philadelphia",
  "raw",
  "gis",
);

export const FIXTURE_NOW = "2026-10-04T17:41:00.000Z";

export function fixtureTiers(memory = new MemoryCaptureStore()): FetchTiers {
  return { memory, fixture: new FixtureCaptureStore(FIXTURE_DIR) };
}

/** fetch stub that always fails — forcing the fixture tier deterministically. */
export const offlineFetch: typeof fetch = (() => {
  throw new Error("network disabled for fixture tests");
}) as unknown as typeof fetch;

export function fixtureStack() {
  const tiers = fixtureTiers();
  return {
    tiers,
    geocoder: new CensusGeocoder(tiers, offlineFetch),
    parcels: new PwdParcelProvider(tiers, offlineFetch),
    zoning: new LiZoningProvider(tiers, offlineFetch),
    structures: new LiStructureProvider(tiers, offlineFetch),
    context: new LiContextProvider(tiers, offlineFetch),
  };
}

// ---------------------------------------------------------------------------
// Synthetic scenario providers (typed ambiguity/edge cases)
// ---------------------------------------------------------------------------

export class ScriptedGeocoder implements Geocoder {
  readonly providerId = "scripted-geocoder";
  constructor(private readonly candidates: AddressCandidate[]) {}
  async geocode(): Promise<AddressCandidate[]> {
    return this.candidates;
  }
}

export class ScriptedParcels implements ParcelProvider {
  readonly providerId = "scripted-parcels";
  constructor(
    private readonly registry: ParcelCandidate[],
    private readonly near: ParcelCandidate[],
  ) {}
  async findByAddress(): Promise<ParcelCandidate[]> {
    return this.registry;
  }
  async findNearPoint(): Promise<ParcelCandidate[]> {
    return this.near;
  }
}

export class ScriptedZoning implements ZoningProvider {
  readonly providerId = "scripted-zoning";
  constructor(
    private readonly result: Awaited<ReturnType<ZoningProvider["assignAtPoint"]>>,
  ) {}
  async assignAtPoint() {
    return this.result;
  }
}

export class ScriptedStructures implements StructureProvider {
  readonly providerId = "scripted-structures";
  constructor(
    private readonly records: Awaited<ReturnType<StructureProvider["findByParcelPoint"]>>,
  ) {}
  async findByParcelPoint() {
    return this.records;
  }
}

export class ScriptedContext implements ContextProvider {
  readonly providerId = "scripted-context";
  async contextAtPoint(): Promise<never> {
    throw new Error("scripted context failure");
  }
}

// ---------------------------------------------------------------------------

const SQUARE: [number, number][] = [
  [-75.06, 40.04],
  [-75.05, 40.04],
  [-75.05, 40.05],
  [-75.06, 40.05],
  [-75.06, 40.04],
];

export function baseCapture(overrides: Record<string, unknown> = {}) {
  return {
    provider: "Scripted Fixture Provider",
    providerId: "scripted",
    mode: "FIXTURE" as const,
    retrievedAt: FIXTURE_NOW,
    canonicalQuery: "https://example.test/query",
    rawContentHash: "a".repeat(64),
    authority: "OFFICIAL_GIS" as const,
    ...overrides,
  };
}

export function makeAddressCandidate(overrides: Record<string, unknown> = {}): AddressCandidate {
  return AddressCandidate.parse({
    capture: baseCapture(),
    matchedAddress: "7200 ROOSEVELT BLVD, PHILADELPHIA, PA, 19149",
    point: [-75.05645, 40.04307],
    geocodeType: "tiger-interpolated (side L)",
    houseNumber: "7200",
    street: "ROOSEVELT",
    zip: "19149",
    jurisdictions: [],
    ...overrides,
  });
}

export function makeParcelCandidate(overrides: Record<string, unknown> = {}): ParcelCandidate {
  return ParcelCandidate.parse({
    capture: baseCapture(),
    parcelId: "494018",
    parcelIdSystem: "PWD parcel id",
    brtId: "778273000",
    address: "7200-50 E ROOSEVELT BLVD",
    ownerName: "CALVARY MEMORIAL CHURCH",
    recordedAreaSqFt: 119295,
    geometry: { type: "Polygon", coordinates: [SQUARE] },
    matchReasons: ["NEAREST"],
    ...overrides,
  });
}

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf-8");
}
