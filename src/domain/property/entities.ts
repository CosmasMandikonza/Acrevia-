import { z } from "zod";

/**
 * Property-layer identity entities.
 *
 * ONE TRUTH, MANY REFERENCES: these entities hold stable structural/identifying
 * information only. Externally sourced descriptive attributes (zoning district,
 * building height, use, year built…) exist exactly once, as Claims, referenced
 * through claim-id lists. Documented materializations: parcel geometry and the
 * recorded-vs-computed area structure (geometry-adjacent provenance, core
 * domain state).
 */

export const GeometryRecord = z
  .object({
    /** GeoJSON geometry object (Polygon/MultiPolygon). Validated shallowly here;
     *  deep geometric validation belongs to GIS (#4/#8). */
    geojson: z.unknown(),
    crs: z.string(),
    validity: z.enum(["unchecked", "valid", "invalid"]),
    derived: z.boolean(),
    sourceClaimId: z.string().optional(),
  })
  .strict();
export type GeometryRecord = z.infer<typeof GeometryRecord>;

export const PropertySemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("property"),
    displayName: z.string().min(1),
    parcelIds: z.array(z.string()).min(1),
    primaryParcelId: z.string(),
    /** Display-only. An address is NOT project identity (ADR 0001). */
    address: z
      .object({
        text: z.string(),
        note: z.literal("display-only; not project identity"),
      })
      .strict()
      .optional(),
    ownerOfRecordClaimId: z.string().optional(),
  })
  .strict();
export type PropertySemantic = z.infer<typeof PropertySemantic>;

/** Cross-field rule, enforced where properties are created/imported. */
export function validatePropertyRules(property: PropertySemantic): string[] {
  if (!property.parcelIds.includes(property.primaryParcelId)) {
    return ["primaryParcelId must be one of parcelIds"];
  }
  return [];
}

export const ParcelSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("parcel"),
    parcelIdSystem: z.string().min(1),
    parcelNumber: z.string().min(1),
    geometry: GeometryRecord,
    /** Source-recorded area — never conflated with computed areas. */
    recordedArea: z
      .object({ value: z.number().finite(), unit: z.literal("sq_ft") })
      .strict()
      .optional(),
    computedAreas: z
      .array(
        z
          .object({
            method: z.string().min(1),
            valueSqFt: z.number().finite(),
          })
          .strict(),
      )
      .default([]),
    claimIds: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();
export type ParcelSemantic = z.infer<typeof ParcelSemantic>;

export const StructureSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("structure"),
    parcelId: z.string(),
    /** Footprint geometry is core structural state (documented materialization). */
    footprint: GeometryRecord.optional(),
    /** Height, use, name, year built etc. live as Claims, referenced here. */
    attributeClaimIds: z.array(z.string()).default([]),
    notes: z.string().optional(),
  })
  .strict();
export type StructureSemantic = z.infer<typeof StructureSemantic>;

export const JurisdictionSemantic = z
  .object({
    id: z.string().min(1),
    kind: z.literal("jurisdiction"),
    jurisdiction: z
      .object({
        city: z.string(),
        state: z.string(),
        country: z.string(),
      })
      .strict(),
    /** How the assignment was made — recorded honestly (e.g. point-intersect). */
    method: z.string().min(1),
    /** The zoning-district assertion itself is a Claim, not a field here. */
    claimIds: z.array(z.string()).default([]),
  })
  .strict();
export type JurisdictionSemantic = z.infer<typeof JurisdictionSemantic>;
