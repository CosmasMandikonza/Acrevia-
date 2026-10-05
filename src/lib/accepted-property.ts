"use client";

import type { ResolutionSession } from "../application/resolution/state";
import type { CommitReceipt, CommitReceiptPayload } from "../adapters/gis/commit-receipt";

/**
 * Client-side accepted-session store (PR #25 trust model).
 *
 * sessionStorage is NEVER a source of verified truth. The only stored state
 * is the pair of server-signed artifacts — the ResolutionEnvelope (authentic
 * provider facts) and the CommitReceipt (proof the atomic commit happened,
 * with the commit metadata). After any reload, POST /api/gis/verify must
 * verify BOTH signatures and their mutual consistency before any accepted
 * state (or any provider- or commit-derived fact) is restored. Tampered or
 * receipt-less storage fails verification and is discarded; the server
 * returns only { valid: false }, never unverified content.
 *
 * The displayed revision/node/event counts and accepted time derive ONLY from
 * the verified receipt payload. There is no unsigned accepted-property
 * record anymore, and acceptance propagation inside the page uses an
 * in-memory listener registry — never a forgeable DOM custom event.
 */

export type AcceptedCaptureSummary = {
  provider: string;
  mode: string;
  retrievedAt: string;
  hashPrefix: string;
  note?: string;
};

export type AcceptedPropertyRecord = {
  query: string;
  matchedAddress?: string;
  ownerName?: string;
  acceptedAt: string;
  nodeCount: number;
  eventCount: number;
  revision: number;
  structureCount: number;
  zoningSummary: string;
  captures: AcceptedCaptureSummary[];
};

/**
 * The ONLY stored state: the two server-signed artifacts. No unsigned fields —
 * in particular no query/address metadata. The address binding for restore is
 * derived from the VERIFIED envelope session (payload.session.query) and never
 * from client-stored metadata.
 */
type StoredAcceptedSession = {
  envelope: { session: ResolutionSession; signature: string };
  receipt: CommitReceipt;
};

/** Current store shape; the legacy unsigned record/envelope keys are dropped. */
const SESSION_KEY = "acrevia.accepted-session";
const LEGACY_KEYS = ["acrevia.accepted-property", "acrevia.accepted-envelope"];

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage quota or privacy mode — degrades to no persistence, never crashes the flow.
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

type StoredRead =
  | { value: StoredAcceptedSession }
  | { malformed: true }
  | null; // null = nothing stored

function readStoredSession(): StoredRead {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  let parsed: StoredAcceptedSession;
  try {
    parsed = JSON.parse(raw) as StoredAcceptedSession;
  } catch {
    return { malformed: true };
  }
  const session = parsed?.envelope?.session;
  if (
    !session ||
    typeof session.sessionId !== "string" ||
    !Array.isArray(session.confirmedParcelIds) ||
    typeof parsed.envelope.signature !== "string" ||
    !parsed.receipt?.payload ||
    typeof parsed.receipt.signature !== "string"
  ) {
    return { malformed: true };
  }
  return { value: parsed };
}

/**
 * Normalize an address string for binding comparisons: trim, collapse
 * whitespace, case-fold. Used to compare the current workspace address
 * against the VERIFIED session query — never against stored metadata.
 */
export function normalizeAddressQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Store the signed pair after a successful commit (trusted in-page response). */
export function writeAcceptedSession(
  envelope: { session: ResolutionSession; signature: string },
  receipt: CommitReceipt,
): void {
  safeSet(SESSION_KEY, JSON.stringify({ envelope, receipt } satisfies StoredAcceptedSession));
  for (const key of LEGACY_KEYS) safeRemove(key);
  invalidateVerificationCache();
}

/** Drop everything stored — used when verification fails (tampered state). */
export function clearAcceptedState(): void {
  safeRemove(SESSION_KEY);
  for (const key of LEGACY_KEYS) safeRemove(key);
  invalidateVerificationCache();
}

export type VerificationResult =
  | { status: "none" }
  | {
      status: "valid";
      envelope: { session: ResolutionSession; signature: string };
      receipt: CommitReceiptPayload;
      query: string;
      record: AcceptedPropertyRecord;
    }
  | { status: "invalid" };

let verificationCache: Promise<VerificationResult> | null = null;

export function invalidateVerificationCache(): void {
  verificationCache = null;
}

/**
 * Verify the stored { envelope, receipt } pair against the server before
 * anything from storage is displayed as trusted. Memoized per page load so
 * the Site surface and the workspace shell share one verification round
 * trip; a reload always starts a fresh verification.
 */
