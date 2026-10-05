import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../domain/graph/serialization";
import type { ResolutionSession } from "../../application/resolution/state";

/**
 * Server-signed ResolutionEnvelope (issue #4).
 *
 * The ENTIRE ResolutionSession is signed — no fields are excluded. User
 * choices (parcel selections, confirmations) arrive separately as request
 * inputs (candidateIndex, parcelIds); the server verifies the fully signed
 * previous state, applies the allowed choice, then returns a newly fully
 * signed envelope. There is no trust bypass.
 *
 * ACREVIA_RESOLUTION_SECRET is required in production (NODE_ENV=production)
 * and the module fails closed if absent. A dev/test fallback is provided for
 * local development and CI only.
 */

export class EnvelopeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeSignatureError";
  }
}

export class MissingSecretError extends Error {
  constructor() {
    super(
      "ACREVIA_RESOLUTION_SECRET is required in production. Refusing to sign resolution envelopes with a known fallback.",
    );
    this.name = "MissingSecretError";
  }
}

function getSecret(): string {
  const secret = process.env.ACREVIA_RESOLUTION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new MissingSecretError();
  }
  // Dev/test fallback — never used in production.
  return "acrevia-dev-resolution-secret-do-not-use-in-prod";
}

/** Sign the ENTIRE session — no fields excluded. */
function fullPayload(session: ResolutionSession): string {
  return canonicalJson(session);
}

/**
 * Canonical HMAC over any server-attested payload (resolution sessions,
 * commit receipts) using ACREVIA_RESOLUTION_SECRET. Shared so every signed
 * artifact fails closed under the same secret policy.
 */
export function hmacFor(value: unknown): string {
  return createHmac("sha256", getSecret()).update(canonicalJson(value), "utf-8").digest("hex");
}

export function signSession(session: ResolutionSession): string {
  return createHmac("sha256", getSecret())
    .update(fullPayload(session), "utf-8")
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
      "resolution envelope signature mismatch: session state has been tampered with",
    );
  }
  return envelope.session;
}
