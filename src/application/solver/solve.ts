import { buildSolverInputs, SolveRefusal, type SolverInputs } from "./inputs";
import { computeSiteGeometry, legalDensityCapacity, type SiteGeometry } from "./geometry";

/**
 * Deterministic bounded enumerator (issue #7). Decision lattice: floors
 * (1..floorsCap), parking stalls (required..required+PARKING_ENUM_SPAN),
 * building footprint (0..developableMax, FOOTPRINT_STEP sq ft). Homes are
 * derived: floor(footprint × floors ÷ gross-per-unit). The explicit
 * enumeration bound is computed BEFORE search; exceeding it refuses rather
 * than truncating. Non-domination over (homes ↑, parking margin ↑,
 * footprint ↓) is computed; presentation labels are applied afterward.
 */

const FOOTPRINT_STEP = 500; // sq ft granularity
const PARKING_ENUM_SPAN = 60; // stalls beyond the required floor
const MAX_ENUM_POINTS = 250_000; // hard, explicit search bound

export type SolverConfidence =
  | "VERIFIED_WITHIN_MODED_SCOPE"
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

export type SolvedScenario = {
  point: CandidatePoint;
  label: "HOUSING MAX" | "MISSION BALANCE" | "LOW CHANGE" | null;
  results: EvaluatedConstraint[];
  confidence: SolverConfidence;
  professionalQuestions: string[];
};

export type SolveSuccess = {
  status: "SOLVED";
  inputs: SolverInputs;
  geometry: SiteGeometry;
  legalDensityCeiling: number | null;
  massingCeiling: number;
  physicalSiteCeiling: number;
  overallCeiling: number;
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
  maxFeasibleHomes: number;
  binding: BindingProof[];
  counterfactuals: string[];
  nearestAlternatives: CandidatePoint[];
  inputs: SolverInputs;
  geometry: SiteGeometry;
  ceilings: {
    legalDensity: number | null;
    massing: number;
    physicalSite: number;
    overall: number;
  };
  explanationInputs: string[];
};

export type SolveResult = SolveSuccess | SolveNoSolution;

function homeBound(footprintSqFt: number, floors: number, grossPerUnit: number): number {
  return Math.floor((footprintSqFt * floors) / grossPerUnit);
}

/** Max homes attainable given a developable-footprint override (for binding proofs). */
function maxHomesWith(
  footprintMax: number,
  floorsCap: number,
  grossPerUnit: number,
  legalCap: number | null,
): number {
  if (floorsCap < 1 || footprintMax < FOOTPRINT_STEP) return 0;
  const homes = homeBound(Math.floor(footprintMax / FOOTPRINT_STEP) * FOOTPRINT_STEP, floorsCap, grossPerUnit);
  return legalCap === null ? homes : Math.min(homes, legalCap);
}

