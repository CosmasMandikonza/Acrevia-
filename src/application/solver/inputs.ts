import type { Project } from "../../domain/graph/project";
import { requireQuantityAssumption } from "./assumptions";
import { selectExecutableConstraints } from "../regulatory/executable";
import type { MissionConstraintView } from "../mission/rebuild";

/**
 * Solver truth boundary (issue #7): inputs are built ONLY from
 * selectExecutableConstraints(project), confirmed MissionConstraints,
 * accepted parcel/structure geometry, and explicit active Assumptions.
 * The solver never reaches around the Regulatory Compiler or Mission
 * Compiler; fail-closed typed refusals replace any silent default.
 */

export type SolverFailReason =
  | "STALE_REGULATORY_CONSTRAINT"
  | "NO_EXECUTABLE_CONSTRAINTS"
  | "MISSION_NOT_CONFIRMED"
  | "MISSING_GEOMETRY"
  | "INVALID_GEOMETRY"
  | "MISSING_ASSUMPTION"
  | "UNKNOWN_LAW"
  | "UNSUPPORTED_SEARCH";

export class SolveRefusal extends Error {
  constructor(
    readonly reason: SolverFailReason,
    message: string,
  ) {
    super(message);
    this.name = "SolveRefusal";
  }
}

export type ExecutableLaw = ReturnType<typeof selectExecutableConstraints>["executable"][number];
export type LawDecision = ReturnType<typeof selectExecutableConstraints>["decisions"][number];

export type MissionInput = {
  id: string;
  kind: "min-parking" | "preserve-structure" | "max-stories" | "retain-ownership" | "max-height";
  hardOrSoft: "hard" | "soft";
  normalized: MissionConstraintView["normalized"];
};

export type StructureInput = {
  structureId: string;
  graphId: string;
  footprintGeojson: unknown;
  computedAreaSqFt: number;
  preserved: boolean;
  buildingName?: string;
};

export type SolverInputs = {
  projectId: string;
  parcelId: string;
  parcelGeojson: unknown;
  law: ExecutableLaw[];
  lawDecisions: LawDecision[];
  missions: MissionInput[];
  structures: StructureInput[];
  assumptions: {
    residentialGrossPerUnit: number;
    parkingStallGrossLandArea: number;
    storyFloorToFloorFt: number;
    planningEnvelopeSetbackFt: number;
  };
  assumptionIds: string[];
};

type MissionNode = {
  id: string;
  kind: "mission-constraint";
  intentText: string;
  normalized: MissionConstraintView["normalized"];
  confirmationState: string;
  hardOrSoft: "hard" | "soft";
};

function structureFootprint(node: unknown): unknown | undefined {
  const candidate = (node as { footprint?: { geojson?: unknown } } | null)?.footprint?.geojson;
  return candidate;
}

export function buildSolverInputs(project: Project): SolverInputs {
  const gate = selectExecutableConstraints(project);
  const executableIds = new Set(gate.executable.map((c) => c.id));

  // Refuse when a law constraint the solver would consume is not executable.
  const consequentialKinds = new Set(["height", "occupied-area", "parking-requirement", "density"]);
  for (const decision of gate.decisions) {
    if (!executableIds.has(decision.constraintId)) {
      const constraint = project.nodes[decision.constraintId];
      const kind = constraint?.kind === "constraint" ? constraint.constraintKind : "";
      if (consequentialKinds.has(kind)) {
        throw new SolveRefusal(
          "STALE_REGULATORY_CONSTRAINT",
          `law constraint ${decision.constraintId} is not executable: ${decision.reasons.join("; ")}`,
        );
      }
    }
  }
  if (gate.executable.length === 0) {
    throw new SolveRefusal("NO_EXECUTABLE_CONSTRAINTS", "no executable regulatory constraints in project");
  }

  const missions: MissionInput[] = [];
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== "mission-constraint") continue;
    const mission = node as unknown as MissionNode;
    if (mission.confirmationState !== "CONFIRMED") continue; // only user-confirmed mission rules execute
    if (mission.hardOrSoft !== "hard") continue; // soft preferences inform ranking, not hard boundaries
    missions.push({
      id: mission.id,
      kind: mission.normalized.type,
      hardOrSoft: "hard",
      normalized: mission.normalized,
    });
  }

  const parcelEntry = Object.values(project.nodes).find((node) => node.kind === "parcel");
  if (!parcelEntry) throw new SolveRefusal("MISSING_GEOMETRY", "project has no parcel node");
  const parcelGeojson = (parcelEntry as unknown as { geometry: { geojson: unknown } }).geometry.geojson;
  if (!parcelGeojson) throw new SolveRefusal("MISSING_GEOMETRY", `parcel ${parcelEntry.id} has no geometry`);

  const preservedIds = new Set(
    missions
      .filter((m) => m.kind === "preserve-structure")
      .map((m) => (m.normalized.type === "preserve-structure" ? m.normalized.structureId : "")),
  );

  const structures: StructureInput[] = [];
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== "structure") continue;
    const footprint = structureFootprint(node);
    if (footprint) {
      structures.push({
        structureId: (node as unknown as { id: string }).id.split(":").pop() ?? (node as unknown as { id: string }).id,
        graphId: (node as unknown as { id: string }).id,
        footprintGeojson: footprint,
        computedAreaSqFt: Number.NaN, // computed in geometry.ts (turf)
        preserved: preservedIds.has((node as unknown as { id: string }).id),
        buildingName: (node as unknown as { notes?: string }).notes?.match(/BIN \d+/)?.[0],
      });
    }
  }
  const preserveMissions = missions.filter((m) => m.kind === "preserve-structure");
  for (const mission of preserveMissions) {
    if (mission.normalized.type === "preserve-structure") {
      const graphId = mission.normalized.structureId;
      const node = project.nodes[graphId];
      if (!node || node.kind !== "structure") {
        throw new SolveRefusal("MISSION_NOT_CONFIRMED", `preserved structure ${graphId} not in graph`);
      }
    }
  }

  const assumptionIds = [
    "assumption:residential-gross-per-unit",
    "assumption:parking-stall-gross-land-area",
    "assumption:story-floor-to-floor-height",
    "assumption:area-basis-computed-geodesic",
    "assumption:planning-envelope-uniform-setback",
  ];
  const assumptions = {
    residentialGrossPerUnit: requireQuantityAssumption(project, assumptionIds[0]),
    parkingStallGrossLandArea: requireQuantityAssumption(project, assumptionIds[1]),
    storyFloorToFloorFt: requireQuantityAssumption(project, assumptionIds[2]),
    planningEnvelopeSetbackFt: requireQuantityAssumption(project, assumptionIds[4]),
  };
  if (
    assumptions.residentialGrossPerUnit <= 0 ||
    assumptions.parkingStallGrossLandArea <= 0 ||
    assumptions.storyFloorToFloorFt <= 0
  ) {
    throw new SolveRefusal("MISSING_ASSUMPTION", "solver assumptions must be positive finite quantities");
  }

  return {
    projectId: project.projectId,
    parcelId: (parcelEntry as unknown as { id: string }).id,
    parcelGeojson,
    law: gate.executable,
    lawDecisions: gate.decisions,
    missions,
    structures,
    assumptions,
    assumptionIds,
  };
}
