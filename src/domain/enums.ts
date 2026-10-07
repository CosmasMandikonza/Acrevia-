import { z } from "zod";

/**
 * Acrevia Development Graph vocabularies.
 *
 * These are deliberately separate axes. They must never be collapsed into one
 * "status" field:
 *
 *   AuthorityLevel  — where a *source* sits in the source hierarchy
 *   EvidenceState   — how well a *factual claim* is supported
 *   OriginKind      — where an input *originated* (provenance, not confidence)
 *   ComputationState— whether a deterministic evaluation passed
 *   FreshnessState  — whether a derived artifact can still be trusted
 *   ReviewState     — human workflow state
 */

export const AuthorityLevel = z.enum([
  "ADOPTED_CODE",
  "OFFICIAL_GIS",
  "OFFICIAL_CITY_TOOL",
  "OFFICIAL_CITY_REFERENCE",
  "PROPERTY_SELF_REPORTED",
  "SECONDARY",
]);
export type AuthorityLevel = z.infer<typeof AuthorityLevel>;

export const EvidenceState = z.enum([
  "VERIFIED",
  "SOURCE_CONFIRMED",
  "CONFLICT",
  "UNKNOWN",
  "EXPERT_REQUIRED",
  "STALE",
]);
export type EvidenceState = z.infer<typeof EvidenceState>;

export const OriginKind = z.enum([
  "SOURCE_DERIVED",
  "USER_DECLARED",
  "MODELER_DECLARED",
  "SYSTEM_DERIVED",
]);
export type OriginKind = z.infer<typeof OriginKind>;

export const ComputationState = z.enum([
  "SATISFIED",
  "VIOLATED",
  "UNKNOWN",
  "NOT_EVALUATED",
  "EXPERT_REQUIRED",
]);
export type ComputationState = z.infer<typeof ComputationState>;

export const FreshnessState = z.enum(["CURRENT", "STALE", "INVALIDATED"]);
export type FreshnessState = z.infer<typeof FreshnessState>;

export const ReviewState = z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "WAIVED"]);
export type ReviewState = z.infer<typeof ReviewState>;

export const RegulationCurrentness = z.enum(["CURRENT", "STALE", "UNKNOWN"]);
export type RegulationCurrentness = z.infer<typeof RegulationCurrentness>;

export const NodeKind = z.enum([
  "property",
  "parcel",
  "structure",
  "jurisdiction",
  "source-artifact",
  "claim",
  "regulation",
  "constraint",
  "mission-constraint",
  "assumption",
  "scenario",
  "constraint-result",
  "scenario-certificate",
  "expert-review",
  "stakeholder-view",
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const DependencyRole = z.enum([
  "supported-by", // claim        -> source artifact
  "interpreted-from", // regulation   -> claim
  "materializes", // constraint   -> regulation
  "evaluated-under", // result       -> constraint
  "scenario-input", // scenario     -> result / constraint / mission / assumption / parcel
  "certifies", // certificate  -> scenario
  "comprises", // property     -> parcel
  "located-on", // structure    -> parcel
  "concerns", // expert review-> affected node
  "presents", // view         -> scenario
  "grounded-in", // entity       -> claim it grounds its facts on
  "mission-applies-to", // mission-constraint -> structure it protects (preserve-structure)
]);
export type DependencyRole = z.infer<typeof DependencyRole>;

export const ClaimPredicate = z.enum([
  "zoning-district",
  "zoning-overlays",
  "use-permission",
  "max-height",
  "setback-front",
  "setback-side",
  "setback-rear",
  "lot-width",
  "lot-area",
  "occupied-area",
  "density-formula",
  "far",
  "parking-requirement",
  "overlay-restriction",
  "density-bonus",
  "parcel-area",
  "building-footprint-area",
  "building-height",
  "building-name",
  "building-use",
  "year-built",
  "site-flood",
  "site-historic-screen",
  "owner-of-record",
  "rco-coverage",
  // GIS resolution predicates (issue #4)
  "geocoded-address",
  "parcel-source-id",
  "parcel-geometry",
  "structure-footprint",
]);
export type ClaimPredicate = z.infer<typeof ClaimPredicate>;