export function verifyStoredSession(): Promise<VerificationResult> {
  if (!verificationCache) {
    verificationCache = (async (): Promise<VerificationResult> => {
      const stored = readStoredSession();
      if (!stored) return { status: "none" };
      // Corrupted storage (e.g. a receipt-less session) is discarded, not ignored.
      if ("malformed" in stored) {
        clearAcceptedState();
        return { status: "invalid" };
      }
      const { envelope, receipt } = stored.value;
      try {
        const response = await fetch("/api/gis/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope, receipt }),
        });
        if (!response.ok) {
          clearAcceptedState();
          return { status: "invalid" };
        }
        const payload = (await response.json()) as {
          valid: boolean;
          session?: ResolutionSession;
          receipt?: CommitReceiptPayload;
        };
        if (!payload.valid || !payload.session || !payload.receipt) {
          clearAcceptedState();
          return { status: "invalid" };
        }
        // Verified: every provider-derived fact comes from the verified
        // session, every commit-derived fact from the verified receipt —
        // including the query/address binding, which is derived from the
        // VERIFIED session (payload.session.query), never from stored
        // client metadata.
        const query = payload.session.query;
        const record = recordFromVerified(payload.session, payload.receipt, query);
        return {
          status: "valid",
          envelope: { session: payload.session, signature: envelope.signature },
          receipt: payload.receipt,
          query,
          record,
        };
      } catch {
        // Network failure while verifying: do not trust the stored state.
        clearAcceptedState();
        return { status: "invalid" };
      }
    })();
  }
  return verificationCache;
}

/** Commit summary text derived ONLY from the (verified) receipt payload. */
export function commitSummaryFromReceipt(receipt: CommitReceiptPayload): string {
  return `Accepted as Development Graph project — ${receipt.nodeCount} nodes, ${receipt.eventCount} audited events, revision ${receipt.revision}. Every fact traces to its source.`;
}

/**
 * Build the display record from the SERVER-VERIFIED session (provider facts:
 * owner, zoning, structures, captures, matched address) and the
 * SERVER-VERIFIED receipt (commit facts: revision, node/event counts,
 * committed time). Nothing here reads unsigned storage.
 */
export function recordFromVerified(
  session: ResolutionSession,
  receipt: CommitReceiptPayload,
  query: string,
): AcceptedPropertyRecord {
  const structures = session.parcelContexts.flatMap((context) => context.structures);
  const primaryId = session.confirmedParcelIds[0];
  return {
    query,
    matchedAddress: session.selectedAddress?.matchedAddress,
    ownerName:
      session.parcelCandidates.find(
        (candidate) => (candidate.brtId ?? candidate.parcelId) === primaryId,
      )?.ownerName ?? undefined,
    acceptedAt: receipt.committedAt,
    nodeCount: receipt.nodeCount,
    eventCount: receipt.eventCount,
    revision: receipt.revision,
    structureCount: structures.length,
    zoningSummary:
      session.parcelContexts
        .map(
          (context) => context.zoningBase?.districtLong ?? context.zoningBase?.district ?? "—",
        )
        .join(", ") +
      (session.parcelContexts.some(
        (context) => context.zoningOverlays && context.zoningOverlays.overlays.length > 0,
      )
        ? " + overlays"
        : ""),
    captures: dedupeCaptures(session).map((capture) => ({
      provider: capture.provider,
      mode: capture.mode,
      retrievedAt: capture.retrievedAt,
      hashPrefix: capture.rawContentHash.slice(0, 8),
      note: capture.note,
    })),
  };
}

// ---------------------------------------------------------------------------
// In-memory accepted notification (replaces the forgeable DOM event).
//
// A custom browser event (acrevia:accepted) could be dispatched by any page
// script to inject accepted state. This module-scope registry is reachable
// only through module imports — page scripts cannot call it — and is invoked
// exclusively by the commit path with a record derived from the page's own
// server-signed envelope + receipt.
// ---------------------------------------------------------------------------

type AcceptedListener = (record: AcceptedPropertyRecord) => void;
const listeners = new Set<AcceptedListener>();

export function onAccepted(listener: AcceptedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAccepted(record: AcceptedPropertyRecord): void {
  for (const listener of listeners) listener(record);
}

type CaptureLike = {
  provider: string;
  mode: string;
  retrievedAt: string;
  rawContentHash: string;
  note?: string;
};

function dedupeCaptures(session: ResolutionSession): CaptureLike[] {
  const seen = new Set<string>();
  const result: CaptureLike[] = [];
  for (const capture of session.captures) {
    const key = `${capture.providerId}-${capture.rawContentHash.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(capture);
  }
  return result;
}
