import { createSha256 } from "../../domain/graph/hashing";
import { canonicalJson } from "../../domain/graph/serialization";
import { BOARD_BOUNDARY_NOTICE } from "../copilot/tools";
import type { TrustedProofContext } from "../proof/trusted-context";
import {
  PATHWAY_PRESETS,
  type CapitalAssumptionOverrides,
  type OwnershipPathway,
} from "../../application/capital/schema";
import {
  capitalFingerprint,
  evaluateCapital,
  type CapitalResult,
} from "../capital/calculate";

/**
 * COUNCIL (issue #13) — the stakeholder decision package.
 *
 * Council is a PROJECTION, never a second truth model. Everything below is
 * assembled from one ready TrustedProofContext (the same shared rebuild the
 * Proof, Capital, and Copilot routes use) plus, optionally, one Capital
 * evaluation of the SAME selected scenario. No fact is authored here: every
 * number in every audience view is interpolated from the single `facts`
 * table, so the five audiences cannot drift apart.
 *
 * Determinism: no wall-clock, no randomness, no locale drift ("en-US"
 * formatting only), array orders inherited from the deterministic rebuild.
 * The same trusted context produces byte-identical canonical JSON, and
 * `packageFingerprint` changes iff the selected scenario certificate, a
 * confirmed mission rule, the project revision, or the included Capital
 * fingerprint changes.
 */

export const COUNCIL_PACKAGE_VERSION = "acrevia.council.v1";

