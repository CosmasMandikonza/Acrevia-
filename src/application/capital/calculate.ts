import { createSha256 } from "../../domain/graph/hashing";
import { canonicalJson } from "../../domain/graph/serialization";
import {
  normalizeAssumptions,
  type CapitalAssumptions,
  type CapitalAssumptionOverrides,
  type OwnershipPathway,
} from "./schema";

/**
 * Capital (issue #12) — the ONE pure deterministic engine.
 *
 * One function family computes everything: cost stack, operating sketch,
 * funding, sensitivity (re-evaluations of the SAME function with one
 * assumption moved), expert-required boundaries, the Council-readable
 * projection, and the deterministic fingerprint. No persistence, no random
 * inputs, no wall-clock reads — identical inputs always produce identical
 * outputs, so every displayed number traces to one formula on this file.
 *
 * Discipline: outputs are PRELIMINARY planning numbers, never underwriting.
 * Affordability is a target knob, not a program claim; funding categories are
 * unattributed; anything program-specific is EXPERT_REQUIRED by construction.
 */

export const CAPITAL_ENGINE_VERSION = "capital/preliminary-v1";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

/** Facts pinned by the CURRENT ScenarioCertificate — never client-authored. */
export type CapitalScenarioFacts = {
  scenarioId: string;
  certificateId: string;
  scenarioLabel: string;
  homes: number;
  floors: number;
  footprintSqFt: number;
  parkingStalls: number;
};

export type CostStack = {
  hardCost: number;
  softCost: number;
  siteInfrastructure: number;
  contingency: number;
  financingCarry: number;
  land: number;
  totalDevelopmentCost: number;
};

export type OperatingSketch = {
  homes: number;
  affordableHomes: number;
  marketHomes: number;
  grossPotentialRevenue: number;
  effectiveGrossRevenue: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  noiPerHome: number;
  /** NOI ÷ total development cost — a deterministic yield, not a return promise. */
  noiYieldOnCostPct: number;
};

export type FundingSource = {
  key:
    | "churchContribution"
    | "partnerContribution"
    | "debtProceeds"
    | "grantsSubsidy"
    | "otherFunding";
  label: string;
  amount: number;
};

export type FundingPlan = {
  sources: FundingSource[];
  identifiedCapital: number;
  /** totalDevelopmentCost − identifiedCapital. Negative means surplus. */
  fundingGap: number;
  gapPctOfCost: number;
};

export type SensitivityVariantId =
  | "base"
  | "hard-cost-plus-10"
  | "revenue-minus-10"
  | "occupancy-minus-5"
  | "affordability-plus-10";

export type SensitivityRow = {
  variantId: SensitivityVariantId;
  label: string;
  change: string;
  totalDevelopmentCost: number;
  deltaTotalCost: number;
  fundingGap: number;
  deltaFundingGap: number;
  netOperatingIncome: number;
  deltaNetOperatingIncome: number;
};

export type ExpertRequiredItem = {
  id: string;
  title: string;
  detail: string;
};

export type CapitalResult = {
  engineVersion: string;
  pathway: OwnershipPathway;
  assumptions: CapitalAssumptions;
  grossResidentialSqFt: number;
  cost: CostStack;
  operating: OperatingSketch;
  funding: FundingPlan;
  sensitivity: SensitivityRow[];
  expertRequired: ExpertRequiredItem[];
  /** Council-readable sentences derived from the same numbers (same fingerprint). */
  councilProjection: string[];
};

// ---------------------------------------------------------------------------
// Rounding — presentation only; arithmetic stays exact until the edge
// ---------------------------------------------------------------------------

