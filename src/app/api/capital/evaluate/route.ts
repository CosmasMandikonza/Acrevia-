import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import { MissionCommandLog } from "../../../../application/mission/rebuild";
import { buildTrustedProofContext } from "../../../../application/proof/trusted-context";
import {
  capitalFingerprint,
  evaluateCapital,
  type CapitalScenarioFacts,
} from "../../../../application/capital/calculate";
import {
  CapitalAssumptionOverridesSchema,
  OwnershipPathwaySchema,
  PATHWAY_PRESETS,
  type CapitalAssumptionOverrides,
} from "../../../../application/capital/schema";

/**
 * POST /api/capital/evaluate — Preliminary Capital (issue #12).
 *
 * Capital is a VIEW over trusted scenario truth, exactly like Proof: this
 * route never authors a scenario. The accepted { envelope, receipt } pair is
 * verified, the committed base project rebuilt and hash-gated, law compiled,
 * the mission command log replayed, and the deterministic solver re-run —
 * all through the SAME trusted pipeline as /api/proof/snapshot
 * (buildTrustedProofContext). Capital then evaluates ONE recorded scenario
 * whose ScenarioCertificate must be part of the CURRENT rebuild; anything
 * else fails closed as stale.
 *
 * The calculation itself is the pure engine in application/capital:
 * deterministic, stateless, recomputed per request, fingerprinted over
 * scenario/certificate identity + engine version + pathway + normalized
 * assumptions. Nothing is persisted; there is no capital history to drift.
 */

export const dynamic = "force-dynamic";

type ScenarioSummary = {
  scenarioId: string;
  certificateId: string;
  label: string;
  homes: number;
  freshness: string;
};

import type { RecordedScenario } from "../../../../application/solver/record";
import type { Project } from "../../../../domain/graph/project";

