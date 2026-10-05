import { timingSafeEqual } from "node:crypto";
import type { ResolutionSession } from "../../application/resolution/state";
import { hmacFor } from "./resolution-envelope";

/**
 * Server-signed CommitReceipt (PR #25 review).
 *
 * The signed ResolutionEnvelope proves the provider-derived session facts are
 * authentic — it does NOT prove a Development Graph commit ever happened. A
 * confirmed-but-never-committed envelope must never restore as "Property
 * accepted". The commit route therefore signs this receipt only AFTER
 * commitSession() and ProjectCodec.encode() succeed, binding the commit
 * metadata (revision, node/event counts, committed time) to the exact
 * envelope signature and session id that produced it.
 *
 * `/api/gis/verify` checks BOTH signatures plus their mutual consistency
 * before any accepted state may be restored. The receipt uses the same
 * ACREVIA_RESOLUTION_SECRET and fails closed in production without it.
 */

export class ReceiptSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptSignatureError";
  }
}

export class ReceiptConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptConsistencyError";
  }
}

export type CommitReceiptPayload = {
  projectId: string;
  propertyId: string;
  sessionId: string;
  envelopeSignature: string;
  revision: number;
  nodeCount: number;
  eventCount: number;
  committedAt: string;
};

export type CommitReceipt = {
  payload: CommitReceiptPayload;
  signature: string;
};

function isPayloadShape(value: unknown): value is CommitReceiptPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.projectId === "string" &&
    candidate.projectId.length > 0 &&
    typeof candidate.propertyId === "string" &&
    candidate.propertyId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.envelopeSignature === "string" &&
    candidate.envelopeSignature.length > 0 &&
    typeof candidate.revision === "number" &&
    Number.isFinite(candidate.revision) &&
    typeof candidate.nodeCount === "number" &&
    Number.isFinite(candidate.nodeCount) &&
    typeof candidate.eventCount === "number" &&
    Number.isFinite(candidate.eventCount) &&
    typeof candidate.committedAt === "string" &&
    candidate.committedAt.length > 0
  );
}

/** Sign the canonical receipt payload with the server secret. */
export function createCommitReceipt(payload: CommitReceiptPayload): CommitReceipt {
  if (!isPayloadShape(payload)) {
    throw new ReceiptSignatureError("commit receipt payload has an invalid shape");
  }
  return { payload, signature: hmacFor(payload) };
}

/** Verify the receipt's HMAC and return its verified payload. */
export function verifyCommitReceipt(receipt: CommitReceipt): CommitReceiptPayload {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    typeof receipt.signature !== "string" ||
    !isPayloadShape(receipt.payload)
  ) {
    throw new ReceiptSignatureError("commit receipt is malformed");
  }
  const expected = hmacFor(receipt.payload);
  const provided = receipt.signature;
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    throw new ReceiptSignatureError("commit receipt signature mismatch: metadata has been tampered with");
  }
  return receipt.payload;
}

/**
 * The project/property id convention for an accepted property: derived from
 * the envelope's first confirmed parcel. The verify boundary enforces that a
 * receipt's ids are consistent with the envelope it claims to commit.
 */
export function expectedProjectIds(session: ResolutionSession): {
  projectId: string;
  propertyId: string;
} {
  const parcelId = session.confirmedParcelIds[0];
  if (!parcelId) {
    throw new ReceiptConsistencyError("envelope has no confirmed parcels");
  }
  return { projectId: `gis:${parcelId}`, propertyId: `gis:property:${parcelId}` };
}

/**
 * Full receipt↔envelope consistency: same envelope signature, same session,
 * and project/property ids matching the accepted-parcel convention. Throws
 * ReceiptConsistencyError on any mismatch.
 */
export function assertReceiptMatchesEnvelope(
  payload: CommitReceiptPayload,
  envelope: { session: ResolutionSession; signature: string },
): void {
  if (payload.envelopeSignature !== envelope.signature) {
    throw new ReceiptConsistencyError(
      "receipt was issued for a different resolution envelope",
    );
  }
  if (payload.sessionId !== envelope.session.sessionId) {
    throw new ReceiptConsistencyError("receipt session id does not match the envelope session");
  }
  const expected = expectedProjectIds(envelope.session);
  if (payload.projectId !== expected.projectId || payload.propertyId !== expected.propertyId) {
    throw new ReceiptConsistencyError(
      "receipt project/property ids are inconsistent with the accepted parcel",
    );
  }
}