const usd = (value: number): number => Math.round(value);
const pct1 = (value: number): number => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function computeCost(
  facts: CapitalScenarioFacts,
  a: CapitalAssumptions,
): CostStack {
  const grossResidentialSqFt = facts.footprintSqFt * facts.floors;
  // Percentages apply to the ROUNDED base above them and the total is the sum
  // of the rounded lines — every displayed number is recomputable from the
  // displayed numbers above it (a judge can add the stack back up exactly).
  const hardCost = usd(grossResidentialSqFt * a.hardCostPerSqFt);
  const softCost = usd(hardCost * (a.softCostPct / 100));
  const contingency = usd((hardCost + softCost) * (a.contingencyPct / 100));
  const siteInfrastructure = usd(a.siteInfrastructure);
  const financingCarry = usd(a.financingCarry);
  const land = usd(a.landCost);
  return {
    hardCost,
    softCost,
    siteInfrastructure,
    contingency,
    financingCarry,
    land,
    totalDevelopmentCost:
      hardCost +
      softCost +
      siteInfrastructure +
      contingency +
      financingCarry +
      land,
  };
}

function computeOperating(
  facts: CapitalScenarioFacts,
  a: CapitalAssumptions,
  cost: CostStack,
): OperatingSketch {
  // Same discipline as the cost stack: each displayed line derives from the
  // displayed line above it, so NOI = effective revenue − expenses exactly.
  const homes = facts.homes;
  const affordableHomes = Math.round((homes * a.affordabilityTargetPct) / 100);
  const marketHomes = homes - affordableHomes;
  const grossPotentialRevenue = usd(
    (marketHomes + affordableHomes * a.affordableRevenueFactor) *
      a.annualRevenuePerHome,
  );
  const effectiveGrossRevenue = usd(
    grossPotentialRevenue * (a.occupancyPct / 100),
  );
  const operatingExpenses =
    a.opexMode === "pct"
      ? usd(effectiveGrossRevenue * (a.operatingExpensePct / 100))
      : usd(a.annualOperatingExpensePerHome * homes);
  const netOperatingIncome = effectiveGrossRevenue - operatingExpenses;
  return {
    homes,
    affordableHomes,
    marketHomes,
    grossPotentialRevenue,
    effectiveGrossRevenue,
    operatingExpenses,
    netOperatingIncome,
    noiPerHome: homes > 0 ? usd(netOperatingIncome / homes) : 0,
    noiYieldOnCostPct:
      cost.totalDevelopmentCost > 0
        ? pct1((netOperatingIncome / cost.totalDevelopmentCost) * 100)
        : 0,
  };
}

function computeFunding(a: CapitalAssumptions, cost: CostStack): FundingPlan {
  const sources: FundingSource[] = [
    {
      key: "churchContribution",
      label: "Church contribution",
      amount: usd(a.churchContribution),
    },
    {
      key: "partnerContribution",
      label: "Partner contribution",
      amount: usd(a.partnerContribution),
    },
    {
      key: "debtProceeds",
      label: "Debt proceeds",
      amount: usd(a.debtProceeds),
    },
    {
      key: "grantsSubsidy",
      label: "Grants & subsidy (unattributed)",
      amount: usd(a.grantsSubsidy),
    },
    {
      key: "otherFunding",
      label: "Other funding",
      amount: usd(a.otherFunding),
    },
  ];
  const identifiedCapital = sources.reduce(
    (sum, source) => sum + source.amount,
    0,
  );
  const fundingGap = cost.totalDevelopmentCost - identifiedCapital;
  return {
    sources,
    identifiedCapital,
    fundingGap,
    gapPctOfCost:
      cost.totalDevelopmentCost > 0
        ? pct1((fundingGap / cost.totalDevelopmentCost) * 100)
        : 0,
  };
}

