import { NextResponse } from "next/server";
import { providers } from "../../../../adapters/gis/server-stack";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  resolveSiteContext,
  confirmParcels,
} from "../../../../application/resolution/pipeline";
import { rollupState, ResolutionSession } from "../../../../application/resolution/state";
import { centroidOf } from "../../../../adapters/gis/geometry";

export const dynamic = "force-dynamic";

/**
 * POST /api/gis/resolve — stateless resolution endpoint. The client owns the
 * provisional session (it round-trips in the request/response); the server
 * never stores it. Actions:
 *   resolve   — address query → address stage + (auto) parcel discovery
 *   select    — user picks an address candidate → parcel discovery
 *   confirm   — user confirms parcel(s) → site context at primary centroid
 */
export async function POST(request: Request) {
  let body: {
    action: "resolve" | "select" | "confirm";
    sessionId?: string;
    query?: string;
    session?: unknown;
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
      return NextResponse.json({ session, rollup: rollupState(session) });
    }

    if (body.action === "select") {
      const session = ResolutionSession.parse(body.session);
      if (typeof body.candidateIndex !== "number" || !session.addressCandidates[body.candidateIndex]) {
        return NextResponse.json({ error: "select requires a valid candidateIndex" }, { status: 400 });
      }
      let next = await import("../../../../application/resolution/pipeline").then((m) =>
        m.selectAddress(session, session.addressCandidates[body.candidateIndex!]),
      );
      next = await resolveParcels(next, stack);
      return NextResponse.json({ session: next, rollup: rollupState(next) });
    }

    if (body.action === "confirm") {
      const session = ResolutionSession.parse(body.session);
      if (!Array.isArray(body.parcelIds) || body.parcelIds.length === 0) {
        return NextResponse.json({ error: "confirm requires parcelIds" }, { status: 400 });
      }
      const next = confirmParcels(session, body.parcelIds);
      const primary = next.parcelCandidates.find(
        (candidate) => (candidate.brtId ?? candidate.parcelId) === next.confirmedParcelIds[0],
      );
      if (!primary) {
        return NextResponse.json({ error: "confirmed primary parcel missing from candidates" }, { status: 400 });
      }
      const withContext = await resolveSiteContext(next, stack, centroidOf(primary.geometry));
      return NextResponse.json({ session: withContext, rollup: rollupState(withContext) });
    }

    return NextResponse.json({ error: `unknown action ${String(body.action)}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "resolution failed",
        name: error instanceof Error ? error.name : "Error",
      },
      { status: 502 },
    );
  }
}
