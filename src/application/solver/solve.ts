import { buildSolverInputs, SolveRefusal, type SolverInputs } from "./inputs";
import { computeSiteGeometry, legalDensityCapacity, type SiteGeometry } from "./geometry";

/**
 * Exact integer-homes solver (issue #7, consolidated correction round).
 *
 * The decision variable is INTEGER HOME COUNT — never a footprint lattice.
 * For each (homes, floors, parking) triple the minimum required footprint is
 * derived exactly:
 *
 *   requiredFootprint = ceil(homes × grossPerUnit / floors)
 *
 * and tested against every modeled bound (occupied-area envelope, physical
 * site area budget, tiered legal density, floors/height). The parking range
 * is DERIVED from site area and the stall-area assumption — there is no
 * hidden iteration cap. The explicit enumeration bound is computed BEFORE
 * search; exceeding it refuses (UNSUPPORTED_SEARCH) rather than truncating.
 *
 * One shared capacity primitive — attainableHomes(inputs, geometry,
 * overrides) — powers the primary solve ceiling, every binding proof, every
 * counterfactual, and the nearest alternatives. A constraint is binding only
 * if relaxing EXACTLY that one bound increases attainableHomes.
 *
 * Language discipline (area arithmetic does not prove physical placement
 * until #9 places real polygons): results are "supported within modeled
 * scope", never "proven feasible"; the top of the model is a "modeled upper
 * bound"; the site limit is a "physical site area-budget ceiling". A target
 * ABOVE the modeled upper bound is still safely NO VERIFIED SOLUTION, because
 * failing an optimistic bound proves the target cannot fit under the same
 * hard inputs.
 */

const MAX_ENUM_POINTS = 250_000; // hard, explicit search bound

export const SOLVER_VERSION = "solver/exact-integer-homes v2";

export type SolverConfidence =
  | "SUPPORTED_WITHIN_MODED_SCOPE"
  | "ASSUMPTION_SENSITIVE"
  | "EXPERT_REVIEW_REQUIRED";

export type EvaluatedConstraint = {
  constraintKey: string;
  humanLabel: string;
  source: "law" | "mission" | "assumption";
  constraintId?: string;
  status: "SATISFIED" | "VIOLATED" | "UNKNOWN" | "NOT_EVALUATED" | "EXPERT_REQUIRED";
  actual?: number;
  actualUnit?: string;
  limit?: number;
  limitUnit?: string;
  margin?: number;
  explanation: string;
  method: string;
  lockable?: "law" | "mission" | null;
};

export type CandidatePoint = {
  floors: number;
  parkingStalls: number;
  footprintSqFt: number;
  homes: number;
  parkingMargin: number;
};

export type ScenarioLabel = "HOUSING MAX" | "MISSION BALANCE" | "LOW CHANGE";

export type SolvedScenario = {
  point: CandidatePoint;
  label: ScenarioLabel | null;
  results: EvaluatedConstraint[];
  confidence: SolverConfidence;
  professionalQuestions: string[];
};

export type ModeledCeilings = {
  /** Tiered lot-area-per-unit formula (law). null when no executable density rule. */
  legalDensity: number | null;
  /** Occupied-area envelope × floors ÷ gross-per-unit — parking land NOT subtracted. */
  massing: number;
  /** Parcel − preserved − required parking land, then × floors ÷ gross-per-unit. */
  physicalSiteAreaBudget: number;
  /** min of the independently computed applicable ceilings (0 when use prohibited). */
  overall: number;
};

export type EnumerationFacts = {
  homesUpperBound: number;
  parkingStallsMin: number;
  parkingStallsMax: number;
  floorsCap: number;
  pointsConsidered: number;
};

export type SolveSuccess = {
  status: "SOLVED";
  inputs: SolverInputs;
  geometry: SiteGeometry;
  ceilings: ModeledCeilings;
  /** The modeled upper bound on homes; equals attainableHomes() with no relaxations. */
  modeledUpperBoundHomes: number;
  enumeration: EnumerationFacts;
  scenarios: SolvedScenario[];
  frontier: CandidatePoint[];
};

export type BindingProof = {
  constraintKey: string;
  humanLabel: string;
  source: "law" | "mission" | "assumption";
  currentLimit: number;
  relaxedLimit: number;
  capacityBefore: number;
  capacityAfter: number;
  capacityDelta: number;
  unit: string;
  explanation: string;
  missionLocked: boolean;
};

export type SolveNoSolution = {
  status: "NO_VERIFIED_SOLUTION";
  requestedTarget: number;
  /** The modeled upper bound — NOT a claim of physical realizability. */
  modeledUpperBoundHomes: number;
  binding: BindingProof[];
  counterfactuals: string[];
  nearestAlternatives: CandidatePoint[];
  inputs: SolverInputs;
  geometry: SiteGeometry;
  ceilings: ModeledCeilings;
  enumeration: EnumerationFacts;
  explanationInputs: string[];
};

export type SolveResult = SolveSuccess | SolveNoSolution;

