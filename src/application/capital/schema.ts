import { z } from "zod";

/**
 * Capital (issue #12) — typed input contracts.
 *
 * Capital is a THIN deterministic layer over the trusted scenario pipeline:
 * there is exactly ONE calculation engine (calculate.ts) and ONE trusted route
 * (/api/capital/evaluate). Ownership pathways are PRESETS over that engine —
 * they change a small explicit set of default assumptions and explanatory
 * text, never the math.
 *
 * Every number here is a PRELIMINARY planning assumption, editable and
 * labeled as such. Acrevia asserts NO public-program facts: funding
 * categories are unattributed placeholders until a professional sources
 * them (EXPERT_REQUIRED), which is how AC6 is satisfied — by explicit
 * non-assertion plus provenance boundaries, never invented program data.
 *
 * This module is client-safe (zod + constants only); hashing and arithmetic
 * live in calculate.ts.
 */

export const OWNERSHIP_PATHWAYS = [
  "ground-lease",
  "church-led",
  "joint-development",
] as const;
export type OwnershipPathway = (typeof OWNERSHIP_PATHWAYS)[number];
export const OwnershipPathwaySchema = z.enum(OWNERSHIP_PATHWAYS);

export type OpexMode = "pct" | "per-home";

/** Numeric assumption keys (opexMode is the single enum assumption). */
export type CapitalNumericKey =
  | "hardCostPerSqFt"
  | "softCostPct"
  | "contingencyPct"
  | "siteInfrastructure"
  | "financingCarry"
  | "landCost"
  | "annualRevenuePerHome"
  | "occupancyPct"
  | "operatingExpensePct"
  | "annualOperatingExpensePerHome"
  | "affordabilityTargetPct"
  | "affordableRevenueFactor"
  | "churchContribution"
  | "partnerContribution"
  | "debtProceeds"
  | "grantsSubsidy"
  | "otherFunding";

export type CapitalAssumptionKey = CapitalNumericKey | "opexMode";

/** The complete normalized assumption set the single engine consumes. */
export type CapitalAssumptions = Record<CapitalNumericKey, number> & {
  opexMode: OpexMode;
};

/** User edits: any subset of assumptions (validated, bounded). */
export type CapitalAssumptionOverrides = Partial<
  Record<CapitalNumericKey, number>
> & {
  opexMode?: OpexMode;
};

export type AssumptionGroup = "cost" | "operating" | "funding";

export type CapitalAssumptionSpec = {
  key: CapitalNumericKey;
  label: string;
  unit: string;
  group: AssumptionGroup;
  min: number;
  max: number;
  step: number;
  /** Why the default is preliminary and what a professional would replace. */
  rationale: string;
};

/**
 * Ordered registry — the single source of labels, units, bounds, and
 * rationale for the API response, the UI editor, and the zod schema.
 */
