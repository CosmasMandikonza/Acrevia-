import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import { MissionCommandLog } from "../../../../application/mission/rebuild";
import { buildTrustedProofContext } from "../../../../application/proof/trusted-context";
import { runCopilotTurn } from "../../../../application/copilot/orchestrate";
import { CopilotProviderError } from "../../../../adapters/ai/copilot-provider";
import { selectCopilotProvider } from "../../../../adapters/ai/provider-selection";

/**
 * POST /api/copilot/turn — the Copilot trust boundary (issue #10).
 *
 * Same contract as every trusted Acrevia route: the client presents the
 * accepted { envelope, receipt } pair plus the typed mission command log; the
 * server verifies the pair, deterministically rebuilds the project (law
 * compiled, missions replayed, scenarios solved and certified) via the shared
 * trusted pipeline, and lets the model operate ONLY through generic typed
 * tools over that state. No browser-supplied metric, zoning value, proof
 * chain, or certificate is ever read.
 *
 * The Copilot can propose mission changes but CANNOT apply them — there is no
 * apply endpoint here; confirmed changes go through the existing
 * POST /api/mission/state command boundary from the UI.
 *
 * AI failure never breaks deterministic Acrevia: an unconfigured provider
 * returns `ai-unavailable` (no canned prose), and provider errors return
 * `ai-error` with the honest reason and any tool facts already gathered.
 */

export const dynamic = "force-dynamic";

const HistoryInput = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(4000),
    }),
  )
  .max(6);

const TurnInput = z
  .object({
    envelope: z.unknown(),
    receipt: z.unknown(),
    commands: z.unknown(),
    message: z.string().min(1).max(2000),
    history: z.optional(HistoryInput).default([]),
  })
  .strict();

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = TurnInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }
  const { envelope, receipt, message, history } = parsed.data;

  let commands: ReturnType<typeof MissionCommandLog.parse>;
  try {
    commands = MissionCommandLog.parse(parsed.data.commands);
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

  // AI availability is checked FIRST so an unconfigured server answers
  // honestly without any rebuild cost — and never substitutes canned prose.
  // Gloo is the intended provider; Anthropic is the configured fallback
  // (selection rules in src/adapters/ai/provider-selection.ts).
  const selection = selectCopilotProvider();
  if (selection.status === "unavailable") {
    return NextResponse.json({
      status: "ai-unavailable",
      reason: selection.reason,
    });
  }
  const provider = selection.provider;

  try {
    const trusted = await buildTrustedProofContext(
      envelope as ResolutionEnvelope,
      receipt as CommitReceipt,
      commands,
    );
    if (trusted.status === "multi-parcel-unsupported") {
      return NextResponse.json({
        status: "multi-parcel-unsupported",
        reason:
          "This accepted property has multiple confirmed parcels; per-parcel solving is required before the Copilot can reason about it.",
      });
    }
    if (
      trusted.status === "needs-evidence" ||
      trusted.status === "unsupported-district"
    ) {
      return NextResponse.json({
        status: trusted.status,
        reason: trusted.reason,
      });
    }

    const result = await runCopilotTurn({
      message,
      history,
      context: { trusted, commands },
      provider,
    });
    return NextResponse.json({ ...result, model: provider.model });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (
      error instanceof CopilotProviderError ||
      name === "CopilotProviderError"
    ) {
      return NextResponse.json({
        status: "ai-error",
        reason: error instanceof Error ? error.message : "AI provider failed",
      });
    }
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
        error: error instanceof Error ? error.message : "copilot turn failed",
        name,
      },
      { status: 400 },
    );
  }
}