/**
 * Single-bound relaxation for the shared capacity primitive. Each field
 * relaxes EXACTLY one modeled bound; binding proofs pass exactly one.
 */
export type BoundOverrides = {
  occupiedAreaPctAdd?: number;
  heightFtAdd?: number;
  missionParkingSubtract?: number;
  ignorePreservedStructures?: boolean;
  grossPerUnit?: number;
  ignoreDensity?: boolean;
  usePermitAsByRight?: boolean;
};

/**
 * THE shared capacity primitive. Exact integer attainable homes under the
 * modeled constraints (with at most one bound relaxed). For integer homes h,
 * feasibility requires ceil(h·G/F) ≤ R, which is exactly h ≤ floor(R)·F/G —
 * so the exact per-floor maximum is floor(floor(R)·F/G). This is the same
 * arithmetic the enumeration performs with requiredFootprint, so the
 * analytic primitive and the enumeration agree by construction.
 */
export function attainableHomes(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  overrides: BoundOverrides = {},
): number {
  return modeledCeilings(inputs, geometry, overrides).overall;
}

/** Independently computed ceilings (see ModeledCeilings). */
export function modeledCeilings(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  overrides: BoundOverrides = {},
): ModeledCeilings {
  const parcel = geometry.parcelAreaSqFt;
  const preserved = overrides.ignorePreservedStructures
    ? 0
    : geometry.preservedStructureAreaSqFt;
  const occupiedPct = geometry.occupiedAreaCeilingPct + (overrides.occupiedAreaPctAdd ?? 0);
  const occupiedCeiling = (occupiedPct / 100) * parcel;
  const heightFt = geometry.heightCeilingFt + (overrides.heightFtAdd ?? 0);
  const floorsByHeight = Math.max(0, Math.floor(heightFt / inputs.assumptions.storyFloorToFloorFt));
  const floorsCap = Math.min(floorsByHeight, geometry.maxStoriesCap);
  const gross = overrides.grossPerUnit ?? inputs.assumptions.residentialGrossPerUnit;
  const stalls = Math.max(0, geometry.parkingStallsRequired - (overrides.missionParkingSubtract ?? 0));
  const parkingLand = stalls * inputs.assumptions.parkingStallGrossLandArea;

  const legal = overrides.ignoreDensity ? null : legalDensityCapacity(inputs, parcel);
  const occupiedRoom = Math.max(0, occupiedCeiling - preserved);
  const physicalRoom = Math.max(0, parcel - preserved - parkingLand);
  const massing = floorsCap < 1 ? 0 : Math.floor(Math.floor(occupiedRoom) * floorsCap / gross);
  const physicalSiteAreaBudget = floorsCap < 1 ? 0 : Math.floor(Math.floor(physicalRoom) * floorsCap / gross);
  let overall = Math.min(legal ?? Number.POSITIVE_INFINITY, massing, physicalSiteAreaBudget);
  if (inputs.usePermission.state === "PROHIBITED" && !overrides.usePermitAsByRight) {
    overall = 0;
  }
  return { legalDensity: legal, massing, physicalSiteAreaBudget, overall };
}

