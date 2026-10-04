import { z } from "zod";

/**
 * Zod schemas for the benchmark fixture format (acrevia.benchmark.* — ADR 0002).
 * These types live ONLY inside the benchmark adapter. Nothing in src/domain or
 * the application may import them; the adapter maps fixtures into canonical
 * Development Graph nodes and this is the only place fixture shapes exist.
 */

export const FixtureSource = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().min(1),
  authorityLevel: z.enum([
    "ADOPTED_CODE",
    "OFFICIAL_GIS",
    "OFFICIAL_CITY_TOOL",
    "OFFICIAL_CITY_REFERENCE",
    "PROPERTY_SELF_REPORTED",
    "SECONDARY",
  ]),
  retrievedAt: z.string().min(1),
  purpose: z.string().min(1),
  rawEvidence: z.string().optional(),
  notes: z.string().optional(),
});
export type FixtureSource = z.infer<typeof FixtureSource>;

export const SourcesManifest = z.object({
  schema: z.string().min(1),
  property: z.string().min(1),
  sources: z.array(FixtureSource).min(1),
});
export type SourcesManifest = z.infer<typeof SourcesManifest>;

export const FixtureRule = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  statement: z.string().min(1),
  value: z.union([z.number(), z.string(), z.null()]).optional(),
  unit: z.string().nullable().optional(),
  sourceRef: z.string().min(1),
  codeSection: z.string().nullable().optional(),
  authorityLevel: z.enum([
    "ADOPTED_CODE",
    "OFFICIAL_GIS",
    "OFFICIAL_CITY_TOOL",
    "OFFICIAL_CITY_REFERENCE",
    "PROPERTY_SELF_REPORTED",
    "SECONDARY",
  ]),
  status: z.enum([
    "VERIFIED",
    "SOURCE_CONFIRMED",
    "ASSUMPTION",
    "CONFLICT",
    "UNKNOWN",
    "EXPERT_REQUIRED",
    "STALE",
  ]),
  legalFinality: z.string().min(1),
  retrievedAt: z.string().min(1),
  verbatimQuote: z.string().optional(),
  notes: z.string().optional(),
});
export type FixtureRule = z.infer<typeof FixtureRule>;

export const ExpectedRules = z.object({
  schema: z.string().min(1),
  property: z.string().min(1),
  rules: z.array(FixtureRule).min(1),
});
export type ExpectedRules = z.infer<typeof ExpectedRules>;

export const FixtureQuestion = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  kind: z.enum(["UNKNOWN", "EXPERT_REQUIRED"]),
  question: z.string().min(1),
  whyItMatters: z.string().min(1),
});
export type FixtureQuestion = z.infer<typeof FixtureQuestion>;

export const OpenQuestions = z.object({
  schema: z.string().min(1),
  property: z.string().min(1),
  questions: z.array(FixtureQuestion).min(1),
});
export type OpenQuestions = z.infer<typeof OpenQuestions>;

export const ParcelFixture = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.array(z.unknown()),
  }),
});
export type ParcelFixture = z.infer<typeof ParcelFixture>;