function currentScenarioSummaries(
  recorded: RecordedScenario[],
  project: Project,
): ScenarioSummary[] {
  return recorded
    .map((entry) => {
      const node = project.nodes[entry.scenarioId];
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
    .filter((s): s is ScenarioSummary => s !== null);
}

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    receipt?: CommitReceipt;
    commands?: unknown;
    pathway?: unknown;
    scenarioId?: unknown;
    assumptions?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.envelope || !body.receipt || !Array.isArray(body.commands)) {
    return NextResponse.json(
      {
        error:
          "capital requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)",
      },
      { status: 400 },
    );
  }

  const pathway = OwnershipPathwaySchema.safeParse(body.pathway);
  if (!pathway.success) {
    return NextResponse.json(
      {
        error:
          "pathway must be one of: ground-lease, church-led, joint-development",
        name: "InvalidPathway",
      },
      { status: 400 },
    );
  }

  let commands: ReturnType<typeof MissionCommandLog.parse>;
  try {
    commands = MissionCommandLog.parse(body.commands);
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "malformed mission command log",
        name: "InvalidMissionCommandLog",
      },
      { status: 400 },
    );
  }

  let overrides: CapitalAssumptionOverrides = {};
  if (body.assumptions !== undefined && body.assumptions !== null) {
    const parsed = CapitalAssumptionOverridesSchema.safeParse(body.assumptions);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "assumptions must be a bounded subset of capital assumption keys: " +
            parsed.error.issues
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; "),
          name: "InvalidCapitalAssumptions",
        },
        { status: 400 },
      );
    }
    overrides = parsed.data;
  }

  if (body.scenarioId !== undefined && typeof body.scenarioId !== "string") {
    return NextResponse.json(
      { error: "scenarioId must be a string", name: "InvalidScenarioId" },
      { status: 400 },
    );
  }

  try {
    const context = await buildTrustedProofContext(
      body.envelope,
      body.receipt,
      commands,
      body.scenarioId === undefined ? {} : { scenarioId: body.scenarioId },
    );

    if (context.status !== "ready") {
      // Same fail-closed shapes as the solver route — capital never invents a
      // scenario to evaluate when no current trusted scenario exists.
      if (context.status === "multi-parcel-unsupported") {
        return NextResponse.json({
          status: "multi-parcel-unsupported",
          reason:
            "This accepted property has multiple confirmed parcels; per-parcel solving is required before capital can evaluate any scenario.",
        });
      }
      if (context.status === "unsupported-district") {
        return NextResponse.json({
          status: "unsupported-district",
          district: context.district,
          reason: context.reason,
        });
      }
      return NextResponse.json({
        status: "needs-evidence",
        reason: context.reason,
      });
    }

    const scenarios = currentScenarioSummaries(
      context.recorded,
      context.project,
    );

    // FAIL CLOSED on scenario identity: capital may only evaluate a scenario
    // the CURRENT deterministic rebuild just recorded with a CURRENT
    // certificate. A foreign or superseded id never falls back silently.
    const requestedId = body.scenarioId;
    const entry = requestedId
      ? context.recorded.find(
          (candidate) => candidate.scenarioId === requestedId,
        )
      : context.recorded[0];
    if (!entry) {
      return NextResponse.json({
        status: "stale-scenario",
        reason:
          "The requested scenario is not part of the current trusted rebuild (its certificate cannot be reproduced from the accepted property's current state). Capital never evaluates a scenario it cannot re-certify.",
        scenarios,
      });
    }
    if (entry.freshness !== "CURRENT") {
      return NextResponse.json({
        status: "stale-certificate",
        reason: `The scenario's certificate is ${entry.freshness}, not CURRENT. Re-run the solver surface to refresh it; capital never evaluates stale truth.`,
        scenarios,
      });
    }

    const scenarioNode = context.project.nodes[entry.scenarioId];
    if (!scenarioNode || scenarioNode.kind !== "scenario") {
      return NextResponse.json(
        {
          error: "recorded scenario node missing from rebuilt project",
          name: "ScenarioNodeMissing",
        },
        { status: 500 },
      );
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
      return NextResponse.json(
        {
          error:
            "scenario metrics incomplete (homes, footprint, floors, parking-stalls required)",
          name: "ScenarioMetricsIncomplete",
        },
        { status: 500 },
      );
    }

    const facts: CapitalScenarioFacts = {
      scenarioId: entry.scenarioId,
      certificateId: entry.certificateId,
      scenarioLabel: scenarioNode.label,
      homes,
      floors,
      footprintSqFt,
      parkingStalls,
    };

    const result = evaluateCapital(facts, pathway.data, overrides);
    const fingerprint = capitalFingerprint({
      scenarioId: facts.scenarioId,
      certificateId: facts.certificateId,
      pathway: result.pathway,
      assumptions: result.assumptions,
    });

    const preset = PATHWAY_PRESETS[result.pathway];
    return NextResponse.json({
      status: "EVALUATED",
      fingerprint,
      scenario: {
        ...facts,
        grossResidentialSqFt: result.grossResidentialSqFt,
        certificateId: entry.certificateId,
        freshness: entry.freshness,
        solverVersion: scenarioNode.solverVersion,
      },
      pathway: {
        id: preset.id,
        label: preset.label,
        tagline: preset.tagline,
        ownershipNote: preset.ownershipNote,
      },
      engineVersion: result.engineVersion,
      assumptions: result.assumptions,
      cost: result.cost,
      operating: result.operating,
      funding: result.funding,
      sensitivity: result.sensitivity,
      expertRequired: result.expertRequired,
      councilProjection: result.councilProjection,
      scenarios,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "BaseProjectDriftError") {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "base project drift",
          name,
          reacceptRequired: true,
        },
        { status: 409 },
      );
    }
    if (
      name === "PairVerificationError" ||
      name === "CommandReplayError" ||
      name === "InvalidMissionCommandLog"
    ) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "verification failed",
          name,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "capital evaluation failed",
        name,
      },
      { status: 400 },
    );
  }
}
