import { setAssumption, type CommandContext } from "../../commands";

/**
 * Canonical solver planning assumptions (issue #7). Every planning constant
 * that materially changes capacity is an explicit Assumption node — never a
 * hidden constant in solver code. These are PLANNING ASSUMPTIONS, not legal
 * facts; every ScenarioCertificate pins them, and sensitivity tests prove
 * predictable capacity changes when they change.
 */

export const SOLVER_ASSUMPTIONS = [
  {
    id: "assumption:residential-gross-per-unit",
    statement: "Residential gross area per dwelling unit, including circulation and core.",
    value: { type: "quantity", quantity: { value: 1200, unit: "sq_ft_per_unit" } },
    rationale:
      "Massing-level planning constant for early capacity screening; program mix is not yet designed. Benchmark net values (900–950 sq ft) exclude circulation; gross is the honest massing number.",
    reviewTrigger: "program-mix confirmation before schematic design",
  },
  {
    id: "assumption:parking-stall-gross-land-area",
    statement: "Gross land area per retained surface parking stall, including aisles and circulation.",
    value: { type: "quantity", quantity: { value: 350, unit: "sq_ft" } },
    rationale:
      "Surface parking land consumption for site-capacity screening; includes stall plus its share of drive aisle.",
    reviewTrigger: "parking layout design",
  },
  {
    id: "assumption:story-floor-to-floor-height",
    statement: "Story floor-to-floor height used for floor-count massing against the height cap.",
    value: { type: "quantity", quantity: { value: 11, unit: "ft" } },
    rationale:
      "Conservative residential floor-to-floor dimension for massing only — not interior clear height.",
    reviewTrigger: "structural design",
  },
  {
    id: "assumption:area-basis-computed-geodesic",
    statement: "Geometric areas use computed geodesic values (turf/WGS84), not registry-recorded areas.",
    value: { type: "qualitative", text: "computed geodesic basis" },
    rationale:
      "Recorded registry area (119,295 sq ft) and computed geodesic area (119,173 sq ft) differ; capacity math uses computed geometry and records the choice explicitly. Recorded area is never recomputed over.",
    reviewTrigger: undefined,
  },
  {
    id: "assumption:planning-envelope-uniform-setback",
    statement:
      "Conceptual planning envelope uses a uniform assumed setback equal to the strictest numeric setback minimum (9 ft) buffered inward from the real parcel polygon. This is a massing concept only — it is NOT verified legal setback compliance.",
    value: { type: "quantity", quantity: { value: 9, unit: "ft" } },
    rationale:
      "Lot-line-specific front/side/rear roles are not classified in trusted state; legal setback ConstraintResults stay NOT_EVALUATED and this separately labeled envelope supports conceptual massing.",
    reviewTrigger: "surveyor lot-line classification",
  },
] as const;

export type SolverAssumptionIds = (typeof SOLVER_ASSUMPTIONS)[number]["id"];

/** Idempotently seed the canonical assumptions into a project. */
export function seedSolverAssumptions(ctx: CommandContext): void {
  for (const assumption of SOLVER_ASSUMPTIONS) {
    const existing = ctx.project.nodes[assumption.id];
    if (existing && existing.kind === "assumption") continue;
    if (existing) continue; // collision safety: never overwrite foreign nodes
    setAssumption(ctx, {
      id: assumption.id,
      kind: "assumption",
      statement: assumption.statement,
      value: assumption.value,
      rationale: assumption.rationale,
      origin: { kind: "MODELER_DECLARED", actorId: "solver-seed" },
      active: true,
      ...(assumption.reviewTrigger ? { reviewTrigger: assumption.reviewTrigger } : {}),
    });
  }
}

/** Read an active quantity assumption or fail closed. */
export function requireQuantityAssumption(
  project: Parameters<typeof setAssumption>[0]["project"],
  id: string,
): number {
  const node = project.nodes[id];
  if (!node || node.kind !== "assumption") {
    throw new Error(`solver assumption missing: ${id}`);
  }
  if (!node.active) {
    throw new Error(`solver assumption inactive: ${id}`);
  }
  if (node.value.type !== "quantity" || !Number.isFinite(node.value.quantity.value)) {
    throw new Error(`solver assumption ${id} is not a finite quantity`);
  }
  return node.value.quantity.value;
}
