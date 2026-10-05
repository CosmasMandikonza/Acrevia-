import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import {
  buildMissionState,
  CommandReplayError,
  MissionCommandLog,
  PairVerificationError,
} from "../../../../application/mission/rebuild";

/**
 * POST /api/mission/state — the Mission Compiler's trust-preserving project
 * bridge (issue #6). Verifies the accepted { envelope, receipt } pair,
 * deterministically reconstructs the committed Development Graph project,
 * replays the client-held mission command log through the typed command
 * boundary, and returns the server-derived project state with a signed
 * attestation. Stateless: nothing is persisted server-side; the client never
 * authors project JSON, it only submits user-intent commands for validation.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { envelope?: ResolutionEnvelope; receipt?: CommitReceipt; commands?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (
    !body.envelope ||
    typeof body.envelope !== "object" ||
    !body.envelope.session ||
    typeof body.envelope.signature !== "string" ||
    !body.receipt ||
    typeof body.receipt !== "object" ||
    !body.receipt.payload ||
    typeof body.receipt.signature !== "string"
  ) {
    return NextResponse.json(
      { error: "mission state requires the accepted { envelope, receipt } pair" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.commands)) {
    return NextResponse.json(
      { error: "mission state requires a command log array" },
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

  try {
    const state = buildMissionState(body.envelope, body.receipt, commands);
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof PairVerificationError) {
      return NextResponse.json(
        { error: error.message, name: error.name, reason: "verification-failed" },
        { status: 403 },
      );
    }
    if (error instanceof CommandReplayError) {
      // Atomic: the replayed project is discarded server-side; the client is
      // told exactly which command was rejected so it can recover honestly.
      return NextResponse.json(
        {
          error: error.message,
          name: error.name,
          commandIndex: error.commandIndex,
          atomic: true,
          partialStateWritten: false,
        },
        { status: 422 },
      );
    }
    const name = error instanceof Error ? error.name : "Error";
    if (name === "MissingSecretError") {
      return NextResponse.json(
        { error: "attestation secret unavailable", name },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "mission state failed", name },
      { status: 400 },
    );
  }
}
