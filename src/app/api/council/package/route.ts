import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import { MissionCommandLog } from "../../../../application/mission/rebuild";
import { buildTrustedProofContext } from "../../../../application/proof/trusted-context";
import {
  CapitalAssumptionOverridesSchema,
  OwnershipPathwaySchema,
  type CapitalAssumptionOverrides,
} from "../../../../application/capital/schema";
import { buildCouncilPackage } from "../../../../application/council/package";

/**
 * POST /api/council/package — the stakeholder decision package (issue #13).
 *
 * Council is a VIEW over trusted truth, exactly like Proof and Capital: the
 * accepted { envelope, receipt } pair is verified, the committed base project
 * rebuilt and hash-gated, law compiled, the mission command log replayed, and
 * the deterministic solver re-run — all through the SAME trusted pipeline
 * (buildTrustedProofContext). The deterministic assembly then projects that
 * ONE state for five audiences; the facts cannot differ between audiences
 * because every audience view interpolates the same server-side fact table.
 *
 * Capital is OPTIONAL: when a pathway is supplied, the assembly evaluates
 * the SAME scenario it selects with the same pure Capital engine and folds
 * that fingerprint into the package fingerprint. Without a pathway the
 * package is fully usable and says capital has not been modeled. Nothing is
 * persisted; nothing client-supplied beyond the signed pair, the typed
 * mission command log, a scenario id, and bounded capital inputs is read.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    receipt?: CommitReceipt;
    commands?: unknown;
    scenarioId?: unknown;
    pathway?: unknown;
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
          "council requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)",
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

  // Pathway is OPTIONAL: without it the package ships capital: null.
  if (
    body.pathway !== undefined &&
    body.pathway !== null &&
    !OwnershipPathwaySchema.safeParse(body.pathway).success
  ) {
    return NextResponse.json(
      {
        error:
          "pathway must be one of: ground-lease, church-led, joint-development",
        name: "InvalidPathway",
      },
      { status: 400 },
    );
  }
  const pathway =
    body.pathway === undefined || body.pathway === null
      ? undefined
      : OwnershipPathwaySchema.parse(body.pathway);

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
      // Same fail-closed shapes as the capital route — council never invents
      // a decision package when no current trusted scenario exists.
      if (context.status === "multi-parcel-unsupported") {
        return NextResponse.json({
          status: "multi-parcel-unsupported",
          reason:
            "This accepted property has multiple confirmed parcels; per-parcel solving is required before council can assemble a package.",
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

    const assembly = buildCouncilPackage(context, {
      scenarioId: body.scenarioId,
      capital: pathway ? { pathway, overrides } : undefined,
    });

    if (assembly.status === "stale-scenario") {
      return NextResponse.json({
        status: "stale-scenario",
        reason: assembly.reason,
        scenarios: assembly.scenarios,
      });
    }
    if (assembly.status === "stale-certificate") {
      return NextResponse.json({
        status: "stale-certificate",
        reason: assembly.reason,
        scenarios: assembly.scenarios,
      });
    }

    return NextResponse.json({
      status: "ASSEMBLED",
      package: assembly.package,
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
          error instanceof Error ? error.message : "council assembly failed",
        name,
      },
      { status: 400 },
    );
  }
}
