import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapBenchmarkToProject } from "../../src/adapters/benchmarks";
import {
  confirmMissionConstraint,
  recordScenario,
  setAssumption,
  updateStakeholderView,
  type CommandContext,
} from "../../src/commands";
import type { Project } from "../../src/domain/graph/project";

export const PHILADELPHIA_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "benchmarks",
  "calvary-memorial-philadelphia",
);

/** Deterministic clock: every import produces identical timestamps. */
export const FIXED_NOW = "2026-10-04T13:00:00.000Z";

export function contextFor(project: Project, actor = "test", correlationId?: string): CommandContext {
  return { project, actor, correlationId, now: () => FIXED_NOW };
}

export function seedPhiladelphiaProject(): Project {
  return mapBenchmarkToProject({
    fixtureDir: PHILADELPHIA_FIXTURE_DIR,
    actor: "benchmark-adapter",
    now: () => FIXED_NOW,
  });
}

export const PARKING_CONSTRAINT_ID = "phl:constraint:parking-multifamily";
export const HEIGHT_CONSTRAINT_ID = "phl:constraint:height-max";
export const PARCEL_ID = "phl:parcel:778273000";
export const MISSION_PARKING_ID = "mission:min-sunday-parking";
export const SCENARIO_ID = "scenario:balance";
export const CERTIFICATE_ID = "scenario:balance:certificate";
export const VIEW_ID = "view:council-deck";

export function confirmMissionParking(project: Project, spaces: number): void {
  confirmMissionConstraint(contextFor(project), {
    id: MISSION_PARKING_ID,
    kind: "mission-constraint",
    intentText: `Keep at least ${spaces} Sunday parking spaces.`,
    normalized: { type: "min-parking", spaces: { value: spaces, unit: "spaces" } },
    origin: { kind: "USER_DECLARED", actorId: "board-chair", declaredAt: FIXED_NOW },
    confirmationState: "CONFIRMED",
    hardOrSoft: "hard",
  });
}

export function setAverageUnitSizeAssumption(project: Project, sqFt: number): void {
  setAssumption(contextFor(project), {
    id: "assumption:average-unit-size",
    kind: "assumption",
    statement: `Average gross unit size is ${sqFt} sq ft.`,
    value: { type: "quantity", quantity: { value: sqFt, unit: "sq_ft" } },
    rationale: "Early modeling input pending programming work.",
    origin: { kind: "MODELER_DECLARED", actorId: "modeler" },
    active: true,
    reviewTrigger: "before board package",
  });
}

export function recordBalanceScenario(
  project: Project,
  overrides: {
    scenarioId?: string;
    label?: string;
    homes?: number;
    certificateId?: string;
    /** Result ids are globally unique; a second scenario must not reuse the
     *  first scenario's base result ids (generated ids must be unused). */
    resultIdPrefix?: string;
    /** Mission dependencies of the scenario (issue #6 regression support). */
    missionIds?: string[];
  } = {},
): void {
  const scenarioId = overrides.scenarioId ?? SCENARIO_ID;
  recordScenario(contextFor(project), {
    scenarioId,
    label: overrides.label ?? "Balance",
    solverVersion: "test-double@0",
    status: "COMPUTED",
    metrics: [
      {
        metricId: "homes",
        label: "Homes",
        value: { value: overrides.homes ?? 34, unit: "dwelling_units" },
      },
    ],
    constraintIds: [PARKING_CONSTRAINT_ID, HEIGHT_CONSTRAINT_ID],
    missionIds: overrides.missionIds ?? [MISSION_PARKING_ID],
    assumptionIds: ["assumption:average-unit-size"],
    parcelId: PARCEL_ID,
    results: [
      {
        resultId: `${overrides.resultIdPrefix ?? ""}result:parking`,
        constraintId: PARKING_CONSTRAINT_ID,
        status: "SATISFIED",
        actual: { value: 0, unit: "spaces" },
        limit: { value: 0, unit: "spaces" },
        explanation: "Multi-family requires 0 spaces in RM-1 (Table 14-802-1, group 2).",
      },
      {
        resultId: `${overrides.resultIdPrefix ?? ""}result:height`,
        constraintId: HEIGHT_CONSTRAINT_ID,
        status: "SATISFIED",
        actual: { value: 38, unit: "ft" },
        limit: { value: 38, unit: "ft" },
        explanation: "Massing at the 38 ft RM-1 maximum.",
      },
    ],
    certificateId: overrides.certificateId ?? `${scenarioId}:certificate`,
  });
}

export function seedWithBalanceScenario(): Project {
  const project = seedPhiladelphiaProject();
  confirmMissionParking(project, 80);
  setAverageUnitSizeAssumption(project, 900);
  recordBalanceScenario(project);
  return project;
}

export function updateCouncilViewTitle(project: Project, title: string): void {
  updateStakeholderView(contextFor(project), {
    id: VIEW_ID,
    kind: "stakeholder-view",
    audience: "council",
    title,
    selectedScenarioId: SCENARIO_ID,
    narrativeNotes: "Presentation draft.",
    visibleEvidenceDepth: "standard",
  });
}
