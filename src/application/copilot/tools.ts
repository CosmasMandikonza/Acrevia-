import { z } from "zod";
import type { MissionNormalized } from "../../domain/constraints/mission";
import { MissionNormalizedChecked } from "../../domain/constraints/mission";
import {
  solve,
  type ModeledCeilings,
  type BindingProof,
} from "../solver/solve";
import type { TrustedProofContext } from "../proof/trusted-context";
import type { MissionCommandLog } from "../mission/rebuild";
import type { CopilotToolSpec } from "../../adapters/ai/copilot-provider";

/**
 * Copilot typed tools (issue #10).
 *
 * Eight GENERIC tools over the rebuilt trusted project state. The model may
 * interpret intent and pick tools/arguments; it can never bypass them:
 *
 *  - every read returns server-derived state (Proof projection + deterministic
 *    solver output), never model arithmetic;
 *  - the only mutation-shaped tool (`propose_mission_change`) PROPOSES. It
 *    mutates nothing; the user confirms in the UI and the CLIENT appends a
 *    command to the existing mission log, which the existing
 *    POST /api/mission/state boundary replays. There is deliberately no
 *    `apply_*` tool — an AI turn must never itself change project state;
 *  - no tool can edit law, assumptions, or certificates. Law enters only via
 *    the regulatory compiler inside the trusted rebuild.
 */

export type CopilotToolContext = {
  /** The trusted rebuild (already: verified pair → law compiled → missions replayed → solved → recorded). */
  trusted: Extract<TrustedProofContext, { status: "ready" }>;
  /** The client-held mission command log that was replayed into `trusted`. */
  commands: MissionCommandLog;
};

export type CopilotToolResult =
  { ok: true; result: unknown; summary: string } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Shared projections (all values derive from trusted state)
// ---------------------------------------------------------------------------

type MissionView = {
  id: string;
  type: string;
  summary: string;
  hardOrSoft: string;
  revision: number;
};