/** Mirrors the audience vocabulary of the stakeholder-view node kind. */
export const COUNCIL_AUDIENCES = [
  "pastoral",
  "board",
  "neighbor",
  "council",
  "professional",
] as const;
export type CouncilAudience = (typeof COUNCIL_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<CouncilAudience, string> = {
  pastoral: "PASTOR / MINISTRY",
  board: "BOARD",
  neighbor: "NEIGHBOR",
  council: "CITY / COUNCIL",
  professional: "PROFESSIONAL REVIEWER",
};

/** How much machinery each audience is shown (depth, never facts, changes). */
export type CouncilDetail = "plain" | "standard" | "audit";

export type CouncilFactSource =
  "gis" | "law" | "mission" | "solver" | "capital" | "review";

export type CouncilFact = {
  key: string;
  label: string;
  /** Formatted for humans; the fingerprint never reads this string. */
  value: string;
  source: CouncilFactSource;
  note?: string;
};

export type CouncilScenarioSummary = {
  scenarioId: string;
  certificateId: string;
  label: string;
  homes: number;
  freshness: string;
};

export type CouncilConstraintResult = {
  constraint: string;
  source: string;
  status: string;
  actual: string | null;
  limit: string | null;
  explanation: string;
};

export type CouncilCapitalSummary = {
  fingerprint: string;
  engineVersion: string;
  pathway: {
    id: string;
    label: string;
    tagline: string;
    ownershipNote: string;
  };
  totalDevelopmentCost: string;
  identifiedCapital: string;
  fundingGap: string;
  gapPctOfCost: string;
  affordableHomes: number;
  noiYieldOnCostPct: string;
  /** Capital's own deterministic council sentences — same numbers, same fingerprint. */
  projection: string[];
  expertRequired: Array<{ id: string; title: string }>;
};

export type AudienceView = {
  audience: CouncilAudience;
  label: string;
  essence: string;
  headline: string;
  lead: string[];
  /** Ordered emphasis over the SHARED fact table (factKey → facts[factKey]). */
  emphasis: Array<{ factKey: string; why: string }>;
  detail: CouncilDetail;
  cta: string;
  questionsTitle: string;
};

export type CouncilPackage = {
  packageVersion: string;
  project: {
    projectId: string;
    query: string;
    matchedAddress: string;
    district: string;
    overlay: string | null;
    parcelNodeId: string;
    parcelAreaSqFt: number;
    revision: number;
  };
  scenarios: CouncilScenarioSummary[];
  selected: {
    scenarioId: string;
    scenarioLabel: string;
    homes: number;
    parkingStalls: number;
    parkingMargin: number;
    footprintSqFt: number;
    floors: number;
    heightLimitFt: number;
    confidence: string;
    solverVersion: string;
    constraintResults: CouncilConstraintResult[];
    satisfiedCount: number;
    openCount: number;
  };
  certificate: {
    id: string;
    version: number;
    freshness: string;
    freshnessReasons: string[];
    dependencyCount: number;
    certificateHash: string;
  };
  mission: {
    commitments: Array<{
      id: string;
      intentText: string;
      normalizedSummary: string;
      hardOrSoft: string;
    }>;
    preservedStructureLabels: string[];
    retainOwnership: boolean;
  };
  capital: CouncilCapitalSummary | null;
  evidence: {
    assumptions: Array<{
      statement: string;
      valueSummary: string;
      rationale: string;
    }>;
    conflicts: Array<{
      semanticRuleKey: string;
      explanation: string;
      resolution: string;
    }>;
    expertReviews: Array<{
      question: string;
      category: string;
      severity: string;
      reviewStatus: string;
    }>;
    computationQuestions: Array<{
      label: string;
      status: string;
      explanation: string;
    }>;
    sources: Array<{
      title: string;
      publisher: string;
      authority: string;
      retrievedAt: string;
    }>;
  };
  facts: Record<string, CouncilFact>;
  audienceViews: Record<CouncilAudience, AudienceView>;
  nextDecision: {
    headline: string;
    rationale: string;
    blockers: string[];
  };
  boundaryNotice: string;
  /** Status of the certificate this package was assembled against. */
  freshness: { status: "CURRENT"; certificateFreshness: string };
  packageFingerprint: string;
};

export type CouncilAssemblyInput = {
  /** Scenario to present; defaults to MISSION BALANCE, else the first recorded. */
  scenarioId?: string;
  /**
   * Optional Capital evaluation REQUEST for the same selected scenario. The
   * pure Capital engine runs inside the assembly so the money and the
   * narrative can never describe different scenarios.
   */
  capital?: {
    pathway: OwnershipPathway;
    overrides?: CapitalAssumptionOverrides;
  };
};

export type CouncilAssembly =
  | { status: "assembled"; package: CouncilPackage }
  | {
      status: "stale-scenario";
      reason: string;
      scenarios: CouncilScenarioSummary[];
    }
  | {
      status: "stale-certificate";
      reason: string;
      scenarios: CouncilScenarioSummary[];
    };

type ReadyContext = Extract<TrustedProofContext, { status: "ready" }>;

// ---------------------------------------------------------------------------
// Formatting — the ONLY place numbers become display strings
// ---------------------------------------------------------------------------

const int = (value: number): string => value.toLocaleString("en-US");
const usd = (value: number): string =>
  `$${Math.round(value).toLocaleString("en-US")}`;
const area = (value: number): string => `${int(Math.round(value))} ft²`;

// ---------------------------------------------------------------------------
// Mission / structure projections (read from the rebuilt project, like Proof)
// ---------------------------------------------------------------------------

function missionFacts(context: ReadyContext) {
  const missionNodes = Object.values(context.project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .filter((node) => node.confirmationState === "CONFIRMED")
    .sort((a, b) => a.id.localeCompare(b.id));
  const sessionStructures = context.session.parcelContexts.flatMap(
    (parcel) => parcel.structures,
  );
  const preservedStructureLabels: string[] = [];
  let retainOwnership = false;
  for (const node of missionNodes) {
    if (node.normalized.type === "preserve-structure") {
      const structureId = `gis:structure:${node.normalized.structureId}`;
      const name = sessionStructures.find(
        (structure) => `gis:structure:${structure.structureId}` === structureId,
      )?.buildingName;
      preservedStructureLabels.push(
        name ? `${name}` : node.normalized.structureId,
      );
    }
    if (node.normalized.type === "retain-ownership") retainOwnership = true;
  }
  return { missionNodes, preservedStructureLabels, retainOwnership };
}

// ---------------------------------------------------------------------------
// Facts — one table; every audience view renders from it
// ---------------------------------------------------------------------------

function buildFacts(
  selected: CouncilPackage["selected"],
  project: CouncilPackage["project"],
  mission: CouncilPackage["mission"],
  capitalRaw: CapitalResult | null,
  openCount: number,
): Record<string, CouncilFact> {
  const facts: CouncilFact[] = [
    {
      key: "address",
      label: "Property",
      value: project.matchedAddress,
      source: "gis",
      note: "Matched address from the accepted session (display, not identity).",
    },
    {
      key: "district",
      label: "Base zoning",
      value: project.district,
      source: "law",
      note: "Verified base zoning district claim.",
    },
    ...(project.overlay
      ? [
          {
            key: "overlay",
            label: "Overlay",
            value: project.overlay,
            source: "law" as const,
          },
        ]
      : []),
    {
      key: "parcel",
      label: "Parcel",
      value: project.parcelNodeId,
      source: "gis",
    },
    {
      key: "parcel-area",
      label: "Parcel area",
      value: area(project.parcelAreaSqFt),
      source: "gis",
    },
    {
      key: "scenario",
      label: "Scenario",
      value: selected.scenarioLabel,
      source: "solver",
    },
    {
      key: "homes",
      label: "Homes",
      value: `${int(selected.homes)}`,
      source: "solver",
      note: "Preliminary dwelling-unit count from the deterministic solver.",
    },
    {
      key: "parking",
      label: "Sunday parking",
      value: `${int(selected.parkingStalls)} spaces`,
      source: "solver",
    },
    {
      key: "floors",
      label: "Scale",
      value: `${int(selected.floors)} stories`,
      source: "solver",
    },
    {
      key: "height-limit",
      label: "Height ceiling",
      value: `${int(selected.heightLimitFt)} ft`,
      source: "law",
      note: "Modeled height ceiling (law; a mission rule can lower it).",
    },
    {
      key: "footprint",
      label: "Building footprint",
      value: area(selected.footprintSqFt),
      source: "solver",
    },
    {
      key: "confidence",
      label: "Solver confidence",
      value: selected.confidence,
      source: "solver",
    },
    {
      key: "mission-count",
      label: "Mission commitments",
      value:
        mission.commitments.length === 0
          ? "None confirmed yet"
          : `${mission.commitments.length} confirmed`,
      source: "mission",
      note: "Congregation-declared rules the computation must obey.",
    },
    ...(mission.preservedStructureLabels.length > 0
      ? [
          {
            key: "preserved-structures",
            label: "Church structures preserved",
            value: mission.preservedStructureLabels.join(", "),
            source: "mission" as const,
            note: "Protected by the congregation's own mission rules.",
          },
        ]
      : []),
    {
      key: "retain-ownership",
      label: "Land ownership",
      value: mission.retainOwnership
        ? "Congregation retains ownership"
        : "No retain-ownership rule confirmed",
      source: "mission",
    },
    {
      key: "open-questions",
      label: "Open expert items",
      value: `${int(openCount)}`,
      source: "review",
      note: "Expert-review questions and unevaluated checks — listed, not hidden.",
    },
  ];
  if (capitalRaw) {
    facts.push(
      {
        key: "capital-pathway",
        label: "Capital pathway",
        value: PATHWAY_PRESETS[capitalRaw.pathway].label,
        source: "capital",
        note: PATHWAY_PRESETS[capitalRaw.pathway].tagline,
      },
      {
        key: "total-development-cost",
        label: "Total development cost",
        value: usd(capitalRaw.cost.totalDevelopmentCost),
        source: "capital",
        note: "Preliminary — derived only from the labeled assumptions.",
      },
      {
        key: "funding-gap",
        label: "Funding gap",
        value: usd(capitalRaw.funding.fundingGap),
        source: "capital",
        note: `${capitalRaw.funding.gapPctOfCost}% of cost with no identified source.`,
      },
      {
        key: "affordable-homes",
        label: "Affordable homes",
        value: `${int(capitalRaw.operating.affordableHomes)}`,
        source: "capital",
        note: "At the modeled affordability target.",
      },
    );
  }
  const table: Record<string, CouncilFact> = {};
  for (const fact of facts) table[fact.key] = fact;
  return table;
}

// ---------------------------------------------------------------------------
// Next decision — a deterministic ladder over the current state
// ---------------------------------------------------------------------------

function buildNextDecision(
  facts: Record<string, CouncilFact>,
  blockingReviews: string[],
  conflictsBlocked: string[],
  capitalRaw: CapitalResult | null,
): CouncilPackage["nextDecision"] {
  const blockers = [...blockingReviews, ...conflictsBlocked];
  if (blockers.length > 0) {
    return {
      headline: `Resolve ${int(blockers.length)} blocking item${blockers.length === 1 ? "" : "s"} before this decision package goes anywhere external`,
      rationale:
        "Blocking expert-review questions and unresolved conflicts are exactly the claims Acrevia refuses to guess; every external audience should see them answered, not averaged away.",
      blockers,
    };
  }
  if (!capitalRaw) {
    return {
      headline:
        "Model preliminary capital before the board weighs money against mission",
      rationale:
        "The selected scenario is certified, but no ownership or funding pathway has been evaluated for it yet — the board should not discuss numbers it cannot see.",
      blockers: [],
    };
  }
  if (capitalRaw.funding.fundingGap > 0) {
    return {
      headline: `Board decision: the ${usd(capitalRaw.funding.fundingGap)} preliminary funding gap has no identified source`,
      rationale: `Identified capital is ${usd(capitalRaw.funding.identifiedCapital)} against a ${usd(capitalRaw.cost.totalDevelopmentCost)} preliminary cost (${capitalRaw.funding.gapPctOfCost}% gap). Closing a gap is professional capital-formation work, not arithmetic.`,
      blockers: [],
    };
  }
  return {
    headline:
      "Board decision: authorize professional predevelopment review of the selected scenario",
    rationale: `The scenario is certified CURRENT, no blocking reviews are open, and the ${facts["scenario"]?.value ?? "selected"} scenario's preliminary capital identifies its full cost. The next honest step is licensed professionals, not more modeling.`,
    blockers: [],
  };
}

// ---------------------------------------------------------------------------
// Audience views — templates over the SAME facts
// ---------------------------------------------------------------------------

function buildAudienceViews(
  facts: Record<string, CouncilFact>,
  pkg: {
    selected: CouncilPackage["selected"];
    certificate: CouncilPackage["certificate"];
    mission: CouncilPackage["mission"];
    capital: CouncilCapitalSummary | null;
    capitalRaw: CapitalResult | null;
    evidence: CouncilPackage["evidence"];
    nextDecision: CouncilPackage["nextDecision"];
    project: CouncilPackage["project"];
    packageFingerprint: string;
  },
): Record<CouncilAudience, AudienceView> {
  const f = (key: string) => facts[key]?.value ?? "—";
  const label = pkg.selected.scenarioLabel;
  const homes = f("homes");
  const parking = f("parking");
  const floors = f("floors");
  const height = f("height-limit");
  const openCount = Number.parseInt(f("open-questions"), 10) || 0;
  const missionCount = pkg.mission.commitments.length;
  const assumptions = pkg.evidence.assumptions.length;
  const conflicts = pkg.evidence.conflicts.length;
  const openReviews = pkg.evidence.expertReviews.filter(
    (review) =>
      review.reviewStatus === "OPEN" || review.reviewStatus === "IN_REVIEW",
  );
  const preserved = pkg.mission.preservedStructureLabels;
  const overlayClause = pkg.project.overlay
    ? ` with the ${pkg.project.overlay} overlay`
    : "";

  const pastoral: AudienceView = {
    audience: "pastoral",
    label: AUDIENCE_LABELS.pastoral,
    essence: "What this means for the congregation's calling and its land.",
    headline:
      preserved.length > 0
        ? `The church stays. ${homes} homes become possible.`
        : `${homes} homes become possible on this land.`,
    lead: [
      missionCount > 0
        ? `This package holds ${int(missionCount)} congregation commitment${missionCount === 1 ? "" : "s"} as hard inputs to every computation — they are rules the math must obey, not aspirations attached to a plan afterwards.`
        : `No mission commitments have been confirmed yet, so every scenario below is computed without congregational priorities. Declaring what must be preserved is the first decision.`,
      preserved.length > 0
        ? `${preserved.join(" and ")} ${preserved.length === 1 ? "is" : "are"} preserved by the congregation's own rule, and ${parking} stand in the ${label} scenario.`
        : `The ${label} scenario keeps ${parking} on the property.`,
      `Nothing here is decided. ${openCount === 0 ? "The model has no open expert questions for this state." : `${int(openCount)} item${openCount === 1 ? "" : "s"} still require professional judgment before any commitment.`}`,
    ],
    emphasis: [
      {
        factKey: "mission-count",
        why: "Stewardship is an input, not a caption.",
      },
      { factKey: "preserved-structures", why: "What the congregation kept." },
      { factKey: "parking", why: "Sunday morning still works." },
      { factKey: "homes", why: "The possibility these constraints unlock." },
      { factKey: "retain-ownership", why: "Who still holds the land." },
    ],
    detail: "plain",
    cta: "Bring this to the board as a possibility to investigate — not a decision to ratify.",
    questionsTitle: "Open questions before any commitment",
  };

  const gapClause = pkg.capitalRaw
    ? pkg.capitalRaw.funding.fundingGap > 0
      ? `a ${usd(pkg.capitalRaw.funding.fundingGap)} preliminary gap`
      : "funding fully identified"
    : "capital not yet modeled";
  const board: AudienceView = {
    audience: "board",
    label: AUDIENCE_LABELS.board,
    essence: "The trade-offs, the money, and the decision actually requested.",
    headline: `${label}: ${homes} homes, ${parking} — ${gapClause}.`,
    lead: [
      `The selected scenario carries solver confidence ${pkg.selected.confidence}: ${pkg.selected.satisfiedCount} of ${pkg.selected.constraintResults.length} evaluated constraint checks are satisfied; every non-satisfied check and its explanation is listed below.`,
      pkg.capitalRaw
        ? `Preliminary capital (${pkg.capital?.pathway.label}) puts the ${label} scenario at ${usd(pkg.capitalRaw.cost.totalDevelopmentCost)} total development cost against ${usd(pkg.capitalRaw.funding.identifiedCapital)} identified — a ${usd(pkg.capitalRaw.funding.fundingGap)} gap (${pkg.capitalRaw.funding.gapPctOfCost}% of cost).`
        : `Capital has not been evaluated for this scenario yet. The board should not debate numbers it cannot see — run the Capital surface first.`,
      `${int(assumptions)} planning assumption${assumptions === 1 ? "" : "s"} and ${int(conflicts)} conflict${conflicts === 1 ? "" : "s"} stand behind these figures; all are enumerated below with their rationale.`,
    ],
    emphasis: [
      { factKey: "homes", why: "The yield being weighed." },
      { factKey: "parking", why: "The mission cost already paid." },
      ...(pkg.capitalRaw
        ? [
            {
              factKey: "total-development-cost",
              why: "What delivery preliminarily takes.",
            },
            { factKey: "funding-gap", why: "What is not yet funded." },
          ]
        : []),
      { factKey: "confidence", why: "How far the model says it can see." },
    ],
    detail: "standard",
    cta: pkg.nextDecision.headline,
    questionsTitle: "What the board must decide or commission",
  };

  const neighbor: AudienceView = {
    audience: "neighbor",
    label: AUDIENCE_LABELS.neighbor,
    essence: "Scale, parking, and what stays — in plain terms.",
    headline:
      preserved.length > 0
        ? `${floors} on the block. The church stays.`
        : `${floors} on the block.`,
    lead: [
      `As a concept, the ${label} scenario is a ${pkg.selected.floors}-story building with ${homes} homes, inside a ${height} modeled height ceiling, with ${parking} kept on site.`,
      preserved.length > 0
        ? `${preserved.join(" and ")} ${preserved.length === 1 ? "is" : "are"} preserved — by the congregation's own mission rule, not a developer's promise.`
        : `The existing buildings are not protected by a mission rule in this model run.`,
      `This is a feasibility study, not a plan: nothing has been filed with the city, no developer is chosen, and every number here is preliminary and listed with its sources.`,
    ],
    emphasis: [
      { factKey: "floors", why: "The scale neighbors will feel." },
      { factKey: "height-limit", why: "The ceiling the model respects." },
      { factKey: "parking", why: "What stays paved for people." },
      {
        factKey: "preserved-structures",
        why: "The church is not going anywhere.",
      },
      { factKey: "homes", why: "Who could live here." },
    ],
    detail: "plain",
    cta: "Bring questions to the community conversation — the open questions below are honest gaps, not sales points.",
    questionsTitle: "Community questions this study does not yet answer",
  };

  const council: AudienceView = {
    audience: "council",
    label: AUDIENCE_LABELS.council,
    essence: "The zoning basis, the arithmetic, and what remains unverified.",
    // Headline stays short; the overlay's full name lives in the lead + facts,
    // not in the largest serif line on the page.
    headline: `${homes} homes under ${pkg.project.district} — preliminary, evidence-backed.`,
    lead: [
      `Parcel ${pkg.project.parcelNodeId.replace("gis:parcel:", "")} is zoned ${pkg.project.district}${overlayClause}. Development figures derive from adopted code compiled with provenance and from deterministic computation over the recorded parcel geometry — not from generated prose.`,
      `The ${label} scenario models ${homes} dwelling units, ${floors} within a ${height} modeled height ceiling, a ${f("footprint")} footprint, and ${parking}.`,
      `Feasibility confidence is ${pkg.selected.confidence}; ${openReviews.length === 0 ? "no expert-review items are open for this state" : `${int(openReviews.length)} item${openReviews.length === 1 ? "" : "s"} remain explicitly flagged for professional or official review`} — listed, not hidden.`,
    ],
    emphasis: [
      { factKey: "district", why: "The legal basis for every number." },
      { factKey: "homes", why: "What is being contemplated." },
      { factKey: "floors", why: "Massing in council terms." },
      { factKey: "height-limit", why: "The envelope's cap." },
      { factKey: "parking", why: "The neighborhood's first question." },
    ],
    detail: "standard",
    cta: "Treat this as a pre-application conversation starter — it is not a permit application and claims no zoning approval.",
    questionsTitle: "Items flagged for professional and official review",
  };

  const blockingCount = pkg.evidence.expertReviews.filter(
    (review) =>
      review.severity === "blocking" && review.reviewStatus === "OPEN",
  ).length;
  const professional: AudienceView = {
    audience: "professional",
    label: AUDIENCE_LABELS.professional,
    essence: "The exact model state: certificate, assumptions, boundaries.",
    headline: `Certified ${pkg.certificate.freshness} — certificate v${pkg.certificate.version}.`,
    lead: [
      `Scenario ${pkg.selected.scenarioId} is certified by ${pkg.certificate.id} (v${pkg.certificate.version}, ${int(pkg.certificate.dependencyCount)} pinned dependencies, solver ${pkg.selected.solverVersion}). Package fingerprint ${pkg.packageFingerprint}.`,
      `The modeled program point is ${homes} homes, ${parking}, ${floors} — every figure recomputable from the certificate's pinned dependency closure.`,
      `${int(assumptions)} active modeler-declared assumption${assumptions === 1 ? "" : "s"}, ${int(conflicts)} conflict${conflicts === 1 ? "" : "s"}, and ${int(pkg.evidence.expertReviews.length)} expert-review item${pkg.evidence.expertReviews.length === 1 ? "" : "s"} (${int(blockingCount)} blocking) are enumerated below with sources and freshness.`,
      `Acrevia models law, geometry, mission, and capital arithmetic deterministically. It does not render legal, architectural, or financial conclusions; the boundary notice below states the exact preliminary scope.`,
    ],
    emphasis: [
      { factKey: "confidence", why: "The solver's own epistemic state." },
      { factKey: "homes", why: "Computed, not asserted." },
      { factKey: "parking", why: "Constraint-checked." },
      { factKey: "height-limit", why: "Law ceiling binding the massing." },
      ...(pkg.capital
        ? [
            {
              factKey: "total-development-cost",
              why: "Preliminary capital basis.",
            },
          ]
        : []),
    ],
    detail: "audit",
    cta: "Start from the certificate and the assumption set; verify against the cited primary sources.",
    questionsTitle: "Expert queue and unresolved computation checks",
  };

  return { pastoral, board, neighbor, council, professional };
}

// ---------------------------------------------------------------------------
// Fingerprint — semantic identity of everything the package asserts
// ---------------------------------------------------------------------------

export function councilPackageFingerprint(input: {
  projectId: string;
  projectRevision: number;
  scenarioId: string;
  certificateId: string;
  certificateHash: string;
  missions: Array<{ id: string; revision: number }>;
  capitalFingerprint: string | null;
}): string {
  return createSha256(
    canonicalJson({
      packageVersion: COUNCIL_PACKAGE_VERSION,
      projectId: input.projectId,
      projectRevision: input.projectRevision,
      scenarioId: input.scenarioId,
      certificateId: input.certificateId,
      certificateHash: input.certificateHash,
      missions: [...input.missions].sort((a, b) => a.id.localeCompare(b.id)),
      capitalFingerprint: input.capitalFingerprint,
    }),
  );
}

// ---------------------------------------------------------------------------
// THE assembly — pure over one ready trusted context
// ---------------------------------------------------------------------------

export function buildCouncilPackage(
  context: ReadyContext,
  input: CouncilAssemblyInput = {},
): CouncilAssembly {
  const { project: graph, snapshot, solve, recorded } = context;

  const scenarios: CouncilScenarioSummary[] = recorded
    .map((entry) => {
      const node = graph.nodes[entry.scenarioId];
      if (!node || node.kind !== "scenario") return null;
      const homes = node.metrics.find((m) => m.metricId === "homes");
      return {
        scenarioId: entry.scenarioId,
        certificateId: entry.certificateId,
        label: node.label,
        homes: homes?.value?.value ?? 0,
        freshness: entry.freshness,
      };
    })
    .filter((entry): entry is CouncilScenarioSummary => entry !== null);

  // Selection: requested id, else MISSION BALANCE (the board-context
  // convention), else the first recorded scenario. Never a foreign id.
  const requested = input.scenarioId
    ? recorded.find((entry) => entry.scenarioId === input.scenarioId)
    : (recorded.find((entry) => {
        const node = graph.nodes[entry.scenarioId];
        return node?.kind === "scenario" && node.label === "MISSION BALANCE";
      }) ?? recorded[0]);

  if (!requested) {
    return {
      status: "stale-scenario",
      reason:
        "The requested scenario is not part of the current trusted rebuild. Council never presents a scenario whose certificate cannot be reproduced from the accepted property's current state.",
      scenarios,
    };
  }
  if (requested.freshness !== "CURRENT") {
    return {
      status: "stale-certificate",
      reason: `The scenario's certificate is ${requested.freshness}, not CURRENT. Re-run the solver surface to refresh it; council never presents stale truth to any audience.`,
      scenarios,
    };
  }

  const index = recorded.indexOf(requested);
  const solvedScenario = solve.scenarios[index];
  const scenarioNode = graph.nodes[requested.scenarioId];
  if (!solvedScenario || !scenarioNode || scenarioNode.kind !== "scenario") {
    return {
      status: "stale-scenario",
      reason:
        "The selected scenario could not be paired with its deterministic solve result in the current rebuild.",
      scenarios,
    };
  }
  const metric = (metricId: string): number | undefined =>
    scenarioNode.metrics.find((m) => m.metricId === metricId)?.value?.value;
  const homes = metric("homes");
  const footprintSqFt = metric("footprint");
  const floors = metric("floors");
  const parkingStalls = metric("parking-stalls");
  if (
    homes === undefined ||
    footprintSqFt === undefined ||
    floors === undefined ||
    parkingStalls === undefined
  ) {
    return {
      status: "stale-scenario",
      reason:
        "The selected scenario's recorded metrics are incomplete in the current rebuild.",
      scenarios,
    };
  }

  const certificate = snapshot.certificates.find(
    (row) => row.id === requested.certificateId,
  );
  if (!certificate) {
    return {
      status: "stale-certificate",
      reason:
        "The selected scenario's certificate is missing from the current proof snapshot.",
      scenarios,
    };
  }

  const constraintResults: CouncilConstraintResult[] =
    solvedScenario.results.map((result) => ({
      constraint: result.humanLabel,
      source: result.source,
      status: result.status,
      actual:
        result.actual !== undefined
          ? `${result.actual} ${result.actualUnit ?? ""}`.trim()
          : null,
      limit:
        result.limit !== undefined
          ? `${result.limit} ${result.limitUnit ?? ""}`.trim()
          : null,
      explanation: result.explanation,
    }));

  const { missionNodes, preservedStructureLabels, retainOwnership } =
    missionFacts(context);

  // Capital (optional) evaluates the SAME scenario the package presents,
  // inside this assembly — one selection, one set of facts.
  let capitalRaw: CapitalResult | null = null;
  let capitalFp: string | null = null;
  if (input.capital) {
    capitalRaw = evaluateCapital(
      {
        scenarioId: requested.scenarioId,
        certificateId: requested.certificateId,
        scenarioLabel: scenarioNode.label,
        homes,
        floors,
        footprintSqFt,
        parkingStalls,
      },
      input.capital.pathway,
      input.capital.overrides ?? {},
    );
    capitalFp = capitalFingerprint({
      scenarioId: requested.scenarioId,
      certificateId: requested.certificateId,
      pathway: capitalRaw.pathway,
      assumptions: capitalRaw.assumptions,
    });
  }

  const capital: CouncilCapitalSummary | null = capitalRaw
    ? {
        fingerprint: capitalFp as string,
        engineVersion: capitalRaw.engineVersion,
        pathway: PATHWAY_PRESETS[capitalRaw.pathway],
        totalDevelopmentCost: usd(capitalRaw.cost.totalDevelopmentCost),
        identifiedCapital: usd(capitalRaw.funding.identifiedCapital),
        fundingGap: usd(capitalRaw.funding.fundingGap),
        gapPctOfCost: `${capitalRaw.funding.gapPctOfCost}`,
        affordableHomes: capitalRaw.operating.affordableHomes,
        noiYieldOnCostPct: `${capitalRaw.operating.noiYieldOnCostPct}`,
        projection: [...capitalRaw.councilProjection],
        expertRequired: capitalRaw.expertRequired.map((item) => ({
          id: item.id,
          title: item.title,
        })),
      }
    : null;

  const identity = snapshot.identity;
  const projectInfo: CouncilPackage["project"] = {
    projectId: identity.projectId,
    query: identity.query,
    matchedAddress: identity.matchedAddress ?? identity.query,
    district: context.district,
    overlay: context.overlayNames[0] ?? null,
    parcelNodeId: context.subjectNodeId,
    parcelAreaSqFt: solve.geometry.parcelAreaSqFt,
    revision: graph.revision,
  };

  const selected: CouncilPackage["selected"] = {
    scenarioId: requested.scenarioId,
    scenarioLabel: scenarioNode.label,
    homes,
    parkingStalls,
    parkingMargin: solvedScenario.point.parkingMargin,
    footprintSqFt,
    floors,
    heightLimitFt: solve.geometry.heightCeilingFt,
    confidence: solvedScenario.confidence,
    solverVersion: scenarioNode.solverVersion,
    constraintResults,
    satisfiedCount: constraintResults.filter(
      (result) => result.status === "SATISFIED",
    ).length,
    openCount: constraintResults.filter(
      (result) => result.status !== "SATISFIED",
    ).length,
  };

  const mission: CouncilPackage["mission"] = {
    commitments: snapshot.missions.map((row) => ({
      id: row.id,
      intentText: row.intentText,
      normalizedSummary: row.normalizedSummary,
      hardOrSoft: row.hardOrSoft,
    })),
    preservedStructureLabels,
    retainOwnership,
  };

  const evidence: CouncilPackage["evidence"] = {
    assumptions: snapshot.assumptions
      .filter((row) => row.active)
      .map((row) => ({
        statement: row.statement,
        valueSummary: row.valueSummary,
        rationale: row.rationale,
      })),
    conflicts: snapshot.conflicts.map((row) => ({
      semanticRuleKey: row.semanticRuleKey,
      explanation: row.explanation,
      resolution: row.resolution,
    })),
    expertReviews: snapshot.expertReviews.map((row) => ({
      question: row.question,
      category: row.category,
      severity: row.severity,
      reviewStatus: row.reviewStatus,
    })),
    computationQuestions: snapshot.computationQuestions
      .filter((question) => question.scenarioId === requested.scenarioId)
      .map((question) => ({
        label: question.label,
        status: question.status,
        explanation: question.explanation,
      })),
    sources: snapshot.sources.map((row) => ({
      title: row.title,
      publisher: row.publisher,
      authority: row.authority,
      retrievedAt: row.retrievedAt,
    })),
  };

  const blockingReviews = snapshot.expertReviews
    .filter(
      (review) =>
        review.severity === "blocking" && review.reviewStatus === "OPEN",
    )
    .map((review) => review.question);
  const conflictsBlocked = snapshot.conflicts
    .filter((conflict) => conflict.resolution === "blocked")
    .map((conflict) => `${conflict.semanticRuleKey}: ${conflict.explanation}`);

  const certificateInfo: CouncilPackage["certificate"] = {
    id: certificate.id,
    version: certificate.certificateVersion,
    freshness: certificate.freshness,
    freshnessReasons: [...certificate.freshnessReasons],
    dependencyCount: certificate.dependencyCount,
    certificateHash: certificate.certificateHash,
  };

  const openExpertTotal =
    evidence.expertReviews.filter(
      (review) =>
        review.reviewStatus === "OPEN" || review.reviewStatus === "IN_REVIEW",
    ).length +
    evidence.computationQuestions.filter(
      (question) => question.status !== "SATISFIED",
    ).length;

  const facts = buildFacts(
    selected,
    projectInfo,
    mission,
    capitalRaw,
    openExpertTotal,
  );

  const packageFingerprint = councilPackageFingerprint({
    projectId: projectInfo.projectId,
    projectRevision: projectInfo.revision,
    scenarioId: requested.scenarioId,
    certificateId: certificate.id,
    certificateHash: certificate.certificateHash,
    missions: missionNodes.map((node) => ({
      id: node.id,
      revision: node.meta.revision,
    })),
    capitalFingerprint: capitalFp,
  });

  const nextDecision = buildNextDecision(
    facts,
    blockingReviews,
    conflictsBlocked,
    capitalRaw,
  );

  const audienceViews = buildAudienceViews(facts, {
    selected,
    certificate: certificateInfo,
    mission,
    capital,
    capitalRaw: capitalRaw,
    evidence,
    nextDecision,
    project: projectInfo,
    packageFingerprint,
  });

  return {
    status: "assembled",
    package: {
      packageVersion: COUNCIL_PACKAGE_VERSION,
      project: projectInfo,
      scenarios,
      selected,
      certificate: certificateInfo,
      mission,
      capital,
      evidence,
      facts,
      audienceViews,
      nextDecision,
      boundaryNotice: BOARD_BOUNDARY_NOTICE,
      freshness: {
        status: "CURRENT",
        certificateFreshness: certificate.freshness,
      },
      packageFingerprint,
    },
  };
}
