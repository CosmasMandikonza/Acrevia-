import { NextResponse } from "next/server";
import { providers } from "../../../../adapters/gis/server-stack";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  resolveParcelContexts,
  confirmParcels,
  selectAddress,
} from "../../../../application/resolution/pipeline";
import { rollupState } from "../../../../application/resolution/state";
import {
  createEnvelope,
  verifyEnvelope,
  type ResolutionEnvelope,
} from "../../../../adapters/gis/resolution-envelope";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    action: "resolve" | "select" | "confirm";
    sessionId?: string;
    query?: string;
    envelope?: ResolutionEnvelope;
    candidateIndex?: number;
    parcelIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const stack = providers();

  try {
    if (body.action === "resolve") {
      if (!body.query || !body.sessionId) {
        return NextResponse.json({ error: "resolve requires query and sessionId" }, { status: 400 });
      }
      let session = newSession(body.sessionId, body.query, new Date().toISOString());
      session = await resolveAddress(session, stack);
      if (session.addressStage === "RESOLVED" && session.selectedAddress) {
        session = await resolveParcels(session, stack);
      }
      return NextResponse.json({ envelope: createEnvelope(session), rollup: rollupState(session) });
    }

    if (body.action === "select") {
      if (!body.envelope) {
        return NextResponse.json({ error: "select requires envelope" }, { status: 400 });
      }
      const session = verifyEnvelope(body.envelope);
      if (typeof body.candidateIndex !== "number" || !session.addressCandidates[body.candidateIndex]) {
        return NextResponse.json({ error: "select requires a valid candidateIndex" }, { status: 400 });
      }
      let next = await selectAddress(session, session.addressCandidates[body.candidateIndex]);
      next = await resolveParcels(next, stack);
      return NextResponse.json({ envelope: createEnvelope(next), rollup: rollupState(next) });
    }

    if (body.action === "confirm") {
      if (!body.envelope) {
        return NextResponse.json({ error: "confirm requires envelope" }, { status: 400 });
      }
      const session = verifyEnvelope(body.envelope);
      if (!Array.isArray(body.parcelIds) || body.parcelIds.length === 0) {
        return NextResponse.json({ error: "confirm requires parcelIds" }, { status: 400 });
      }
      const confirmed = confirmParcels(session, body.parcelIds);
      const withContext = await resolveParcelContexts(confirmed, stack);
      return NextResponse.json({ envelope: createEnvelope(withContext), rollup: rollupState(withContext) });
    }

    return NextResponse.json({ error: `unknown action ${String(body.action)}` }, { status: 400 });
  } catch (error) {
    const isSignatureError = error instanceof Error && error.name === "EnvelopeSignatureError";
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "resolution failed",
        name: error instanceof Error ? error.name : "Error",
        tampered: isSignatureError,
      },
      { status: isSignatureError ? 403 : 502 },
    );
  }
}
