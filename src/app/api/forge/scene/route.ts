import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import { MissionCommandLog } from "../../../../application/mission/rebuild";
import { buildForgeSceneResult } from "../../../../application/forge/build-forge-scene";
import { SolveRefusal } from "../../../../application/solver/inputs";

/**
 * POST /api/forge/scene — the production Forge endpoint (issue #9).
 *
 * Input: the signed accepted pair, the client-held mission command log
 * (replayed and re-validated server-side), and an optional housing goal.
 * Output: the SpatialSceneModel derived from LAW ∩ MISSION over the
 * verified property, with real #7 scenarios, ScenarioCertificates, and
 * deterministic conceptual placement.
 *
 * Trust discipline matches /api/solver/solve exactly. The client may select
 * an existing scenario or change a mission value (through the typed mission
 * boundary, never through this route) — but geometry, zoning, parcel
 * identity, solver results, and certificates are NEVER trusted from the
 * client; the server reconstructs all of them from the verified pair.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    receipt?: CommitReceipt;
    commands?: unknown;
    targetHomes?: unknown;
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
          "forge requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)",
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
        error: cause instanceof Error ? cause.message : "malformed mission command log",
        name: "InvalidMissionCommandLog",
      },
      { status: 400 },
    );
  }
  let targetHomes: number | undefined;
  if (body.targetHomes !== undefined && body.targetHomes !== null) {
    if (typeof body.targetHomes !== "number" || !Number.isInteger(body.targetHomes) || body.targetHomes < 0) {
      return NextResponse.json(
        { error: "targetHomes must be a non-negative whole number of homes" },
        { status: 400 },
      );
    }
    targetHomes = body.targetHomes;
  }

  try {
    const result = await buildForgeSceneResult({
      envelope: body.envelope,
      receipt: body.receipt,
      commands,
      targetHomes,
    });
    return NextResponse.json(result);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (error instanceof SolveRefusal || name === "SolveRefusal") {
      const refusal = error as SolveRefusal;
      return NextResponse.json({
        status: "REFUSED",
        reason: refusal.reason,
        message: refusal.message,
      });
    }
    if (name === "BaseProjectDriftError") {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "base project drift", name, reacceptRequired: true },
        { status: 409 },
      );
    }
    if (name === "PairVerificationError" || name === "CommandReplayError" || name === "InvalidMissionCommandLog") {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "verification failed", name },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "forge scene failed", name },
      { status: 400 },
    );
  }
}
