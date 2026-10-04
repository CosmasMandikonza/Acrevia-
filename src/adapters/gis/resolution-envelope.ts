import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../domain/graph/serialization";
import type { ResolutionSession } from "../../application/resolution/state";

/**
 * Server-signed ResolutionEnvelope (issue #4 blocking 5).
 *
 * The browser owns a mutable ResolutionSession for the resolution UX, but
 * provider-derived official evidence must be tamper-evident: the client
 * cannot silently alter parcel geometry, zoning, owner, authority labels,
 * or capture hashes and have the server commit them as truth.
 *
 * Design: the server canonicalizes the provider-derived session state and
 * signs it with HMAC-SHA256 using a server-only secret. The client stores
 * { session, signature }. Every select/confirm/commit request carries both;
 * the server verifies the signature BEFORE using any provider-derived data,
 * applies only the user's allowed choice (selection/confirmation flags),
 * and returns a newly signed envelope.
 *
 * User-mutable fields (selections, confirmations) are excluded from the
 * signed payload and applied server-side after verification.
 */

export class EnvelopeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeSignatureError";
  }
}

/** Fields the user may change without invalidating the signature. */
const USER_MUTABLE_KEYS = new Set([
  "userConfirmedProperty",
  "confirmedParcelIds",
  "parcelStage",
]);

function getSecret(): string {
  const secret = process.env.ACREVIA_RESOLUTION_SECRET ?? "acrevia-dev-resolution-secret-do-not-use-in-prod";
  return secret;
}

/** Canonicalize the provider-derived session state (excluding user-mutable fields). */
function providerDerivedPayload(session: ResolutionSession): string {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(session)) {
    if (!USER_MUTABLE_KEYS.has(key)) {
      filtered[key] = value;
    }
  }
  return canonicalJson(filtered);
}

export function signSession(session: ResolutionSession): string {
  return createHmac("sha256", getSecret())
    .update(providerDerivedPayload(session), "utf-8")
    .digest("hex");
}

export type ResolutionEnvelope = {
  session: ResolutionSession;
  signature: string;
};

export function createEnvelope(session: ResolutionSession): ResolutionEnvelope {
  return { session, signature: signSession(session) };
}

export function verifyEnvelope(envelope: ResolutionEnvelope): ResolutionSession {
  const expected = signSession(envelope.session);
  const provided = envelope.signature;
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw new EnvelopeSignatureError(
      "resolution envelope signature mismatch: provider-derived state has been tampered with",
    );
  }
  return envelope.session;
}

/** Apply a user's selection/confirmation to a VERIFIED session and return a
 *  freshly signed envelope. Only USER_MUTABLE_KEYS may differ. */
export function applyUserChoice(
  verifiedSession: ResolutionSession,
  choice: Partial<Pick<ResolutionSession, "userConfirmedProperty" | "confirmedParcelIds" | "parcelStage">>,
): ResolutionEnvelope {
  const updated: ResolutionSession = {
    ...verifiedSession,
    ...choice,
  };
  return createEnvelope(updated);
}