export function solve(
  project: Parameters<typeof buildSolverInputs>[0],
  request: { targetHomes?: number } = {},
): SolveResult {
  const inputs = buildSolverInputs(project);
  const geometry = computeSiteGeometry(inputs);
  const ceilings = modeledCeilings(inputs, geometry);
  const homesUpperBound = ceilings.overall;

  const floorsCap = geometry.floorsCap;
  const stallMin = geometry.parkingStallsRequired;
  // Derived physical parking bound: the whole non-preserved site as stalls.
  const stallMax = Math.floor(
    (geometry.parcelAreaSqFt - geometry.preservedStructureAreaSqFt) /
      inputs.assumptions.parkingStallGrossLandArea,
  );
  const stallRange = Math.max(0, stallMax - stallMin + 1);
  const points = (homesUpperBound + 1) * Math.max(0, floorsCap) * stallRange;
  if (points > MAX_ENUM_POINTS) {
    throw new SolveRefusal(
      "UNSUPPORTED_SEARCH",
      `search space ${points} exceeds the explicit bound ${MAX_ENUM_POINTS} ` +
        `(homes 0..${homesUpperBound} × floors 1..${floorsCap} × stalls ${stallMin}..${stallMax}); ` +
        `refusing rather than truncating`,
    );
  }
  const enumeration: EnumerationFacts = {
    homesUpperBound,
    parkingStallsMin: stallMin,
    parkingStallsMax: stallMax,
    floorsCap,
    pointsConsidered: points,
  };

  // Fail closed on degenerate inputs (typed result, never a crash).
  if (floorsCap < 1) {
    return noSolution(inputs, geometry, ceilings, enumeration, request.targetHomes ?? 0, [
      `Height ceiling ${geometry.heightCeilingFt} ft allows 0 floors at ${inputs.assumptions.storyFloorToFloorFt} ft/story (floor-to-floor assumption).`,
    ]);
  }

  // Exact integer-homes enumeration over the full derived modeled space.
  const gross = inputs.assumptions.residentialGrossPerUnit;
  const stallArea = inputs.assumptions.parkingStallGrossLandArea;
  const feasible: CandidatePoint[] = [];
  if (stallRange > 0) {
    for (let homes = 0; homes <= homesUpperBound; homes += 1) {
      for (let floors = 1; floors <= floorsCap; floors += 1) {
        const requiredFootprint = Math.ceil((homes * gross) / floors);
        const occupiedActual = geometry.preservedStructureAreaSqFt + requiredFootprint;
        if (occupiedActual > geometry.occupiedAreaCeilingSqFt) continue;
        const maxParkingLand = geometry.parcelAreaSqFt - geometry.preservedStructureAreaSqFt - requiredFootprint;
        const stallsCeilingByLand = Math.floor(maxParkingLand / stallArea);
        const stallsTop = Math.min(stallMax, stallsCeilingByLand);
        for (let stalls = stallMin; stalls <= stallsTop; stalls += 1) {
          feasible.push({
            floors,
            parkingStalls: stalls,
            footprintSqFt: requiredFootprint,
            homes,
            parkingMargin: stalls - stallMin,
          });
        }
      }
    }
  }

  // Internal consistency: the enumeration is the ground truth; it can never
  // exceed the analytic upper bound. If it ever did, the model is wrong.
  const enumeratedMax = feasible.reduce((m, p) => Math.max(m, p.homes), 0);
  if (enumeratedMax > homesUpperBound) {
    throw new Error(
      `internal inconsistency: enumeration found ${enumeratedMax} homes above the modeled upper bound ${homesUpperBound}`,
    );
  }

  // Reduce before non-domination: for a given (homes, footprint) only the
  // max-margin point can be non-dominated, so collapse to ≤ homes×floors
  // entries first. Keeps the frontier exact and the filter fast.
  const bestByKey = new Map<string, CandidatePoint>();
  for (const point of feasible) {
    const key = `${point.homes}:${point.footprintSqFt}`;
    const current = bestByKey.get(key);
    if (!current || point.parkingMargin > current.parkingMargin) {
      bestByKey.set(key, point);
    }
  }
  const reduced = [...bestByKey.values()];

  // Non-dominated frontier: homes ↑, parking margin ↑, footprint ↓.
  const fullFrontier = reduced.filter((a) =>
    !reduced.some(
      (b) =>
        b !== a &&
        b.homes >= a.homes &&
        b.parkingMargin >= a.parkingMargin &&
        b.footprintSqFt <= a.footprintSqFt &&
        (b.homes > a.homes || b.parkingMargin > a.parkingMargin || b.footprintSqFt < a.footprintSqFt),
    ),
  );
  fullFrontier.sort((a, b) => b.homes - a.homes || b.parkingMargin - a.parkingMargin || a.footprintSqFt - b.footprintSqFt);

  let frontier = fullFrontier;
  if (request.targetHomes !== undefined) {
    const target = Math.floor(request.targetHomes);
    if (!Number.isFinite(target) || target < 0) {
      throw new Error("targetHomes must be a non-negative finite integer");
    }
    if (!feasible.some((p) => p.homes >= target)) {
      return noSolutionFromFrontier(inputs, geometry, ceilings, enumeration, target, fullFrontier);
    }
    // A goal solve presents the frontier AT OR ABOVE the goal.
    frontier = fullFrontier.filter((p) => p.homes >= target);
  } else if (enumeratedMax < 1) {
    return noSolutionFromFrontier(inputs, geometry, ceilings, enumeration, 0, fullFrontier);
  }

  // Presentation labels chosen AFTER the frontier exists, by documented
  // criteria (see ADR 0007 §5). They never control generation.
  const selected = selectPresentationPoints(frontier);
  const scenarios: SolvedScenario[] = selected.map((entry) => {
    const results = evaluatePoint(inputs, geometry, entry.point);
    const notEvaluated = results.filter((r) => r.status === "NOT_EVALUATED" || r.status === "UNKNOWN");
    const expert = results.filter((r) => r.status === "EXPERT_REQUIRED");
    let confidence: SolverConfidence =
      expert.length > 0
        ? "EXPERT_REVIEW_REQUIRED"
        : notEvaluated.length > 0
          ? "ASSUMPTION_SENSITIVE"
          : "SUPPORTED_WITHIN_MODED_SCOPE";
    const professionalQuestions = [
      ...expert.map((r) => r.explanation),
      ...notEvaluated.map((r) => r.explanation),
    ];
    if (inputs.usePermission.state === "SPECIAL_EXCEPTION") {
      // Conditional pathway: the use is not prohibited, but it is not
      // by-right either — every scenario depends on zoning relief.
      confidence = "EXPERT_REVIEW_REQUIRED";
      professionalQuestions.unshift(
        `Multi-family residential is a SPECIAL_EXCEPTION use in this district: every scenario here is a conditional pathway that requires zoning-board approval before it can be relied upon.`,
      );
    }
    return { point: entry.point, label: entry.label, results, confidence, professionalQuestions };
  });

  return {
    status: "SOLVED",
    inputs,
    geometry,
    ceilings,
    modeledUpperBoundHomes: homesUpperBound,
    enumeration,
    scenarios,
    frontier,
  };
}