export const CAPITAL_ASSUMPTIONS: readonly CapitalAssumptionSpec[] = [
  {
    key: "hardCostPerSqFt",
    label: "Hard cost per sq ft",
    unit: "USD/sq ft",
    group: "cost",
    min: 1,
    max: 2000,
    step: 5,
    rationale:
      "Planning placeholder for mid-rise multifamily construction; a professional cost estimator must replace it before any commitment.",
  },
  {
    key: "softCostPct",
    label: "Soft cost (% of hard cost)",
    unit: "%",
    group: "cost",
    min: 0,
    max: 50,
    step: 0.5,
    rationale:
      "Design, legal, permits, and administration expressed as a share of hard cost — a screening convention, not a bid.",
  },
  {
    key: "contingencyPct",
    label: "Contingency (% of hard + soft)",
    unit: "%",
    group: "cost",
    min: 0,
    max: 25,
    step: 0.5,
    rationale:
      "Preliminary-stage risk allowance applied to hard + soft cost only.",
  },
  {
    key: "siteInfrastructure",
    label: "Site & infrastructure allowance",
    unit: "USD",
    group: "cost",
    min: 0,
    max: 50_000_000,
    step: 25_000,
    rationale:
      "Sitework, utilities, stormwater, and retained surface parking — a lump allowance until civil design exists.",
  },
  {
    key: "financingCarry",
    label: "Financing carry allowance",
    unit: "USD",
    group: "cost",
    min: 0,
    max: 50_000_000,
    step: 25_000,
    rationale:
      "Construction-period interest and fees as an allowance; real terms come from a lender, not Acrevia.",
  },
  {
    key: "landCost",
    label: "Land cost",
    unit: "USD",
    group: "cost",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Appraised-style land value in the cost stack. Pathway-dependent: contributed, leased, or valued — see the ownership note.",
  },
  {
    key: "annualRevenuePerHome",
    label: "Annual revenue per home (market)",
    unit: "USD/home/yr",
    group: "operating",
    min: 0,
    max: 200_000,
    step: 100,
    rationale:
      "Gross market rent placeholder per home per year (≈ monthly rent × 12); affordable homes use the factor below.",
  },
  {
    key: "occupancyPct",
    label: "Occupancy",
    unit: "%",
    group: "operating",
    min: 0,
    max: 100,
    step: 0.5,
    rationale: "Stabilized-year physical occupancy screening value.",
  },
  {
    key: "operatingExpensePct",
    label: "Operating expense (% of effective revenue)",
    unit: "%",
    group: "operating",
    min: 0,
    max: 100,
    step: 0.5,
    rationale:
      "Opex as a share of effective gross revenue (selected mode: percentage).",
  },
  {
    key: "annualOperatingExpensePerHome",
    label: "Operating expense per home",
    unit: "USD/home/yr",
    group: "operating",
    min: 0,
    max: 100_000,
    step: 100,
    rationale:
      "Opex per home per year (selected mode: per-home). Only one opex mode is active at a time.",
  },
  {
    key: "affordabilityTargetPct",
    label: "Affordability target",
    unit: "% of homes",
    group: "operating",
    min: 0,
    max: 100,
    step: 5,
    rationale:
      "Share of homes held affordable. Affordability obligations and income bands are policy work — this is a target knob only.",
  },
  {
    key: "affordableRevenueFactor",
    label: "Affordable revenue factor",
    unit: "× market rent",
    group: "operating",
    min: 0,
    max: 1,
    step: 0.05,
    rationale:
      "Revenue of an affordable home as a fraction of market rent (e.g. 0.6 ≈ 60%). A policy choice, not a program fact.",
  },
  {
    key: "churchContribution",
    label: "Church contribution",
    unit: "USD",
    group: "funding",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Congregation capital or contributed land value — user-entered, unverified by Acrevia.",
  },
  {
    key: "partnerContribution",
    label: "Partner contribution",
    unit: "USD",
    group: "funding",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Developer or JV partner capital — user-entered, unverified by Acrevia.",
  },
  {
    key: "debtProceeds",
    label: "Debt proceeds",
    unit: "USD",
    group: "funding",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Assumed loan proceeds. NOT a quote or a commitment — lender terms require professional underwriting.",
  },
  {
    key: "grantsSubsidy",
    label: "Grants & subsidy (unattributed)",
    unit: "USD",
    group: "funding",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Acrevia deliberately attaches NO public-program facts to this category. Any real grant/subsidy amount, eligibility, and source must come from a professional with current program documentation.",
  },
  {
    key: "otherFunding",
    label: "Other funding",
    unit: "USD",
    group: "funding",
    min: 0,
    max: 100_000_000,
    step: 50_000,
    rationale:
      "Tax credits, philanthropy, or other sources as a single unattributed placeholder.",
  },
];

export const CAPITAL_ASSUMPTION_SPECS: ReadonlyMap<
  CapitalNumericKey,
  CapitalAssumptionSpec
> = new Map(CAPITAL_ASSUMPTIONS.map((spec) => [spec.key, spec]));

// ---------------------------------------------------------------------------
// Zod: client-supplied overrides derive bounds from the registry
// ---------------------------------------------------------------------------