function confirmedMissions(ctx: CopilotToolContext): MissionView[] {
  return Object.values(ctx.trusted.project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .filter((node) => node.confirmationState === "CONFIRMED")
    .map((node) => ({
      id: node.id,
      type: node.normalized.type,
      summary: missionSummary(node.normalized),
      hardOrSoft: node.hardOrSoft,
      revision: node.meta.revision,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function missionSummary(normalized: MissionNormalized): string {
  switch (normalized.type) {
    case "min-parking":
      return `at least ${normalized.spaces.value} Sunday parking spaces`;
    case "preserve-structure":
      return `preserve structure ${normalized.structureId}`;
    case "max-stories":
      return `at most ${normalized.stories.value} stories`;
    case "retain-ownership":
      return "congregation retains land ownership";
    case "max-height":
      return `no taller than ${normalized.limit.value} ft`;
  }
}

/** Deterministic canonical slot ids — mirrors the Mission Compiler parser scheme. */
function canonicalMissionId(normalized: MissionNormalized): string {
  switch (normalized.type) {
    case "min-parking":
      return "mission:min-sunday-parking";
    case "retain-ownership":
      return "mission:retain-ownership";
    case "max-height":
      return "mission:max-height";
    case "max-stories":
      return "mission:max-stories";
    case "preserve-structure":
      return `mission:preserve:${normalized.structureId}`;
  }
}

/** The existing confirmed rule occupying the same semantic slot, if any. */
function existingMissionFor(
  ctx: CopilotToolContext,
  normalized: MissionNormalized,
): { id: string; normalized: MissionNormalized } | null {
  const sameSlot = Object.values(ctx.trusted.project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .filter((node) => node.confirmationState === "CONFIRMED")
    .find((node) => {
      const existingNorm = node.normalized;
      if (existingNorm.type !== normalized.type) return false;
      if (
        normalized.type === "preserve-structure" &&
        existingNorm.type === "preserve-structure"
      ) {
        return existingNorm.structureId === normalized.structureId;
      }
      return true;
    });
  if (!sameSlot) return null;
  return { id: sameSlot.id, normalized: sameSlot.normalized };
}

function structuresWithNames(
  ctx: CopilotToolContext,
): Array<{ id: string; name?: string }> {
  const sessionStructures = ctx.trusted.session.parcelContexts.flatMap(
    (context) => context.structures,
  );
  return Object.values(ctx.trusted.project.nodes)
    .filter((node) => node.kind === "structure")
    .map((node) => ({
      id: node.id,
      name: sessionStructures.find(
        (s) => `gis:structure:${s.structureId}` === node.id,
      )?.buildingName,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

type ScenarioRow = {
  label: string;
  homes: number;
  parkingStalls: number;
  parkingMargin: number;
  footprintSqFt: number;
  floors: number;
  confidence: string;
  certificate: {
    scenarioId: string;
    certificateId: string;
    freshness: string;
  } | null;
};

function scenarioRows(ctx: CopilotToolContext): ScenarioRow[] {
  const solveResult = ctx.trusted.solve;
  return solveResult.scenarios.map((scenario, index) => ({
    label: scenario.label ?? `SCENARIO ${index + 1}`,
    homes: scenario.point.homes,
    parkingStalls: scenario.point.parkingStalls,
    parkingMargin: scenario.point.parkingMargin,
    footprintSqFt: Math.round(scenario.point.footprintSqFt),
    floors: scenario.point.floors,
    confidence: scenario.confidence,
    certificate: ctx.trusted.recorded[index]
      ? {
          scenarioId: ctx.trusted.recorded[index].scenarioId,
          certificateId: ctx.trusted.recorded[index].certificateId,
          freshness: ctx.trusted.recorded[index].freshness,
        }
      : null,
  }));
}

function ceilingsOf(solveResult: { ceilings: ModeledCeilings }) {
  return {
    legalDensity: solveResult.ceilings.legalDensity,
    massing: solveResult.ceilings.massing,
    physicalSiteAreaBudget: solveResult.ceilings.physicalSiteAreaBudget,
    overall: solveResult.ceilings.overall,
    note: "Three modeled ceilings computed independently; overall is their minimum. Area arithmetic does not prove physical placement — spatial packing and unresolved setbacks can only lower the realizable result.",
  };
}

function certificateFreshnessReasons(
  ctx: CopilotToolContext,
  certificateId: string,
): string[] {
  return (
    ctx.trusted.snapshot.certificates.find((row) => row.id === certificateId)
      ?.freshnessReasons ?? []
  );
}

// ---------------------------------------------------------------------------
// Tool input schemas (the model-facing typed surface)
// ---------------------------------------------------------------------------

const GetProjectContextInput = z.object({}).strict();

const QueryScenariosInput = z
  .object({
    /**
     * The ONLY ownership condition Acrevia can verify: a confirmed
     * retain-ownership mission rule. Deliberately `literal(true)` — there is
     * no way to ask for "does not keep ownership", because ownership
     * disposition is not modeled as a scenario dimension and absence of the
     * mission rule must never be read as sale/transfer.
     */
    requiresOwnershipRetention: z.literal(true).optional(),
    minHomes: z.number().int().min(0).optional(),
    maxHomes: z.number().int().min(0).optional(),
    minParking: z.number().int().min(0).optional(),
    maxParking: z.number().int().min(0).optional(),
  })
  .strict();

const InspectScenarioInput = z
  .object({
    label: z.enum(["HOUSING MAX", "MISSION BALANCE", "LOW CHANGE"]),
  })
  .strict();

const ExplainFeasibilityInput = z
  .object({
    targetHomes: z.number().int().min(0).optional(),
  })
  .strict();

const InspectAssumptionsInput = z.object({}).strict();

const InspectChangeHistoryInput = z
  .object({
    /** A certificate id the user is looking at (e.g. from an older view); the tool reports honestly whether the current rebuild still reproduces it. */
    certificateId: z.string().min(1).optional(),
  })
  .strict();

const ProposeMissionChangeInput = z
  .object({
    missionType: z.enum([
      "min-parking",
      "preserve-structure",
      "max-stories",
      "retain-ownership",
      "max-height",
    ]),
    /** spaces (min-parking), stories (max-stories), or feet (max-height). */
    value: z.number().int().min(1).optional(),
    /** Canonical graph node id (gis:structure:<id>) for preserve-structure. */
    structureId: z.string().min(1).optional(),
    intentText: z.string().min(1).max(400),
    hardOrSoft: z.enum(["hard", "soft"]).optional(),
  })
  .strict();

const PrepareBoardContextInput = z
  .object({
    scenarioLabel: z
      .enum(["HOUSING MAX", "MISSION BALANCE", "LOW CHANGE"])
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

function getProjectContext(ctx: CopilotToolContext): unknown {
  const snapshot = ctx.trusted.snapshot;
  const stale = snapshot.certificates.filter(
    (c) => c.freshness !== "CURRENT",
  ).length;
  return {
    property: {
      address: snapshot.identity.matchedAddress ?? snapshot.identity.query,
      district: snapshot.identity.district,
      overlay: snapshot.identity.overlay ?? null,
      parcelNodeId: snapshot.identity.parcelNodeId,
    },
    missions: confirmedMissions(ctx).map((mission) => ({
      id: mission.id,
      type: mission.type,
      summary: mission.summary,
      hardOrSoft: mission.hardOrSoft,
    })),
    modeledUpperBoundHomes: ctx.trusted.solve.modeledUpperBoundHomes,
    ceilings: ceilingsOf(ctx.trusted.solve),
    scenarios: scenarioRows(ctx),
    structures: structuresWithNames(ctx),
    openItems: {
      assumptions: snapshot.assumptions.filter((a) => a.active).length,
      conflicts: snapshot.conflicts.length,
      expertReviews: snapshot.expertReviews.filter(
        (r) => r.reviewStatus === "OPEN",
      ).length,
      staleCertificates: stale,
    },
  };
}

function queryScenarios(
  ctx: CopilotToolContext,
  input: z.infer<typeof QueryScenariosInput>,
): unknown {
  const rows = scenarioRows(ctx);
  const ownership = confirmedMissions(ctx).find(
    (mission) => mission.type === "retain-ownership",
  );
  const notes: string[] = [];
  let matches = rows.filter((row) => {
    if (input.minHomes !== undefined && row.homes < input.minHomes)
      return false;
    if (input.maxHomes !== undefined && row.homes > input.maxHomes)
      return false;
    if (input.minParking !== undefined && row.parkingStalls < input.minParking)
      return false;
    if (input.maxParking !== undefined && row.parkingStalls > input.maxParking)
      return false;
    return true;
  });
  if (input.requiresOwnershipRetention) {
    if (ownership) {
      notes.push(
        `The confirmed mission rule "${ownership.summary}" applies to every current scenario — all are computed with the congregation retaining land ownership.`,
      );
    } else {
      matches = [];
      notes.push(
        "No retain-ownership mission rule is currently confirmed, so no current scenario guarantees ownership retention. Confirming the ownership mission requires a user-confirmed mission change. Acrevia cannot prove the opposite either — ownership disposition (sale, transfer, lease structures) is not modeled as a scenario dimension, so no scenario can be presented as a non-retention/sale option.",
      );
    }
  }
  const parkingMission = confirmedMissions(ctx).find(
    (mission) => mission.type === "min-parking",
  );
  return {
    filter: input,
    matches,
    matchCount: matches.length,
    ownershipMission: ownership
      ? { present: true, summary: ownership.summary }
      : { present: false },
    missionParkingMinimum: parkingMission ? parkingMission.summary : null,
    notes,
  };
}

function inspectScenario(
  ctx: CopilotToolContext,
  input: z.infer<typeof InspectScenarioInput>,
): unknown {
  const index = ctx.trusted.solve.scenarios.findIndex(
    (scenario) => (scenario.label ?? "") === input.label,
  );
  if (index < 0) {
    return {
      error: `No scenario labeled ${input.label} exists in the current solve.`,
    };
  }
  const scenario = ctx.trusted.solve.scenarios[index];
  const row = scenarioRows(ctx)[index];
  const certificate = row.certificate;
  return {
    label: input.label,
    homes: scenario.point.homes,
    parkingStalls: scenario.point.parkingStalls,
    parkingMargin: scenario.point.parkingMargin,
    footprintSqFt: Math.round(scenario.point.footprintSqFt),
    floors: scenario.point.floors,
    confidence: scenario.confidence,
    professionalQuestions: scenario.professionalQuestions,
    certificate: certificate
      ? {
          ...certificate,
          freshnessReasons: certificateFreshnessReasons(
            ctx,
            certificate.certificateId,
          ),
        }
      : null,
    constraintResults: scenario.results.map((result) => ({
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
    })),
    assumptions: ctx.trusted.snapshot.assumptions
      .filter((assumption) => assumption.active)
      .map((assumption) => ({
        statement: assumption.statement,
        value: assumption.valueSummary,
        rationale: assumption.rationale,
      })),
  };
}

function bindingRows(binding: BindingProof[]) {
  return binding.map((proof) => ({
    constraint: proof.humanLabel,
    source: proof.source,
    currentLimit: proof.currentLimit,
    relaxedLimit: proof.relaxedLimit,
    capacityBefore: proof.capacityBefore,
    capacityAfter: proof.capacityAfter,
    capacityDeltaHomes: proof.capacityDelta,
    unit: proof.unit,
    explanation: proof.explanation,
    missionLocked: proof.missionLocked,
  }));
}

function explainFeasibility(
  ctx: CopilotToolContext,
  input: z.infer<typeof ExplainFeasibilityInput>,
): unknown {
  const current = ctx.trusted.solve;
  if (input.targetHomes === undefined) {
    return {
      outcome: "current-modeled-picture",
      modeledUpperBoundHomes: current.modeledUpperBoundHomes,
      ceilings: ceilingsOf(current),
      scenarios: scenarioRows(ctx),
      note: "The modeled upper bound is an area-arithmetic ceiling, not a claim of physical placement or approval.",
    };
  }
  // A fresh deterministic solve at the requested target — the tool, never the
  // model, decides whether the target is attainable.
  const result = solve(ctx.trusted.project, { targetHomes: input.targetHomes });
  if (result.status === "SOLVED") {
    const target = input.targetHomes;
    const meeting = result.scenarios
      .filter((scenario) => scenario.point.homes >= target)
      .map((scenario) => ({
        label: scenario.label,
        homes: scenario.point.homes,
        parkingStalls: scenario.point.parkingStalls,
        floors: scenario.point.floors,
        confidence: scenario.confidence,
      }));
    return {
      outcome: "verified-solution",
      targetHomes: input.targetHomes,
      modeledUpperBoundHomes: result.modeledUpperBoundHomes,
      ceilings: ceilingsOf(result),
      scenariosMeetingTarget: meeting,
      note: "The deterministic solver verified this target within the modeled scope. Placement (parking layout) may still be PARTIAL or UNRESOLVED in the spatial model.",
    };
  }
  return {
    outcome: "no-verified-solution",
    targetHomes: result.requestedTarget,
    modeledUpperBoundHomes: result.modeledUpperBoundHomes,
    ceilings: ceilingsOf(result),
    explanation: result.explanationInputs.join(" "),
    bindingConstraints: bindingRows(result.binding),
    counterfactuals: result.counterfactuals,
    nearestAlternatives: result.nearestAlternatives.map((alt) => ({
      homes: alt.homes,
      parkingStalls: alt.parkingStalls,
      parkingMargin: alt.parkingMargin,
      footprintSqFt: Math.round(alt.footprintSqFt),
      floors: alt.floors,
    })),
    note: "The deterministic solver refused this target. This refusal cannot be overridden by the Copilot; see bindingConstraints for what each limit is worth.",
  };
}

function inspectAssumptions(ctx: CopilotToolContext): unknown {
  const snapshot = ctx.trusted.snapshot;
  return {
    assumptions: snapshot.assumptions.map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      value: assumption.valueSummary,
      rationale: assumption.rationale,
      active: assumption.active,
      reviewTrigger: assumption.reviewTrigger ?? null,
      state: assumption.active ? "ASSUMPTION" : "STALE",
    })),
    expertReviews: snapshot.expertReviews.map((review) => ({
      question: review.question,
      whyItMatters: review.whyItMatters,
      category: review.category,
      severity: review.severity,
      reviewStatus: review.reviewStatus,
      state: "EXPERT REQUIRED",
    })),
    conflicts: snapshot.conflicts.map((conflict) => ({
      predicate: conflict.predicate,
      resolution: conflict.resolution,
      explanation: conflict.explanation,
      members: conflict.members.map((member) => ({
        sourceRef: member.sourceRef,
        authority: member.authority,
        valueSummary: member.valueSummary,
      })),
      state: "CONFLICT",
    })),
    computationQuestions: snapshot.computationQuestions.map((question) => ({
      scenarioId: question.scenarioId,
      label: question.label,
      status: question.status,
      explanation: question.explanation,
    })),
    note: "ASSUMPTION values are modeling inputs, not law. EXPERT REQUIRED items must be resolved by a qualified professional. CONFLICT items suspend the affected rule until a human verifies the source.",
  };
}

function inspectChangeHistory(
  ctx: CopilotToolContext,
  input: z.infer<typeof InspectChangeHistoryInput>,
): unknown {
  const commands = ctx.commands.map((command, index) => ({
    index,
    kind: command.kind,
    id: command.kind === "confirm" ? command.input.id : command.input.id,
    declaredAt:
      command.kind === "confirm"
        ? (command.input.origin.declaredAt ?? null)
        : command.input.declaredAt,
    change:
      command.kind === "confirm"
        ? `confirm ${missionSummary(command.input.normalized)}`
        : `retract mission rule ${command.input.id}`,
  }));
  const certificates = ctx.trusted.snapshot.certificates.map((certificate) => ({
    certificateId: certificate.id,
    scenarioLabel:
      ctx.trusted.snapshot.scenarios.find(
        (s) => s.certificateId === certificate.id,
      )?.label ?? null,
    freshness: certificate.freshness,
    freshnessReasons: certificate.freshnessReasons,
    generatedAt: certificate.generatedAt,
  }));
  // Honest verdict for a user-held certificate id: current ONLY when this
  // deterministic rebuild reproduces exactly that id (same stateless rule as
  // the Proof projection — never claim which field changed, never promote).
  const requested =
    typeof (input as { certificateId?: string }).certificateId === "string"
      ? (() => {
          const requestedId = (input as { certificateId: string })
            .certificateId;
          const reproduced = certificates.some(
            (certificate) =>
              certificate.certificateId === requestedId &&
              certificate.freshness === "CURRENT",
          );
          return {
            requestedId,
            current: reproduced,
            note: reproduced
              ? "The current rebuild reproduces this exact certificate — it is CURRENT."
              : "This certificate is not reproduced by the current rebuild; treat it as history. Acrevia will not claim which input changed or promote it to CURRENT.",
          };
        })()
      : undefined;
  return {
    missionCommandsSinceAcceptance: commands,
    confirmedMissions: confirmedMissions(ctx).map((mission) => ({
      id: mission.id,
      summary: mission.summary,
      revision: mission.revision,
    })),
    certificates,
    ...(requested ? { requestedCertificate: requested } : {}),
    note:
      commands.length === 0
        ? "No mission changes are recorded since this property was accepted, and Acrevia keeps no other historical versions — there is nothing to compare yet."
        : "Mission changes above replayed through the typed command boundary; certificate freshness reflects the current dependency closure (STALE/INVALIDATED certificates remain inspectable as history).",
  };
}

function proposeMissionChange(
  ctx: CopilotToolContext,
  input: z.infer<typeof ProposeMissionChangeInput>,
): { error: string } | unknown {
  // Build the typed normalized rule — domain schema decides validity, so a
  // bad quantity or foreign structure id is rejected here, never sanitized.
  let normalized: MissionNormalized;
  switch (input.missionType) {
    case "min-parking":
      if (input.value === undefined) {
        return {
          error:
            "min-parking requires `value` (number of Sunday parking spaces).",
        };
      }
      normalized = {
        type: "min-parking",
        spaces: { value: input.value, unit: "spaces" },
      };
      break;
    case "max-stories":
      if (input.value === undefined) {
        return {
          error: "max-stories requires `value` (whole number of stories).",
        };
      }
      normalized = {
        type: "max-stories",
        stories: { value: input.value, unit: "stories" },
      };
      break;
    case "max-height":
      if (input.value === undefined) {
        return { error: "max-height requires `value` (feet)." };
      }
      normalized = {
        type: "max-height",
        limit: { value: input.value, unit: "ft" },
      };
      break;
    case "retain-ownership":
      normalized = { type: "retain-ownership" };
      break;
    case "preserve-structure": {
      if (!input.structureId) {
        return {
          error:
            "preserve-structure requires `structureId` (a gis:structure:<id> node id).",
        };
      }
      const structure = structuresWithNames(ctx).find(
        (s) => s.id === input.structureId,
      );
      if (!structure) {
        return {
          error: `structureId ${input.structureId} is not a resolved structure on this property. Available: ${structuresWithNames(
            ctx,
          )
            .map((s) => s.id)
            .join(", ")}`,
        };
      }
      normalized = {
        type: "preserve-structure",
        structureId: input.structureId,
      };
      break;
    }
  }
  const checked = MissionNormalizedChecked.safeParse(normalized);
  if (!checked.success) {
    return {
      error: checked.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  const hardOrSoft = input.hardOrSoft ?? "hard";
  const existing = existingMissionFor(ctx, checked.data);
  return {
    proposal: {
      proposalId: existing ? existing.id : canonicalMissionId(checked.data),
      label: labelFor(checked.data.type),
      detail: missionSummary(checked.data),
      intentText: input.intentText,
      normalized: checked.data,
      hardOrSoft,
    },
    current: existing
      ? { id: existing.id, summary: missionSummary(existing.normalized) }
      : null,
    confirmationRequired: true,
    note: "Nothing has changed yet. The user must explicitly confirm; only then does the standard mission command boundary apply the change (the Copilot never mutates project state itself).",
  };
}

function labelFor(type: MissionNormalized["type"]): string {
  switch (type) {
    case "min-parking":
      return "SUNDAY PARKING";
    case "preserve-structure":
      return "PRESERVE";
    case "max-stories":
      return "STORIES";
    case "retain-ownership":
      return "OWNERSHIP";
    case "max-height":
      return "HEIGHT";
  }
}

export const BOARD_BOUNDARY_NOTICE =
  "Acrevia produces preliminary, model-derived feasibility material. It is not legal certification, architectural approval, financing approval, or a permit. Final conclusions require qualified professionals.";

function prepareBoardContext(
  ctx: CopilotToolContext,
  input: z.infer<typeof PrepareBoardContextInput>,
): { error: string } | unknown {
  const label = input.scenarioLabel ?? "MISSION BALANCE";
  const index = ctx.trusted.solve.scenarios.findIndex(
    (scenario) => (scenario.label ?? "") === label,
  );
  if (index < 0) {
    return {
      error: `No scenario labeled ${label} exists in the current solve.`,
    };
  }
  const scenario = ctx.trusted.solve.scenarios[index];
  const row = scenarioRows(ctx)[index];
  const snapshot = ctx.trusted.snapshot;
  const blockingReviews = snapshot.expertReviews.filter(
    (review) =>
      review.severity === "blocking" && review.reviewStatus === "OPEN",
  );
  return {
    title: "Board brief — prepared from current verified Acrevia state",
    property: {
      address: snapshot.identity.matchedAddress ?? snapshot.identity.query,
      district: snapshot.identity.district,
      overlay: snapshot.identity.overlay ?? null,
      parcelNodeId: snapshot.identity.parcelNodeId,
    },
    selectedScenario: {
      label,
      homes: scenario.point.homes,
      parkingStalls: scenario.point.parkingStalls,
      parkingMargin: scenario.point.parkingMargin,
      floors: scenario.point.floors,
      confidence: scenario.confidence,
      certificate: row.certificate
        ? {
            ...row.certificate,
            freshnessReasons: certificateFreshnessReasons(
              ctx,
              row.certificate.certificateId,
            ),
          }
        : null,
      professionalQuestions: scenario.professionalQuestions,
      constraintResults: scenario.results.map((result) => ({
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
      })),
    },
    missionCommitments: confirmedMissions(ctx).map((mission) => ({
      summary: mission.summary,
      hardOrSoft: mission.hardOrSoft,
    })),
    modeledCeilings: ceilingsOf(ctx.trusted.solve),
    assumptions: snapshot.assumptions
      .filter((assumption) => assumption.active)
      .map((assumption) => ({
        statement: assumption.statement,
        value: assumption.valueSummary,
        rationale: assumption.rationale,
      })),
    conflicts: snapshot.conflicts.map((conflict) => ({
      predicate: conflict.predicate,
      explanation: conflict.explanation,
    })),
    expertReviews: snapshot.expertReviews.map((review) => ({
      question: review.question,
      category: review.category,
      severity: review.severity,
      reviewStatus: review.reviewStatus,
    })),
    blockingQuestionsForTheBoard: blockingReviews.map(
      (review) => review.question,
    ),
    boundaryNotice: BOARD_BOUNDARY_NOTICE,
    certificateWarning:
      row.certificate && row.certificate.freshness !== "CURRENT"
        ? `The certificate for this scenario is ${row.certificate.freshness}. Present it as history, not as a current verified result, until recompute.`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Registry + execution
// ---------------------------------------------------------------------------

export type CopilotToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute: (ctx: CopilotToolContext, input: unknown) => unknown;
};

export const COPILOT_TOOLS: CopilotToolDefinition[] = [
  {
    name: "get_project_context",
    description:
      "Current trusted project state: property identity, confirmed mission rules, modeled ceilings and upper bound, current scenarios with certificate freshness, resolved structures, and open items (assumptions/conflicts/expert reviews). Call this FIRST for any factual question about the project.",
    inputSchema: GetProjectContextInput,
    execute: (ctx) => getProjectContext(ctx),
  },
  {
    name: "query_scenarios",
    description:
      "Filter the CURRENT deterministic scenarios by typed criteria (homes/parking bounds; requiresOwnershipRetention=true restricts to scenarios computed under a confirmed retain-ownership mission rule — the only ownership condition Acrevia can verify). Returns real solver rows — never computes metrics itself. Use for 'which options/scenarios…' questions.",
    inputSchema: QueryScenariosInput,
    execute: (ctx, input) =>
      queryScenarios(ctx, input as z.infer<typeof QueryScenariosInput>),
  },
  {
    name: "inspect_scenario",
    description:
      "Full inspection of one current scenario: metrics, per-constraint results (actual vs limit, status, explanation), assumptions, certificate and its freshness reasons.",
    inputSchema: InspectScenarioInput,
    execute: (ctx, input) =>
      inspectScenario(ctx, input as z.infer<typeof InspectScenarioInput>),
  },
  {
    name: "explain_feasibility",
    description:
      "Deterministic feasibility verdict. With targetHomes, runs the real solver at that target: either a verified solution, or a refusal with binding constraints (missionLocked flags), counterfactuals, and nearest verified alternatives. Use for 'why can't N homes fit' and bypass attempts — the Copilot cannot override the verdict.",
    inputSchema: ExplainFeasibilityInput,
    execute: (ctx, input) =>
      explainFeasibility(ctx, input as z.infer<typeof ExplainFeasibilityInput>),
  },
  {
    name: "inspect_assumptions",
    description:
      "Assumptions (modeling inputs, not law), EXPERT REQUIRED review items, CONFLICT items, and unresolved computation questions, with their exact states. Use for 'what are we still assuming / what needs expert review'.",
    inputSchema: InspectAssumptionsInput,
    execute: (ctx) => inspectAssumptions(ctx),
  },
  {
    name: "inspect_change_history",
    description:
      "What actually changed since the property was accepted: the mission command history and every scenario certificate with its CURRENT/STALE/INVALIDATED freshness and drift reasons. Honest empty state when nothing is recorded — never fabricates history.",
    inputSchema: InspectChangeHistoryInput,
    execute: (ctx, input) =>
      inspectChangeHistory(
        ctx,
        input as z.infer<typeof InspectChangeHistoryInput>,
      ),
  },
  {
    name: "propose_mission_change",
    description:
      "Propose a typed mission-rule change (min-parking, preserve-structure, max-stories, retain-ownership, max-height). Returns a structured PROPOSAL with the current value; changes NOTHING until the user explicitly confirms in the UI. Use when the user states a mission priority or asks for a change.",
    inputSchema: ProposeMissionChangeInput,
    execute: (ctx, input) =>
      proposeMissionChange(
        ctx,
        input as z.infer<typeof ProposeMissionChangeInput>,
      ),
  },
  {
    name: "prepare_board_context",
    description:
      "Assemble the trusted structured context for a board/council brief: property, selected scenario with certificate state, mission commitments, constraints, assumptions, conflicts, expert-required questions, and the preliminary-use boundary. Every factual claim in the brief must come from this output.",
    inputSchema: PrepareBoardContextInput,
    execute: (ctx, input) =>
      prepareBoardContext(
        ctx,
        input as z.infer<typeof PrepareBoardContextInput>,
      ),
  },
];

export function copilotToolSpecs(): CopilotToolSpec[] {
  return COPILOT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema as z.ZodType, {
      target: "draft-7",
    }) as Record<string, unknown>,
  }));
}

/** Execute one model-requested tool call. Failures are honest typed errors. */
export function executeCopilotTool(
  ctx: CopilotToolContext,
  name: string,
  argsJson: string,
): CopilotToolResult {
  const tool = COPILOT_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return { ok: false, error: `unknown tool ${name}` };
  }
  let args: unknown;
  try {
    args =
      argsJson.trim().length === 0 ? {} : (JSON.parse(argsJson) as unknown);
  } catch {
    return { ok: false, error: `invalid JSON arguments for ${name}` };
  }
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: `${name} arguments rejected: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
    };
  }
  try {
    const result = tool.execute(ctx, parsed.data);
    // Executors flag domain-level failures as { error } objects without throwing.
    if (
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof (result as { error: unknown }).error === "string" &&
      Object.keys(result as Record<string, unknown>).length === 1
    ) {
      return { ok: false, error: (result as { error: string }).error };
    }
    return {
      ok: true,
      result,
      summary: summarizeToolResult(tool.name, result),
    };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error
          ? `${name} failed: ${cause.message}`
          : `${name} failed`,
    };
  }
}

function summarizeToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return name;
  const record = result as Record<string, unknown>;
  switch (name) {
    case "get_project_context": {
      const scenarios = Array.isArray(record.scenarios)
        ? record.scenarios.length
        : 0;
      return `project context: ${scenarios} current scenarios, upper bound ${String(record.modeledUpperBoundHomes)} homes`;
    }
    case "query_scenarios":
      return `scenario query: ${String(record.matchCount)} match(es)`;
    case "inspect_scenario":
      return `scenario detail: ${String(record.label)}`;
    case "explain_feasibility":
      return `feasibility: ${String(record.outcome)}${record.modeledUpperBoundHomes !== undefined ? ` (upper bound ${String(record.modeledUpperBoundHomes)} homes)` : ""}`;
    case "inspect_assumptions":
      return `assumptions: ${countOf(record.assumptions)} assumptions, ${countOf(record.expertReviews)} expert reviews, ${countOf(record.conflicts)} conflicts`;
    case "inspect_change_history":
      return `change history: ${countOf(record.missionCommandsSinceAcceptance)} mission command(s), ${countOf(record.certificates)} certificate(s)`;
    case "propose_mission_change":
      return "mission change proposed (awaits user confirmation; state unchanged)";
    case "prepare_board_context":
      return "board context assembled from verified state";
    default:
      return name;
  }
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