function usdText(value: number): string {
  return `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function computeExpertRequired(
  pathway: OwnershipPathway,
  a: CapitalAssumptions,
  funding: FundingPlan,
): ExpertRequiredItem[] {
  const items: ExpertRequiredItem[] = [
    {
      id: "expert:professional-cost-estimate",
      title: "Professional cost estimate",
      detail:
        "Hard cost, soft cost, contingency, and site allowances are planning placeholders. A cost estimator must produce a basis-of-design estimate before any figure here is relied upon.",
    },
    {
      id: "expert:debt-terms",
      title: "Debt terms are assumed, not quoted",
      detail:
        "Debt proceeds and financing carry are user-entered assumptions. Loan amount, rate, and covenants require lender underwriting Acrevia does not perform.",
    },
  ];
  if (a.grantsSubsidy > 0 || a.otherFunding > 0) {
    items.push({
      id: "expert:program-sourcing",
      title: "Public-program facts must be sourced by a professional",
      detail:
        "Acrevia attaches NO eligibility or program facts to the grants/subsidy and other-funding categories. Every real program amount, current rules, and compliance obligations must be verified against current program documentation by a professional — Acrevia will not infer eligibility.",
    });
  }
  if (pathway === "ground-lease") {
    items.push({
      id: "expert:ground-lease-terms",
      title: "Ground-lease terms are not modeled",
      detail:
        "This sketch places no land acquisition in the cost stack and does not model ground rent. Lease length, rent escalations, and reversion terms are attorney and advisor work.",
    });
  }
  if (pathway === "joint-development") {
    items.push({
      id: "expert:jv-structure",
      title: "Joint-venture structure requires counsel",
      detail:
        "Participation, waterfall, control, and exit terms between the church and its partner are beyond Acrevia's modeled scope.",
    });
  }
  if (funding.fundingGap > 0) {
    items.push({
      id: "expert:gap-strategy",
      title: "Funding gap requires a capital strategy",
      detail: `The preliminary gap of ${usdText(funding.fundingGap)} (${funding.gapPctOfCost}% of cost) has no identified source. Closing it is professional capital-formation work, not arithmetic.`,
    });
  }
  return items;
}

function computeCouncilProjection(
  facts: CapitalScenarioFacts,
  cost: CostStack,
  operating: OperatingSketch,
  funding: FundingPlan,
): string[] {
  const gapSentence =
    funding.fundingGap > 0
      ? `Identified funding covers ${usdText(funding.identifiedCapital)}, leaving a preliminary gap of ${usdText(funding.fundingGap)} (${funding.gapPctOfCost}% of cost) that has no identified source.`
      : funding.fundingGap < 0
        ? `Identified funding of ${usdText(funding.identifiedCapital)} exceeds the preliminary cost by ${usdText(funding.fundingGap)}.`
        : `Identified funding exactly matches the preliminary cost.`;
  return [
    `The ${facts.scenarioLabel} scenario (${facts.homes} homes, ${operating.affordableHomes} of them affordable at the current target) carries a preliminary total development cost of ${usdText(cost.totalDevelopmentCost)}.`,
    gapSentence,
    `At the assumed stabilized occupancy it sketches ${usdText(operating.effectiveGrossRevenue)} effective revenue and ${usdText(operating.netOperatingIncome)} net operating income per year — a ${operating.noiYieldOnCostPct}% yield on cost, PRELIMINARY and derived only from the labeled assumptions.`,
    `Every figure is deterministic and reproducible from the current ScenarioCertificate; none of it is underwriting, and the expert-required list names what a professional must confirm first.`,
  ];
}

/**
 * THE evaluation. Pure: (facts, pathway, assumptions) → result. Sensitivity,
 * expert boundaries, and the Council projection are all derived inside from
 * the same computation — there is no second engine.
 */
export function evaluateCapital(
  facts: CapitalScenarioFacts,
  pathway: OwnershipPathway,
  assumptionInput: CapitalAssumptionOverrides | CapitalAssumptions = {},
): CapitalResult {
  const assumptions = normalizeAssumptions(pathway, assumptionInput);
  const cost = computeCost(facts, assumptions);
  const operating = computeOperating(facts, assumptions, cost);
  const funding = computeFunding(assumptions, cost);
  const sensitivity = computeSensitivity(facts, pathway, assumptions, {
    cost,
    operating,
    funding,
  });
  return {
    engineVersion: CAPITAL_ENGINE_VERSION,
    pathway,
    assumptions,
    grossResidentialSqFt: facts.footprintSqFt * facts.floors,
    cost,
    operating,
    funding,
    sensitivity,
    expertRequired: computeExpertRequired(pathway, assumptions, funding),
    councilProjection: computeCouncilProjection(
      facts,
      cost,
      operating,
      funding,
    ),
  };
}

// ---------------------------------------------------------------------------
// Sensitivity — deterministic single-assumption comparisons, not simulations
// ---------------------------------------------------------------------------

function computeSensitivity(
  facts: CapitalScenarioFacts,
  pathway: OwnershipPathway,
  a: CapitalAssumptions,
  base: { cost: CostStack; operating: OperatingSketch; funding: FundingPlan },
): SensitivityRow[] {
  const variants: Array<{
    variantId: SensitivityVariantId;
    label: string;
    change: string;
    overrides: CapitalAssumptionOverrides;
  }> = [
    {
      variantId: "base",
      label: "Base",
      change: "as entered",
      overrides: {},
    },
    {
      variantId: "hard-cost-plus-10",
      label: "Hard cost +10%",
      change: "hard cost per sq ft × 1.10",
      overrides: { hardCostPerSqFt: a.hardCostPerSqFt * 1.1 },
    },
    {
      variantId: "revenue-minus-10",
      label: "Revenue −10%",
      change: "annual revenue per home × 0.90",
      overrides: { annualRevenuePerHome: a.annualRevenuePerHome * 0.9 },
    },
    {
      variantId: "occupancy-minus-5",
      label: "Occupancy −5 pts",
      change: "occupancy − 5 percentage points",
      overrides: { occupancyPct: a.occupancyPct - 5 },
    },
    {
      variantId: "affordability-plus-10",
      label: "Affordability +10 pts",
      change: "affordability target + 10 percentage points",
      overrides: { affordabilityTargetPct: a.affordabilityTargetPct + 10 },
    },
  ];

  const rows: SensitivityRow[] = [];
  for (const variant of variants) {
    // Same engine, same pathway, one assumption moved — clamped to bounds by
    // normalizeAssumptions so e.g. occupancy −5 below 0 stays honest.
    const merged = { ...a, ...variant.overrides } as CapitalAssumptions;
    const normalized = normalizeAssumptions(pathway, merged);
    const cost = computeCost(facts, normalized);
    const operating = computeOperating(facts, normalized, cost);
    const funding = computeFunding(normalized, cost);
    rows.push({
      variantId: variant.variantId,
      label: variant.label,
      change: variant.change,
      totalDevelopmentCost: cost.totalDevelopmentCost,
      deltaTotalCost:
        cost.totalDevelopmentCost - base.cost.totalDevelopmentCost,
      fundingGap: funding.fundingGap,
      deltaFundingGap: funding.fundingGap - base.funding.fundingGap,
      netOperatingIncome: operating.netOperatingIncome,
      deltaNetOperatingIncome:
        operating.netOperatingIncome - base.operating.netOperatingIncome,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fingerprint — scenario/certificate identity + engine + pathway + assumptions
// ---------------------------------------------------------------------------

/**
 * Deterministic identity of a Capital result. Hashes exactly what the result
 * was computed from: the trusted scenario/certificate pair, the engine
 * version, the pathway, and the normalized assumption set. No timestamps, no
 * persistence — each request recomputes, and a changed scenario certificate
 * or changed assumption necessarily produces a different fingerprint.
 */
export function capitalFingerprint(input: {
  scenarioId: string;
  certificateId: string;
  pathway: OwnershipPathway;
  assumptions: CapitalAssumptions;
}): string {
  return createSha256(
    canonicalJson({
      engineVersion: CAPITAL_ENGINE_VERSION,
      scenarioId: input.scenarioId,
      certificateId: input.certificateId,
      pathway: input.pathway,
      assumptions: input.assumptions,
    }),
  );
}