export function solve(
  project: Parameters<typeof buildSolverInputs>[0],
  request: { targetHomes?: number } = {},
): SolveResult {
  const inputs = buildSolverInputs(project);
  const geometry = computeSiteGeometry(inputs);
  const legal = legalDensityCapacity(inputs, geometry.parcelAreaSqFt);

  // Fail closed on degenerate inputs.
  if (geometry.floorsCap < 1) {
    return noSolution(inputs, geometry, legal, request.targetHomes ?? 0, 0, [
      `Height ceiling ${geometry.heightCeilingFt} ft allows 0 floors at ${inputs.assumptions.storyFloorToFloorFt} ft/story.`,
    ]);
  }
  if (geometry.developableFootprintMaxSqFt <= 0) {
    return noSolution(inputs, geometry, legal, request.targetHomes ?? 0, 0, [
      "No developable land remains after preserved structures and required parking.",
    ]);
  }

  // Explicit enumeration bound, computed BEFORE search.
  const floorSteps = Math.floor(geometry.developableFootprintMaxSqFt / FOOTPRINT_STEP);
  const points =
    floorSteps *
    geometry.floorsCap *
    (PARKING_ENUM_SPAN + 1);
  if (points > MAX_ENUM_POINTS) {
    throw new SolveRefusal(
      "UNSUPPORTED_SEARCH",
      `search space ${points} exceeds the explicit bound ${MAX_ENUM_POINTS}; refusing rather than truncating`,
    );
  }

  // Enumerate the feasible lattice.
  const feasible: CandidatePoint[] = [];
  for (let floors = 1; floors <= geometry.floorsCap; floors += 1) {
    for (let stalls = geometry.parkingStallsRequired; stalls <= geometry.parkingStallsRequired + PARKING_ENUM_SPAN; stalls += 1) {
      const parkingLand = stalls * inputs.assumptions.parkingStallGrossLandArea;
      const physicalRoom = Math.max(0, geometry.parcelAreaSqFt - geometry.preservedStructureAreaSqFt - parkingLand);
      const occupiedRoom = geometry.occupiedRoomSqFt;
      const footprintMax = Math.min(physicalRoom, occupiedRoom);
      const steps = Math.floor(footprintMax / FOOTPRINT_STEP);
      if (steps < 1) continue;
      const footprint = steps * FOOTPRINT_STEP;
      let homes = homeBound(footprint, floors, inputs.assumptions.residentialGrossPerUnit);
      if (legal !== null) homes = Math.min(homes, legal);
      feasible.push({
        floors,
        parkingStalls: stalls,
        footprintSqFt: footprint,
        homes,
        parkingMargin: stalls - geometry.parkingStallsRequired,
      });
    }
  }

  // Non-dominated frontier: homes ↑, parkingMargin ↑, footprint ↓.
  const frontier = feasible.filter((a) =>
    !feasible.some(
      (b) =>
        b !== a &&
        b.homes >= a.homes &&
        b.parkingMargin >= a.parkingMargin &&
        b.footprintSqFt <= a.footprintSqFt &&
        (b.homes > a.homes || b.parkingMargin > a.parkingMargin || b.footprintSqFt < a.footprintSqFt),
    ),
  );
  frontier.sort((a, b) => b.homes - a.homes || b.parkingMargin - a.parkingMargin || a.footprintSqFt - b.footprintSqFt);

  const massingCeiling = maxHomesWith(
    geometry.developableFootprintMaxSqFt,
    geometry.floorsCap,
    inputs.assumptions.residentialGrossPerUnit,
    null,
  );
  const physicalSiteCeiling = massingCeiling; // footprint already physical-limited
  const overallCeiling = legal === null ? massingCeiling : Math.min(massingCeiling, legal);

  if (request.targetHomes !== undefined) {
    const target = Math.floor(request.targetHomes);
    if (!Number.isFinite(target) || target < 0) {
      throw new Error("targetHomes must be a non-negative finite integer");
    }
    const best = feasible.reduce((m, p) => Math.max(m, p.homes), 0);
    if (target > best) {
      return noSolutionFromFrontier(inputs, geometry, legal, target, best, frontier);
    }
  }

  // Presentation labels applied AFTER frontier computation (they never control generation).
  const scenarios: SolvedScenario[] = frontier.slice(0, 8).map((point) => {
    const results = evaluatePoint(inputs, geometry, point);
    const notEvaluated = results.filter((r) => r.status === "NOT_EVALUATED" || r.status === "UNKNOWN");
    const expert = results.filter((r) => r.status === "EXPERT_REQUIRED");
    const confidence: SolverConfidence =
      expert.length > 0 ? "EXPERT_REVIEW_REQUIRED" : notEvaluated.length > 0 ? "ASSUMPTION_SENSITIVE" : "VERIFIED_WITHIN_MODED_SCOPE";
    const professionalQuestions = [
      ...expert.map((r) => r.explanation),
      ...notEvaluated.map((r) => r.explanation),
    ];
    return { point, label: null, results, confidence, professionalQuestions };
  });
  if (scenarios.length > 0) scenarios[0].label = "HOUSING MAX";
  if (scenarios.length > 1) scenarios[1].label = "MISSION BALANCE";
  if (scenarios.length > 2) scenarios[2].label = "LOW CHANGE";

  return {
    status: "SOLVED",
    inputs,
    geometry,
    legalDensityCeiling: legal,
    massingCeiling,
    physicalSiteCeiling,
    overallCeiling,
    scenarios,
    frontier,
  };
}

function noSolution(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  legal: number | null,
  requestedTarget: number,
  maxFeasible: number,
  explanationInputs: string[],
): SolveNoSolution {
  return {
    status: "NO_VERIFIED_SOLUTION",
    requestedTarget,
    maxFeasibleHomes: maxFeasible,
    binding: [],
    counterfactuals: explanationInputs,
    nearestAlternatives: [],
    inputs,
    geometry,
    ceilings: {
      legalDensity: legal,
      massing: 0,
      physicalSite: 0,
      overall: 0,
    },
    explanationInputs,
  };
}

