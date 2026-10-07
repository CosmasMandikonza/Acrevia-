import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import { MissionCommandLog } from "../../../../application/mission/rebuild";
import { SolveRefusal } from "../../../../application/solver/inputs";
import { buildTrustedProofContext } from "../../../../application/proof/trusted-context";

/**
 * POST /api/proof/snapshot — the trusted Proof projection endpoint (issue #11).
 *
 * Proof is a VIEW over existing truth, never a parallel store. The route
 * rebuilds exactly what the solver route rebuilds (via the shared trusted
 * pipeline in src/application/proof/trusted-context.ts — verify the accepted
 * { envelope, receipt } pair, hash-gate the committed base project, compile
 * current law, replay the mission command log, seed assumptions, solve, and
 * record current scenarios/certificates) and projects the graph into a
 * read-only typed snapshot for the Evidence surface. Nothing is persisted
 * server-side; client-supplied graph data is never read (only optional real
 * graph ids to focus/validate).
 *
 * The canonical benchmark's open questions seed as REAL ExpertReview nodes
 * through the typed command boundary — but ONLY when the accepted property IS
 * the canonical benchmark property (exact confirmed-parcel identity, never
 * district-level matching). Another RM-1 property gets an honest empty
 * expert-review state and keeps its own unresolved computation questions.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    receipt?: CommitReceipt;
    commands?: unknown;
    scenarioId?: unknown;
    certificateId?: unknown;
    focusNodeId?: unknown;
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
          "proof snapshot requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)",
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
  const optionalId = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  try {
    const context = await buildTrustedProofContext(body.envelope, body.receipt, commands, {
      scenarioId: optionalId(body.scenarioId),
      certificateId: optionalId(body.certificateId),
      focusNodeId: optionalId(body.focusNodeId),
    });
    if (context.status === "multi-parcel-unsupported") {
      return NextResponse.json({
        status: "multi-parcel-unsupported",
        reason:
          "This accepted property has multiple confirmed parcels; per-parcel solving is required before a proof snapshot can be computed for it.",
      });
    }
    if (context.status === "needs-evidence") {
      return NextResponse.json({ status: "needs-evidence", reason: context.reason });
    }
    if (context.status === "unsupported-district") {
      return NextResponse.json({
        status: "unsupported-district",
        district: context.district,
        reason: context.reason,
      });
    }
    return NextResponse.json(context.snapshot);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (error instanceof SolveRefusal || name === "SolveRefusal") {
      const refusal = error as SolveRefusal;
      return NextResponse.json({ status: "REFUSED", reason: refusal.reason, message: refusal.message });
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
      { error: error instanceof Error ? error.message : "proof snapshot failed", name },
      { status: 400 },
    );
  }
}
