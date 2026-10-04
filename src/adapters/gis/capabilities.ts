import { z } from "zod";

/**
 * GIS provider capabilities (issue #4). Providers are replaceable adapters
 * over the Development Graph — they return typed candidate data plus capture
 * metadata; they never touch graph state.
 *
 * Canonical geometry: EPSG:4326 / RFC 7946, [lon, lat]. A provider response in
 * any other CRS is a typed UNSUPPORTED_CRS failure — never silently reprojected.
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
    /** Census/TIGER points are street-range interpolations: a HINT, never
     *  parcel identity. Downstream code must never treat this as a parcel. */
    point: z.tuple([z.number(), z.number()]),
    /** e.g. "tiger-interpolated" | "exact" | ... provider-labeled. */
    geocodeType: z.string().min(1),
    houseNumber: z.string().optional(),
    street: z.string().optional(),
    zip: z.string().optional(),
    /** Extra jurisdiction cross-evidence the geocoder returned, if any. */
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
    /** Why this parcel is a candidate — the anti-silent-pick paper trail. */
    matchReasons: z
      .array(z.enum(["ADDRESS_REGISTRY_MATCH", "CONTAINS_GEOCODE_POINT", "NEAREST"]))
      .min(1),
    distanceMeters: z.number().finite().optional(),
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

export const ZoningAssignmentResult = z
  .object({
    capture: CaptureMetadata,
    baseDistrict: z.string().min(1),
    baseDistrictLong: z.string().optional(),
    overlays: z
      .array(
        z
          .object({
            name: z.string().min(1),
            codeSection: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    method: z.string().min(1),
  })
  .strict();
export type ZoningAssignmentResult = z.infer<typeof ZoningAssignmentResult>;

export const SiteContextResult = z
  .object({
    capture: CaptureMetadata,
    floodZone: z.string().optional(),
    floodZoneDescription: z.string().optional(),
    historicDistrict: z.string().optional(),
    rcoNames: z.array(z.string()).default([]),
  })
  .strict();
export type SiteContextResult = z.infer<typeof SiteContextResult>;

export interface Geocoder {
  readonly providerId: string;
  geocode(query: string): Promise<AddressCandidate[]>;
}

export interface ParcelProvider {
  readonly providerId: string;
  /** Parcels whose registry address matches the parsed address text. */
  findByAddress(houseNumber: string, street: string): Promise<ParcelCandidate[]>;
  /** Parcels near a point: containment + nearest-K, ranked, reasons labeled. */
  findNearPoint(
    point: [number, number],
    options?: { maxCandidates?: number; radiusMeters?: number },
  ): Promise<ParcelCandidate[]>;
}

export interface StructureProvider {
  readonly providerId: string;
  findByParcelPoint(point: [number, number]): Promise<StructureRecord[]>;
}

export interface ZoningProvider {
  readonly providerId: string;
  assignAtPoint(point: [number, number]): Promise<ZoningAssignmentResult>;
}

export interface ContextProvider {
  readonly providerId: string;
  contextAtPoint(point: [number, number]): Promise<SiteContextResult>;
}
