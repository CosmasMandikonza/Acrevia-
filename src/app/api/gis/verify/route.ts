import { NextResponse } from "next/server";
import {
  verifyEnvelope,
  type ResolutionEnvelope,
} from "../../../../adapters/gis/resolution-envelope";

/**
 * Server verification boundary for client-stored resolution envelopes.
 *
 * sessionStorage is NEVER a source of verified truth: before the browser may
 * restore provider-derived facts (zoning, owner, parcel geometry, structures)
 * after a navigation or reload, the stored signed envelope must come back here
 * and pass full-session HMAC verification against the server secret. A tampered
 * session fails verification and the caller must discard the stored state — the
 * server returns only { valid: false }, never the unverified content.
 *
 * Like the rest of the GIS API, this route is stateless: no session or project
 * data is persisted server-side.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { envelope?: ResolutionEnvelope };
  try {
    body = (await request.json()) as { envelope?: ResolutionEnvelope };
  } catch {
    return NextResponse.json({ valid: false, reason: "invalid JSON body" }, { status: 400 });
  }
  if (
    !body.envelope ||
    typeof body.envelope !== "object" ||
    !body.envelope.session ||
    typeof body.envelope.signature !== "string"
  ) {
    return NextResponse.json(
      { valid: false, reason: "verify requires a signed envelope" },
      { status: 400 },
    );
  }

  try {
    const session = verifyEnvelope(body.envelope);
    return NextResponse.json({ valid: true, session });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "MissingSecretError") {
      // Fail closed: without the production secret nothing can be verified.
      return NextResponse.json(
        { valid: false, reason: "verification secret unavailable" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { valid: false, reason: "signature verification failed", name },
      { status: 400 },
    );
  }
}
