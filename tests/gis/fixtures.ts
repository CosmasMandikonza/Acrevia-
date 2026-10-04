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
  ZoningBaseResult,
  ZoningOverlaysResult,
  FloodResult,
  HistoricResult,
  RcoResult,
  StructureRecord,
} from "../../src/adapters/gis";

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
    private readonly base: ZoningBaseResult | Error,
    private readonly overlays: ZoningOverlaysResult | Error = new Error("default overlays failure"),
  ) {}
  async baseDistrictAtPoint(): Promise<ZoningBaseResult> {
    if (this.base instanceof Error) throw this.base;
    return this.base;
  }
  async overlaysAtPoint(): Promise<ZoningOverlaysResult> {
    if (this.overlays instanceof Error) throw this.overlays;
    return this.overlays;
  }
}

export class ScriptedStructures implements StructureProvider {
  readonly providerId = "scripted-structures";
  constructor(private readonly result: StructureRecord[] | Error) {}
  async findByParcel(): Promise<StructureRecord[]> {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class ScriptedContext implements ContextProvider {
  readonly providerId = "scripted-context";
  constructor(
    private readonly flood: FloodResult | Error = new Error("flood unavailable"),
    private readonly historic: HistoricResult | Error = new Error("historic unavailable"),
    private readonly rco: RcoResult | Error = new Error("rco unavailable"),
  ) {}
  async floodAtPoint(): Promise<FloodResult> {
    if (this.flood instanceof Error) throw this.flood;
    return this.flood;
  }
  async historicAtPoint(): Promise<HistoricResult> {
    if (this.historic instanceof Error) throw this.historic;
    return this.historic;
  }
  async rcoAtPoint(): Promise<RcoResult> {
    if (this.rco instanceof Error) throw this.rco;
    return this.rco;
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
    logicalCaptureKey: "scripted:test",
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
    pwdParcelNum: "494018",
    ...overrides,
  });
}

export function makeZoningBase(overrides: Record<string, unknown> = {}): ZoningBaseResult {
  return ZoningBaseResult.parse({
    capture: baseCapture({ logicalCaptureKey: "scripted:zoning-base" }),
    district: "RM1",
    districtLong: "RM-1",
    method: "scripted point-intersect",
    ...overrides,
  });
}

export function makeZoningOverlays(overrides: Record<string, unknown> = {}): ZoningOverlaysResult {
  return ZoningOverlaysResult.parse({
    capture: baseCapture({ logicalCaptureKey: "scripted:zoning-overlays", rawContentHash: "b".repeat(64) }),
    overlays: [{ name: "/SIX Sixth District Overlay District" }],
    method: "scripted point-intersect",
    ...overrides,
  });
}

export function makeFlood(overrides: Record<string, unknown> = {}): FloodResult {
  return FloodResult.parse({
    capture: baseCapture({ logicalCaptureKey: "scripted:flood", rawContentHash: "c".repeat(64) }),
    zone: "X",
    description: "AREA OF MINIMAL FLOOD HAZARD",
    method: "scripted point-intersect",
    ...overrides,
  });
}

export function makeStructure(overrides: Record<string, unknown> = {}): StructureRecord {
  return StructureRecord.parse({
    capture: baseCapture({ logicalCaptureKey: "scripted:structures", rawContentHash: "d".repeat(64) }),
    structureId: "1282177",
    buildingName: "Calvary Memorial Church",
    footprint: { type: "Polygon", coordinates: [SQUARE.map(([lon, lat]) => [lon + 0.001, lat + 0.001])] },
    approxHeightFt: 29,
    footprintSqFt: 31272,
    ...overrides,
  });
}

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf-8");
}