const numericFields = Object.fromEntries(
  CAPITAL_ASSUMPTIONS.map((spec) => [
    spec.key,
    // Optional by design: overrides are a PARTIAL set of edits over the
    // pathway preset — the server normalizes the complete set.
    z.number().finite().min(spec.min).max(spec.max).optional(),
  ]),
) as Record<CapitalNumericKey, z.ZodOptional<z.ZodNumber>>;

export const CapitalAssumptionOverridesSchema = z
  .object({
    ...numericFields,
    opexMode: z.enum(["pct", "per-home"]).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pathway presets — the ONLY thing that differs between ownership structures
// ---------------------------------------------------------------------------

export type PathwayPreset = {
  id: OwnershipPathway;
  label: string;
  tagline: string;
  /** How land ownership and contributions are treated (plain language). */
  ownershipNote: string;
  /** Preset overrides over the shared base defaults (funding + land only). */
  defaults: Pick<
    CapitalAssumptions,
    "landCost" | "churchContribution" | "partnerContribution" | "debtProceeds"
  >;
};

/** Shared base defaults — identical for every pathway unless a preset overrides. */
export const CAPITAL_BASE_DEFAULTS: CapitalAssumptions = {
  hardCostPerSqFt: 240,
  softCostPct: 18,
  contingencyPct: 8,
  siteInfrastructure: 1_500_000,
  financingCarry: 450_000,
  landCost: 0,
  annualRevenuePerHome: 21_600,
  occupancyPct: 93,
  opexMode: "pct",
  operatingExpensePct: 35,
  annualOperatingExpensePerHome: 7_800,
  affordabilityTargetPct: 40,
  affordableRevenueFactor: 0.6,
  churchContribution: 0,
  partnerContribution: 0,
  debtProceeds: 0,
  grantsSubsidy: 3_000_000,
  otherFunding: 0,
};

export const PATHWAY_PRESETS: Record<OwnershipPathway, PathwayPreset> = {
  "ground-lease": {
    id: "ground-lease",
    label: "Ground lease",
    tagline: "Church retains the land; a developer builds on leased ground.",
    ownershipNote:
      "The congregation stays the landowner and leases development rights to a partner. No land acquisition enters the cost stack, and ground rent is an operating item that this preliminary sketch does NOT model numerically — lease terms are professional work.",
    defaults: {
      landCost: 0,
      churchContribution: 0,
      partnerContribution: 2_000_000,
      debtProceeds: 10_000_000,
    },
  },
  "church-led": {
    id: "church-led",
    label: "Church-led",
    tagline: "The congregation develops its own land with its own capital.",
    ownershipNote:
      "The church keeps both land and control. The land's estimated value stays in the cost stack as a contributed cost, matched by church capital in the funding plan.",
    defaults: {
      landCost: 1_800_000,
      churchContribution: 3_500_000,
      partnerContribution: 0,
      debtProceeds: 8_000_000,
    },
  },
  "joint-development": {
    id: "joint-development",
    label: "Joint development",
    tagline: "Church and partner share ownership of the project.",
    ownershipNote:
      "A joint venture: the church contributes land value as its equity share and a partner contributes development capital. JV structure, waterfall, and control terms require counsel.",
    defaults: {
      landCost: 1_800_000,
      churchContribution: 1_800_000,
      partnerContribution: 3_500_000,
      debtProceeds: 9_000_000,
    },
  },
};

/**
 * Normalize a pathway + user overrides into the COMPLETE assumption set the
 * engine consumes. Overrides win over preset defaults; every accepted value
 * is already within registry bounds (zod) — clamped again defensively.
 */
export function normalizeAssumptions(
  pathway: OwnershipPathway,
  overrides: CapitalAssumptionOverrides = {},
): CapitalAssumptions {
  const preset = {
    ...CAPITAL_BASE_DEFAULTS,
    ...PATHWAY_PRESETS[pathway].defaults,
  };
  const normalized: CapitalAssumptions = { ...preset };
  for (const spec of CAPITAL_ASSUMPTIONS) {
    const value = overrides[spec.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
    }
  }
  if (overrides.opexMode === "pct" || overrides.opexMode === "per-home") {
    normalized.opexMode = overrides.opexMode;
  }
  return normalized;
}
