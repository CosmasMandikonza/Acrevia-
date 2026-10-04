import { z } from "zod";

/**
 * GIS provider capabilities (issue #4). Providers are replaceable adapters
 * over the Development Graph — they return typed candidate data plus capture
 * metadata; they never touch graph state.
 *
 * Canonical geometry: EPSG:4326 / RFC 7946, [lon, lat]. A provider response in
 * any other CRS is a typed UNSUPPORTED_CRS failure — never silently reprojected.
 *
 * Per-parcel context: structures and zoning are resolved PER confirmed parcel
 * (not at one centroid), preserving parcel-level differences on a campus.
 * Every fact gets its OWN capture — base zoning, overlays, flood, historic,
 * and RCO are separate provider responses with separate source artifacts.
 */

export const CaptureMode = z.enum(["LIVE", "CACHED", "FIXTURE"]);
export type CaptureMode = z.infer<typeof CaptureMode>;

export const CaptureMetadata = z
  .object({
    provider: z.string().min(1),
    /** Stable provider identity, e.g. "phl-pwd-parcels". */
    providerId: z.string().min(1),
    mode: CaptureMode,
    retrievedAt: z.string().min(1),
    /** Canonical URL/query that reproduces this response. */
    canonicalQuery: z.string().min(1),
    /** SHA-256 of the raw response body. */
    rawContentHash: z.string().min(1),
    /** Only set when a durable captured body exists (committed fixture). */
    rawEvidenceRef: z.string().min(1).optional(),
    authority: z.enum([
      "ADOPTED_CODE",
      "OFFICIAL_GIS",
      "OFFICIAL_CITY_TOOL",
      "OFFICIAL_CITY_REFERENCE",
      "PROPERTY_SELF_REPORTED",
      "SECONDARY",
    ]),
    /** Human-readable note when mode is CACHED/FIXTURE. */
    note: z.string().optional(),
    /** Stable logical capture identity: providerId + query fingerprint. */
    logicalCaptureKey: z.string().min(1),
  })
  .strict();
export type CaptureMetadata = z.infer<typeof CaptureMetadata>;

export const ProviderFailureCode = z.enum([
  "UNSUPPORTED_CRS",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "RATE_LIMITED",
  "MALFORMED_PAYLOAD",
  "NO_MATCH",
  "UNAVAILABLE",
]);
export type ProviderFailureCode = z.infer<typeof ProviderFailureCode>;

export class ProviderFailure extends Error {
  readonly code: ProviderFailureCode;
  readonly providerId: string;
  constructor(providerId: string, code: ProviderFailureCode, message: string) {
    super(`[${code}] ${providerId}: ${message}`);
    this.name = "ProviderFailure";
    this.providerId = providerId;
    this.code = code;
  }
}

/** Raw polygon/multipolygon geometry in EPSG:4326, RFC 7946 order. */
export const Wgs84Geometry = z.object({
  type: z.enum(["Polygon", "MultiPolygon"]),
  coordinates: z.array(z.unknown()),
});
export type Wgs84Geometry = z.infer<typeof Wgs84Geometry>;

export const AddressCandidate = z
  .object({
    capture: CaptureMetadata,
    matchedAddress: z.string().min(1),
    point: z.tuple([z.number(), z.number()]),
    geocodeType: z.string().min(1),
    houseNumber: z.string().optional(),
    street: z.string().optional(),
    zip: z.string().optional(),
    jurisdictions: z
      .array(z.object({ layer: z.string(), name: z.string(), geoid: z.string().optional() }).strict())
      .default([]),
  })
  .strict();
export type AddressCandidate = z.infer<typeof AddressCandidate>;

export const ParcelCandidate = z
  .object({
    capture: CaptureMetadata,
    parcelId: z.string().min(1),
    parcelIdSystem: z.string().min(1),
    brtId: z.string().optional(),
    address: z.string().optional(),
    ownerName: z.string().optional(),
    recordedAreaSqFt: z.number().finite().optional(),
    geometry: Wgs84Geometry,
    matchReasons: z
      .array(z.enum(["ADDRESS_REGISTRY_MATCH", "CONTAINS_GEOCODE_POINT", "NEAREST"]))
      .min(1),
    distanceMeters: z.number().finite().optional(),
    /** PWD parcel_id_num for structure cross-lookup where available. */
    pwdParcelNum: z.string().optional(),
  })
  .strict();