/**
 * Documented label criteria (ADR 0007 §5), applied to the computed frontier:
 *
 * - Useful set U: frontier points delivering at least half of the modeled
 *   maximum homes — the documented usefulness criterion (a presented project
 *   must still meaningfully advance the housing mission).
 * - HOUSING MAX: max homes over the whole frontier; ties broken by max
 *   parking margin, then min footprint.
 * - LOW CHANGE: min footprint within U; ties broken by max margin, then max
 *   homes. It is by construction the smallest-footprint displayed scenario.
 * - MISSION BALANCE: the Pareto knee WITHIN U — the point closest
 *   (min-max-normalized Euclidean distance over U) to the ideal corner (max
 *   homes, max margin, min footprint); ties broken by max homes. It
 *   represents the homes-vs-parking-margin tradeoff without drifting into
 *   useless extremes.
 *
 * The three selected points are distinct when the frontier allows it.
 */
function selectPresentationPoints(frontier: CandidatePoint[]): Array<{ label: ScenarioLabel; point: CandidatePoint }> {
  if (frontier.length === 0) return [];
  const selected: Array<{ label: ScenarioLabel; point: CandidatePoint }> = [];
  const taken = new Set<CandidatePoint>();

  const maxHomes = frontier[0].homes; // sorted homes desc
  const useful = frontier.filter((p) => p.homes >= Math.ceil(maxHomes / 2));
  const candidatePool = useful.length > 0 ? useful : frontier;

  const housingMax =
    frontier.find(
      (p) =>
        p.homes === maxHomes &&
        (!frontier.some(
          (q) =>
            q !== p && q.homes === maxHomes &&
            (q.parkingMargin > p.parkingMargin ||
              (q.parkingMargin === p.parkingMargin && q.footprintSqFt < p.footprintSqFt)),
        )),
    ) ?? frontier[0];
  selected.push({ label: "HOUSING MAX", point: housingMax });
  taken.add(housingMax);

  if (frontier.length > 1) {
    const lowCandidates = candidatePool.filter((p) => !taken.has(p));
    const lowChange =
      lowCandidates.find(
        (p) =>
          !lowCandidates.some(
            (q) =>
              q !== p &&
              (q.footprintSqFt < p.footprintSqFt ||
                (q.footprintSqFt === p.footprintSqFt &&
                  (q.parkingMargin > p.parkingMargin ||
                    (q.parkingMargin === p.parkingMargin && q.homes > p.homes)))),
          ),
      ) ?? lowCandidates[0];
    if (lowChange) {
      selected.push({ label: "LOW CHANGE", point: lowChange });
      taken.add(lowChange);
    }
  }

  if (candidatePool.length > selected.length) {
    const homesValues = candidatePool.map((p) => p.homes);
    const marginValues = candidatePool.map((p) => p.parkingMargin);
    const footprints = candidatePool.map((p) => p.footprintSqFt);
    const minHomes = Math.min(...homesValues);
    const maxOfHomes = Math.max(...homesValues);
    const minMargin = Math.min(...marginValues);
    const maxMargin = Math.max(...marginValues);
    const minFootprint = Math.min(...footprints);
    const maxFootprint = Math.max(...footprints);
    const norm = (v: number, min: number, max: number) =>
      max > min ? (v - min) / (max - min) : 0.5;
    const distance = (p: CandidatePoint) =>
      Math.hypot(
        1 - norm(p.homes, minHomes, maxOfHomes),
        1 - norm(p.parkingMargin, minMargin, maxMargin),
        norm(p.footprintSqFt, minFootprint, maxFootprint),
      );
    const remaining = candidatePool.filter((p) => !taken.has(p));
    const missionBalance = remaining.reduce(
      (best, p) => (distance(p) < distance(best) - 1e-12 ? p : best),
      remaining[0],
    );
    if (missionBalance) selected.push({ label: "MISSION BALANCE", point: missionBalance });
  }

  // Display order: HOUSING MAX, MISSION BALANCE, LOW CHANGE.
  const order: Record<ScenarioLabel, number> = { "HOUSING MAX": 0, "MISSION BALANCE": 1, "LOW CHANGE": 2 };
  return selected.sort((a, b) => order[a.label] - order[b.label]);
}

function noSolution(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  ceilings: ModeledCeilings,
  enumeration: EnumerationFacts,
  requestedTarget: number,
  explanationInputs: string[],
): SolveNoSolution {
  return {
    status: "NO_VERIFIED_SOLUTION",
    requestedTarget,
    modeledUpperBoundHomes: ceilings.overall,
    binding: [],
    counterfactuals: [],
    nearestAlternatives: [],
    inputs,
    geometry,
    ceilings,
    enumeration,
    explanationInputs,
  };
}