function noSolutionFromFrontier(
  inputs: SolverInputs,
  geometry: SiteGeometry,
  legal: number | null,
  target: number,
  best: number,
  frontier: CandidatePoint[],
): SolveNoSolution {
  const binding = proveBinding(inputs, geometry, legal);
  const counterfactuals = binding.map((proof) =>
    proof.missionLocked
      ? `Changing locked mission rule ${proof.humanLabel} (${proof.currentLimit} → ${proof.relaxedLimit} ${proof.unit}) would raise attainable homes by ${proof.capacityDelta}, but Acrevia did not use that alternative.`
      : `Relaxing ${proof.humanLabel} from ${proof.currentLimit} to ${proof.relaxedLimit} ${proof.unit} would raise attainable homes by ${proof.capacityDelta}.`,
  );
  return {
    status: "NO_VERIFIED_SOLUTION",
    requestedTarget: target,
    maxFeasibleHomes: best,
    binding,
    counterfactuals,
    nearestAlternatives: frontier.slice(0, 3),
    inputs,
    geometry,
    ceilings: {
      legalDensity: legal,
      massing: maxHomesWith(geometry.developableFootprintMaxSqFt, geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, null),
      physicalSite: maxHomesWith(geometry.developableFootprintMaxSqFt, geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, null),
      overall: legal === null ? best : Math.min(best, legal),
    },
    explanationInputs: [
      `Zoning tiered density supports ${legal ?? "—"} homes on this parcel.`,
      `Building massing (footprint × floors ÷ ${inputs.assumptions.residentialGrossPerUnit} sq ft/unit) supports ${maxHomesWith(geometry.developableFootprintMaxSqFt, geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, null)}.`,
      `Mission/site reservations (sanctuary ${Math.round(geometry.preservedStructureAreaSqFt)} sq ft preserved, ${geometry.parkingStallsRequired} parking stalls × ${inputs.assumptions.parkingStallGrossLandArea} sq ft) reduce the buildable envelope.`,
    ],
  };
}

/** Mechanical binding proof: relax one bound, re-solve, measure Δ homes. */
function proveBinding(inputs: SolverInputs, geometry: SiteGeometry, legal: number | null): BindingProof[] {
  const proofs: BindingProof[] = [];
  const base = maxHomesWith(geometry.developableFootprintMaxSqFt, geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, legal);
  const missionIds = new Set(inputs.missions.map((m) => m.id));

  // Law: occupied-area ceiling (+5 percentage points).
  const oaPct = geometry.occupiedAreaCeilingPct;
  const oaRelaxedRoom = ((oaPct + 5) / 100) * geometry.parcelAreaSqFt - geometry.preservedStructureAreaSqFt;
  pushProof(proofs, {
    constraintKey: "law:occupied-area",
    humanLabel: "Occupied area ceiling",
    source: "law",
    currentLimit: oaPct,
    relaxedLimit: oaPct + 5,
    capacityBefore: base,
    capacityAfter: maxHomesWith(Math.min(geometry.physicalLandRoomSqFt, oaRelaxedRoom), geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, legal),
    unit: "% of lot",
    explanation: "Structures above grade may cover at most this share of the lot (adopted code).",
    missionLocked: false,
  });

  // Law: height ceiling (+10 ft).
  const floorsRelaxed = Math.floor((geometry.heightCeilingFt + 10) / inputs.assumptions.storyFloorToFloorFt);
  pushProof(proofs, {
    constraintKey: "law:height",
    humanLabel: "Height ceiling",
    source: "law",
    currentLimit: geometry.heightCeilingFt,
    relaxedLimit: geometry.heightCeilingFt + 10,
    capacityBefore: base,
    capacityAfter: maxHomesWith(geometry.developableFootprintMaxSqFt, Math.min(floorsRelaxed, geometry.maxStoriesCap), inputs.assumptions.residentialGrossPerUnit, legal),
    unit: "ft",
    explanation: "Taller buildings allow more floors at the same footprint.",
    missionLocked: false,
  });

  // Mission: min-parking (-20 stalls, never offered as an alternative).
  const parkingRelieved = Math.max(0, geometry.parkingStallsRequired - 20);
  const parkingRelievedLand = parkingRelieved * inputs.assumptions.parkingStallGrossLandArea;
  const physicalRelieved = Math.max(0, geometry.parcelAreaSqFt - geometry.preservedStructureAreaSqFt - parkingRelievedLand);
  const missionParking = inputs.missions.find((m) => m.normalized.type === "min-parking");
  pushProof(proofs, {
    constraintKey: missionParking ? missionParking.id : "mission:min-parking",
    humanLabel: "Sunday parking minimum (mission)",
    source: "mission",
    currentLimit: geometry.parkingStallsRequired,
    relaxedLimit: parkingRelieved,
    capacityBefore: base,
    capacityAfter: maxHomesWith(Math.min(physicalRelieved, geometry.occupiedRoomSqFt), geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, legal),
    unit: "spaces",
    explanation: "USER_DECLARED mission rule — relaxing it frees surface-parking land.",
    missionLocked: missionIds.has(missionParking?.id ?? "") || missionParking !== undefined,
  });

  // Mission: preserve-structure (removing preservation — mission-locked).
  const physicalNoPreserve = Math.max(0, geometry.parcelAreaSqFt - geometry.parkingLandAreaSqFt);
  const preserveMission = inputs.missions.find((m) => m.normalized.type === "preserve-structure");
  pushProof(proofs, {
    constraintKey: preserveMission ? preserveMission.id : "mission:preserve-structure",
    humanLabel: "Sanctuary preservation (mission)",
    source: "mission",
    currentLimit: Math.round(geometry.preservedStructureAreaSqFt),
    relaxedLimit: 0,
    capacityBefore: base,
    capacityAfter: maxHomesWith(Math.min(physicalNoPreserve, geometry.occupiedAreaCeilingSqFt), geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit, legal),
    unit: "sq ft preserved",
    explanation: "USER_DECLARED mission rule — Acrevia never proposes demolishing the sanctuary.",
    missionLocked: preserveMission !== undefined,
  });

  // Assumption: gross-per-unit (−200 sq ft).
  pushProof(proofs, {
    constraintKey: "assumption:residential-gross-per-unit",
    humanLabel: "Gross area per unit (assumption)",
    source: "assumption",
    currentLimit: inputs.assumptions.residentialGrossPerUnit,
    relaxedLimit: inputs.assumptions.residentialGrossPerUnit - 200,
    capacityBefore: base,
    capacityAfter: maxHomesWith(geometry.developableFootprintMaxSqFt, geometry.floorsCap, inputs.assumptions.residentialGrossPerUnit - 200, legal),
    unit: "sq ft/unit",
    explanation: "Assumption-sensitive, not legal: a smaller unit program changes capacity.",
    missionLocked: false,
  });

  return proofs;
}