export type ParcelCandidate = z.infer<typeof ParcelCandidate>;

export const StructureRecord = z
  .object({
    capture: CaptureMetadata,
    structureId: z.string().min(1),
    buildingName: z.string().optional(),
    address: z.string().optional(),
    footprint: Wgs84Geometry,
    approxHeightFt: z.number().finite().optional(),
    footprintSqFt: z.number().finite().optional(),
    parcelLink: z.string().optional(),
  })
  .strict();
export type StructureRecord = z.infer<typeof StructureRecord>;

/** Zoning base district — its OWN capture, separate from overlays. */
export const ZoningBaseResult = z
  .object({
    capture: CaptureMetadata,
    district: z.string().min(1),
    districtLong: z.string().optional(),
    method: z.string().min(1),
  })
  .strict();
export type ZoningBaseResult = z.infer<typeof ZoningBaseResult>;

/** Zoning overlays — its OWN capture, separate from the base district. */
export const ZoningOverlaysResult = z
  .object({
    capture: CaptureMetadata,
    overlays: z
      .array(z.object({ name: z.string().min(1), codeSection: z.string().optional() }).strict())
      .default([]),
    method: z.string().min(1),
  })
  .strict();
export type ZoningOverlaysResult = z.infer<typeof ZoningOverlaysResult>;

export const FloodResult = z
  .object({
    capture: CaptureMetadata,
    zone: z.string().optional(),
    description: z.string().optional(),
    method: z.string().min(1),
  })
  .strict();
export type FloodResult = z.infer<typeof FloodResult>;

export const HistoricResult = z
  .object({
    capture: CaptureMetadata,
    districtFeature: z.string().optional(),
    method: z.string().min(1),
  })
  .strict();
export type HistoricResult = z.infer<typeof HistoricResult>;

export const RcoResult = z
  .object({
    capture: CaptureMetadata,
    names: z.array(z.string()).default([]),
    method: z.string().min(1),
  })
  .strict();
export type RcoResult = z.infer<typeof RcoResult>;

/** Per-parcel resolved context — each confirmed parcel gets its own zoning,
 *  structures, and site context, preserving campus-level differences. */
export const ResolvedParcelContext = z
  .object({
    parcelId: z.string().min(1),
    zoningBase: ZoningBaseResult.optional(),
    zoningOverlays: ZoningOverlaysResult.optional(),
    structures: z.array(StructureRecord).default([]),
    flood: FloodResult.optional(),
    historic: HistoricResult.optional(),
    rco: RcoResult.optional(),
    /** Typed capability failures for THIS parcel (additive, not silent). */
    failures: z
      .array(
        z
          .object({
            capability: z.enum(["zoning-base", "zoning-overlays", "structures", "flood", "historic", "rco"]),
            code: ProviderFailureCode,
            message: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type ResolvedParcelContext = z.infer<typeof ResolvedParcelContext>;

export interface Geocoder {
  readonly providerId: string;
  geocode(query: string): Promise<AddressCandidate[]>;
}

export interface ParcelProvider {
  readonly providerId: string;
  findByAddress(houseNumber: string, street: string): Promise<ParcelCandidate[]>;
  findNearPoint(
    point: [number, number],
    options?: { maxCandidates?: number; radiusMeters?: number },
  ): Promise<ParcelCandidate[]>;
}

export interface StructureProvider {
  readonly providerId: string;
  /** Discover structures ON a parcel — by official parcel link where available,
   *  otherwise by polygon/envelope intersection with spatial filtering. */
  findByParcel(parcel: { parcelId: string; geometry: Wgs84Geometry }): Promise<StructureRecord[]>;
}

export interface ZoningProvider {
  readonly providerId: string;
  baseDistrictAtPoint(point: [number, number]): Promise<ZoningBaseResult>;
  overlaysAtPoint(point: [number, number]): Promise<ZoningOverlaysResult>;
}

export interface ContextProvider {
  readonly providerId: string;
  floodAtPoint(point: [number, number]): Promise<FloodResult>;
  historicAtPoint(point: [number, number]): Promise<HistoricResult>;
  rcoAtPoint(point: [number, number]): Promise<RcoResult>;
}