function noSolutionFromFrontier(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  ceilings: ModeledCeilings,
  enumeration: EnumerationFacts,
  target: number,
  frontier: CandidatePoint[],
): SolveNoSolution {
  const binding = proveBinding(inputs, geometry, ceilings);
  const counterfactuals = binding.map((proof) =>
    proof.missionLocked
      ? `Changing locked mission rule ${proof.humanLabel} (${proof.currentLimit} → ${proof.relaxedLimit} ${proof.unit}) would raise the modeled bound by ${proof.capacityDelta} homes, but Acrevia did not use that alternative.`
      : `Relaxing ${proof.humanLabel} from ${proof.currentLimit} to ${proof.relaxedLimit} ${proof.unit} would raise the modeled bound by ${proof.capacityDelta} homes.`,
  );
  return {
    status: "NO_VERIFIED_SOLUTION",
    requestedTarget: target,
    modeledUpperBoundHomes: ceilings.overall,
    binding,
    counterfactuals,
    nearestAlternatives: frontier.slice(0, 3),
    inputs,
    geometry,
    ceilings,
    enumeration,
    explanationInputs: [
      `Zoning tiered density supports ${ceilings.legalDensity ?? "—"} homes on this parcel (law).`,
      `Building massing (occupied-area envelope × ${geometry.floorsCap} floors ÷ ${inputs.assumptions.residentialGrossPerUnit} sq ft/unit) supports ${ceilings.massing}.`,
      `Physical site area budget (parcel − preserved sanctuary ${Math.round(geometry.preservedStructureAreaSqFt)} sq ft − ${geometry.parkingStallsRequired} required stalls × ${inputs.assumptions.parkingStallGrossLandArea} sq ft, then × floors ÷ gross/unit) supports ${ceilings.physicalSiteAreaBudget}.`,
      `The modeled upper bound is ${ceilings.overall} homes. Area arithmetic does not prove physical placement — spatial packing and unresolved setbacks can only lower the realizable result, never raise it.`,
    ],
  };
}

/**
 * Mechanical binding proof over the SAME shared primitive as the primary
 * solve: relax EXACTLY ONE bound, recompute attainableHomes, and report the
 * delta. A constraint binds only when its single-bound relaxation increases
 * the modeled bound. Mission-locked relaxations are explanatory only.
 */