function pushProof(
  list: BindingProof[],
  draft: Omit<BindingProof, "capacityDelta">,
): void {
  const delta = draft.capacityAfter - draft.capacityBefore;
  if (delta <= 0) return; // only constraints whose relaxation changes capacity bind
  list.push({ ...draft, capacityDelta: delta });
}

function evaluatePoint(inputs: SolverInputs, geometry: SiteGeometry, point: CandidatePoint): EvaluatedConstraint[] {
  const results: EvaluatedConstraint[] = [];
  const occupiedActual = geometry.preservedStructureAreaSqFt + point.footprintSqFt;

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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1 (turf geodesic areas)",
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
            method: "solver/enumerator v1",
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
            method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
          lockable: "law",
        });
        break;
      }
      case "use-permission": {
        results.push({
          constraintKey: constraint.id,
          humanLabel: `${constraint.use} use permission`,
          source: "law",
          constraintId: constraint.id,
          status: constraint.permission === "BY_RIGHT" ? "SATISFIED" : constraint.permission === "SPECIAL_EXCEPTION" ? "EXPERT_REQUIRED" : "VIOLATED",
          explanation: `${constraint.use} is ${constraint.permission.replace(/_/g, " ").toLowerCase()} in RM-1.`,
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1 (turf geodesic area)",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
          method: "solver/enumerator v1",
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
    method: "solver/enumerator v1 (@turf/buffer, feet units)",
  });
  results.push({
    constraintKey: "assumption:site-land-consumption",
    humanLabel: "Site land consumption (parking + structures)",
    source: "assumption",
    status: point.footprintSqFt + geometry.parkingLandAreaSqFt + geometry.preservedStructureAreaSqFt <= geometry.parcelAreaSqFt ? "SATISFIED" : "VIOLATED",
    actual: Math.round(point.footprintSqFt + geometry.parkingLandAreaSqFt + geometry.preservedStructureAreaSqFt),
    actualUnit: "sq_ft",
    limit: Math.round(geometry.parcelAreaSqFt),
    limitUnit: "sq_ft",
    margin: Math.round(geometry.parcelAreaSqFt - point.footprintSqFt - geometry.parkingLandAreaSqFt - geometry.preservedStructureAreaSqFt),
    explanation: `Sanctuary + new building + ${geometry.parkingStallsRequired} surface stalls × ${inputs.assumptions.parkingStallGrossLandArea} sq ft (assumption) must fit the parcel. Land consumption, distinct from the occupied-area ceiling.`,
    method: "solver/enumerator v1",
  });

  return results;
}