function proveBinding(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  base: ModeledCeilings,
): BindingProof[] {
  const proofs: BindingProof[] = [];
  const before = base.overall;
  const missionIds = new Set(inputs.missions.map((m) => m.id));
  const pushProof = (draft: Omit<BindingProof, "capacityDelta">) => {
    const delta = draft.capacityAfter - draft.capacityBefore;
    if (delta <= 0) return; // only constraints whose single-bound relaxation changes capacity bind
    proofs.push({ ...draft, capacityDelta: delta });
  };

  // Law: occupied-area ceiling (+5 percentage points).
  const oaPct = geometry.occupiedAreaCeilingPct;
  pushProof({
    constraintKey: "law:occupied-area",
    humanLabel: "Occupied area ceiling",
    source: "law",
    currentLimit: oaPct,
    relaxedLimit: oaPct + 5,
    capacityBefore: before,
    capacityAfter: attainableHomes(inputs, geometry, { occupiedAreaPctAdd: 5 }),
    unit: "% of lot",
    explanation: "Structures above grade may cover at most this share of the lot (adopted code §14-202(12) basis).",
    missionLocked: false,
  });

  // Law: height ceiling (+10 ft).
  pushProof({
    constraintKey: "law:height",
    humanLabel: "Height ceiling",
    source: "law",
    currentLimit: geometry.heightCeilingFt,
    relaxedLimit: geometry.heightCeilingFt + 10,
    capacityBefore: before,
    capacityAfter: attainableHomes(inputs, geometry, { heightFtAdd: 10 }),
    unit: "ft",
    explanation: "Taller buildings allow more floors at the same footprint.",
    missionLocked: false,
  });

  // Law: tiered density (binding only when it is the minimum ceiling).
  if (base.legalDensity !== null && base.legalDensity <= Math.min(base.massing, base.physicalSiteAreaBudget)) {
    pushProof({
      constraintKey: "law:density",
      humanLabel: "Dwelling density (tiered lot-area-per-unit)",
      source: "law",
      currentLimit: base.legalDensity,
      relaxedLimit: base.legalDensity,
      capacityBefore: before,
      capacityAfter: attainableHomes(inputs, geometry, { ignoreDensity: true }),
      unit: "dwelling_units",
      explanation: "The tiered minimum-lot-area-per-unit formula caps homes on this parcel; removing only that cap raises the modeled bound.",
      missionLocked: false,
    });
  }

  // Law: multi-family use permission (binding only when PROHIBITED).
  if (inputs.usePermission.state === "PROHIBITED") {
    pushProof({
      constraintKey: inputs.usePermission.constraintId,
      humanLabel: "Multi-family use permission",
      source: "law",
      currentLimit: 0,
      relaxedLimit: 1,
      capacityBefore: before,
      capacityAfter: attainableHomes(inputs, geometry, { usePermitAsByRight: true }),
      unit: "permission",
      explanation: "Multi-family residential use is prohibited in this district; no housing scenario exists while the prohibition stands.",
      missionLocked: false,
    });
  }

  // Mission: min-parking (−20 stalls; mission-locked, never recommended).
  const missionParking = inputs.missions.find((m) => m.normalized.type === "min-parking");
  if (missionParking && geometry.parkingStallsRequired > 0) {
    pushProof({
      constraintKey: missionParking.id,
      humanLabel: "Sunday parking minimum (mission)",
      source: "mission",
      currentLimit: geometry.parkingStallsRequired,
      relaxedLimit: Math.max(0, geometry.parkingStallsRequired - 20),
      capacityBefore: before,
      capacityAfter: attainableHomes(inputs, geometry, { missionParkingSubtract: 20 }),
      unit: "spaces",
      explanation: "USER_DECLARED mission rule — reserving less surface-parking land frees area for homes.",
      missionLocked: true,
    });
  }

  // Mission: preserve-structure (removing preservation; mission-locked).
  const preserveMission = inputs.missions.find((m) => m.normalized.type === "preserve-structure");
  if (preserveMission && geometry.preservedStructureAreaSqFt > 0) {
    pushProof({
      constraintKey: preserveMission.id,
      humanLabel: "Sanctuary preservation (mission)",
      source: "mission",
      currentLimit: Math.round(geometry.preservedStructureAreaSqFt),
      relaxedLimit: 0,
      capacityBefore: before,
      capacityAfter: attainableHomes(inputs, geometry, { ignorePreservedStructures: true }),
      unit: "sq ft preserved",
      explanation: "USER_DECLARED mission rule — Acrevia never proposes demolishing the sanctuary.",
      missionLocked: missionIds.has(preserveMission.id),
    });
  }

  // Assumption: gross-per-unit (−200 sq ft) — assumption-sensitive, not legal.
  pushProof({
    constraintKey: "assumption:residential-gross-per-unit",
    humanLabel: "Gross area per unit (assumption)",
    source: "assumption",
    currentLimit: inputs.assumptions.residentialGrossPerUnit,
    relaxedLimit: inputs.assumptions.residentialGrossPerUnit - 200,
    capacityBefore: before,
    capacityAfter: attainableHomes(inputs, geometry, {
      grossPerUnit: inputs.assumptions.residentialGrossPerUnit - 200,
    }),
    unit: "sq ft/unit",
    explanation: "Assumption-sensitive, not legal: a smaller unit program changes the modeled bound.",
    missionLocked: false,
  });

  return proofs;
}

function evaluatePoint(inputs: SolverInputs, geometry: SiteGeometry, point: CandidatePoint): EvaluatedConstraint[] {
  const results: EvaluatedConstraint[] = [];
  const occupiedActual = geometry.preservedStructureAreaSqFt + point.footprintSqFt;
  const parkingLandActual = point.parkingStalls * inputs.assumptions.parkingStallGrossLandArea;

  for (const constraint of inputs.law) {
    switch (constraint.constraintKind) {
      case "height": {
        const actual = point.floors * inputs.assumptions.storyFloorToFloorFt;
        results.push({
          constraintKey: constraint.id,
          humanLabel: "Building height",
          source: "law",
          constraintId: constraint.id,
          status: actual <= constraint.limit.value ? "SATISFIED" : "VIOLATED",
          actual,
          actualUnit: "ft",
          limit: constraint.limit.value,
          limitUnit: "ft",
          margin: constraint.limit.value - actual,
          explanation: `${point.floors} floors × ${inputs.assumptions.storyFloorToFloorFt} ft floor-to-floor (assumption) = ${actual} ft vs the ${constraint.limit.value} ft law cap.`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "occupied-area": {
        results.push({
          constraintKey: constraint.id,
          humanLabel: "Occupied area (structures above grade)",
          source: "law",
          constraintId: constraint.id,
          status: occupiedActual <= geometry.occupiedAreaCeilingSqFt ? "SATISFIED" : "VIOLATED",
          actual: Math.round(occupiedActual),
          actualUnit: "sq_ft",
          limit: Math.round(geometry.occupiedAreaCeilingSqFt),
          limitUnit: "sq_ft",
          margin: Math.round(geometry.occupiedAreaCeilingSqFt - occupiedActual),
          explanation: `Sanctuary ${Math.round(geometry.preservedStructureAreaSqFt)} + new building ${point.footprintSqFt} = ${Math.round(occupiedActual)} sq ft of structures vs the ${geometry.occupiedAreaCeilingPct}% ceiling. Surface parking is land consumption, not occupied area (§14-202(12)).`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "parking-requirement": {
        if (constraint.requirement.type === "fixed") {
          results.push({
            constraintKey: constraint.id,
            humanLabel: `Required parking (${constraint.use})`,
            source: "law",
            constraintId: constraint.id,
            status: point.parkingStalls >= constraint.requirement.spaces.value ? "SATISFIED" : "VIOLATED",
            actual: point.parkingStalls,
            actualUnit: "spaces",
            limit: constraint.requirement.spaces.value,
            limitUnit: "spaces",
            margin: point.parkingStalls - constraint.requirement.spaces.value,
            explanation: `Adopted code requires ${constraint.requirement.spaces.value} spaces for ${constraint.use}; the scenario retains ${point.parkingStalls}.`,
            method: SOLVER_VERSION,
            lockable: "law",
          });
        } else {
          results.push({
            constraintKey: constraint.id,
            humanLabel: `Required parking (${constraint.use})`,
            source: "law",
            constraintId: constraint.id,
            status: "NOT_EVALUATED",
            explanation: `The adopted-code parking rule for ${constraint.use} is a formula (${constraint.requirement.text}); seat and floor-area inputs are not available in project state, so it cannot be deterministically evaluated. The mission parking value is NOT proof of legal satisfaction.`,
            method: SOLVER_VERSION,
            lockable: "law",
          });
        }
        break;
      }
      case "density": {
        const legal = legalDensityCapacity(inputs, geometry.parcelAreaSqFt);
        results.push({
          constraintKey: constraint.id,
          humanLabel: "Dwelling density (tiered lot-area-per-unit)",
          source: "law",
          constraintId: constraint.id,
          status: legal === null ? "NOT_EVALUATED" : point.homes <= legal ? "SATISFIED" : "VIOLATED",
          actual: point.homes,
          actualUnit: "dwelling_units",
          limit: legal ?? undefined,
          limitUnit: "dwelling_units",
          margin: legal === null ? undefined : legal - point.homes,
          explanation: legal === null
            ? "Density formula could not be read from the executable constraint."
            : `RM-1 tiered formula supports ${legal} homes on ${Math.round(geometry.parcelAreaSqFt)} sq ft; scenario has ${point.homes}.`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "setback": {
        results.push({
          constraintKey: constraint.id,
          humanLabel: `${constraint.face} setback`,
          source: "law",
          constraintId: constraint.id,
          status: constraint.spec.type === "contextual" ? "EXPERT_REQUIRED" : "NOT_EVALUATED",
          explanation: constraint.spec.type === "contextual"
            ? `The ${constraint.face} setback is contextual (adjacent blockface facades) — a professional must classify the frontage and provide neighbor geometry before it can be evaluated.`
            : `Lot-line roles (front/side/rear) are not classified in trusted state, so the ${constraint.face} numeric setback cannot be verified against this massing. A separately-labeled planning envelope assumption exists for conceptual massing only.`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "use-permission": {
        const isMultiFamily = /multi[\s-]?family/i.test(String(constraint.use ?? ""));
        results.push({
          constraintKey: constraint.id,
          humanLabel: `${constraint.use} use permission`,
          source: "law",
          constraintId: constraint.id,
          status:
            constraint.permission === "BY_RIGHT"
              ? "SATISFIED"
              : constraint.permission === "SPECIAL_EXCEPTION"
                ? "EXPERT_REQUIRED"
                : "VIOLATED",
          explanation:
            constraint.permission === "BY_RIGHT"
              ? `${constraint.use} is by-right in this district.`
              : constraint.permission === "SPECIAL_EXCEPTION"
                ? `${constraint.use} requires a special exception here: this scenario is a conditional pathway that needs zoning-board approval — supported within modeled scope only.`
                : `${constraint.use} is prohibited in this district${isMultiFamily ? "; no multi-family scenario can exist" : ""}.`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "overlay-prohibition": {
        results.push({
          constraintKey: constraint.id,
          humanLabel: `${constraint.overlay} prohibition`,
          source: "law",
          constraintId: constraint.id,
          status: "SATISFIED",
          actual: 0,
          actualUnit: "dwelling_units",
          explanation: `Scenario proposes 0 ${constraint.prohibits.replace(/-/g, " ")}; the ${constraint.overlay} prohibition is satisfied.`,
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      case "density-bonus": {
        results.push({
          constraintKey: constraint.id,
          humanLabel: "Density bonus",
          source: "law",
          constraintId: constraint.id,
          status: "NOT_EVALUATED",
          explanation: "Bonus tiers are not claimed by this scenario; not evaluated.",
          method: SOLVER_VERSION,
          lockable: "law",
        });
        break;
      }
      default:
        break;
    }
  }

  // Mission constraints.
  for (const mission of inputs.missions) {
    switch (mission.normalized.type) {
      case "min-parking": {
        const required = mission.normalized.spaces.value;
        results.push({
          constraintKey: mission.id,
          humanLabel: "Sunday parking minimum (mission)",
          source: "mission",
          constraintId: mission.id,
          status: point.parkingStalls >= required ? "SATISFIED" : "VIOLATED",
          actual: point.parkingStalls,
          actualUnit: "spaces",
          limit: required,
          limitUnit: "spaces",
          margin: point.parkingStalls - required,
          explanation: `USER_DECLARED mission rule: keep at least ${required} Sunday parking spaces. This is mission state, not a legal parking requirement.`,
          method: SOLVER_VERSION,
          lockable: "mission",
        });
        break;
      }
      case "preserve-structure": {
        const graphId = mission.normalized.structureId;
        const structure = inputs.structures.find((s) => s.graphId === graphId);
        results.push({
          constraintKey: mission.id,
          humanLabel: "Sanctuary preservation (mission)",
          source: "mission",
          constraintId: mission.id,
          status: structure ? "SATISFIED" : "UNKNOWN",
          actual: structure ? Math.round(structure.computedAreaSqFt || geometry.preservedStructureAreaSqFt) : undefined,
          actualUnit: "sq_ft",
          limit: 0,
          limitUnit: "sq_ft",
          margin: structure ? 0 : undefined,
          explanation: structure
            ? `The preserved structure (${graphId}) is fully excluded from the development envelope; 0 sq_ft of it may be removed.`
            : `Preserved structure ${graphId} was not found among resolved structures.`,
          method: `${SOLVER_VERSION} (turf geodesic area)`,
          lockable: "mission",
        });
        break;
      }
      case "retain-ownership": {
        results.push({
          constraintKey: mission.id,
          humanLabel: "Land ownership (mission)",
          source: "mission",
          constraintId: mission.id,
          status: "SATISFIED",
          explanation: "Scenario assumes the congregation retains ownership; no sale or ground-lease disposition is modeled.",
          method: SOLVER_VERSION,
          lockable: "mission",
        });
        break;
      }
      case "max-stories": {
        results.push({
          constraintKey: mission.id,
          humanLabel: "Story cap (mission)",
          source: "mission",
          constraintId: mission.id,
          status: point.floors <= mission.normalized.stories.value ? "SATISFIED" : "VIOLATED",
          actual: point.floors,
          actualUnit: "stories",
          limit: mission.normalized.stories.value,
          limitUnit: "stories",
          margin: mission.normalized.stories.value - point.floors,
          explanation: `USER_DECLARED mission rule: at most ${mission.normalized.stories.value} stories.`,
          method: SOLVER_VERSION,
          lockable: "mission",
        });
        break;
      }
      case "max-height": {
        const actual = point.floors * inputs.assumptions.storyFloorToFloorFt;
        results.push({
          constraintKey: mission.id,
          humanLabel: "Height cap (mission)",
          source: "mission",
          constraintId: mission.id,
          status: actual <= mission.normalized.limit.value ? "SATISFIED" : "VIOLATED",
          actual,
          actualUnit: "ft",
          limit: mission.normalized.limit.value,
          limitUnit: "ft",
          margin: mission.normalized.limit.value - actual,
          explanation: `USER_DECLARED mission rule: no taller than ${mission.normalized.limit.value} ft.`,
          method: SOLVER_VERSION,
          lockable: "mission",
        });
        break;
      }
      default:
        break;
    }
  }

  // Assumption-derived entries (never masquerading as legal).
  results.push({
    constraintKey: "assumption:planning-envelope-uniform-setback",
    humanLabel: "Planning envelope (assumption-derived)",
    source: "assumption",
    status: "NOT_EVALUATED",
    explanation: `Conceptual massing uses a uniform ${inputs.assumptions.planningEnvelopeSetbackFt} ft assumed setback buffered on the real parcel polygon (${Math.round(geometry.planningEnvelopeAreaSqFt)} sq ft). This is NOT verified legal setback compliance; legal setback results above are independently NOT_EVALUATED/EXPERT_REQUIRED.`,
    method: `${SOLVER_VERSION} (@turf/buffer, feet units)`,
  });
  results.push({
    constraintKey: "assumption:site-land-consumption",
    humanLabel: "Site land consumption (parking + structures)",
    source: "assumption",
    status:
      point.footprintSqFt + parkingLandActual + geometry.preservedStructureAreaSqFt <= geometry.parcelAreaSqFt
        ? "SATISFIED"
        : "VIOLATED",
    actual: Math.round(point.footprintSqFt + parkingLandActual + geometry.preservedStructureAreaSqFt),
    actualUnit: "sq_ft",
    limit: Math.round(geometry.parcelAreaSqFt),
    limitUnit: "sq_ft",
    margin: Math.round(
      geometry.parcelAreaSqFt - point.footprintSqFt - parkingLandActual - geometry.preservedStructureAreaSqFt,
    ),
    explanation: `Sanctuary + new building + ${point.parkingStalls} surface stalls × ${inputs.assumptions.parkingStallGrossLandArea} sq ft (assumption) must fit the parcel's area budget. This is AREA ARITHMETIC, not a placement proof — packing and unresolved setbacks can only lower what is realizable.`,
    method: SOLVER_VERSION,
  });

  return results;
}
