"use client";

import type { ResolutionSession } from "../application/resolution/state";

/**
 * Client-side record of the most recently accepted property (session
 * lifetime). The GIS commit API is stateless by design (ADR 0004); this store
 * keeps the accepted experience visible across surface navigation and reloads.
 *
 * TRUST INVARIANT: sessionStorage is never a source of verified truth. The
 * stored envelope is a signed ResolutionEnvelope, and after any reload it must
 * pass POST /api/gis/verify (full-session HMAC against the server secret)
 * before Acrevia restores provider-derived facts (zoning, owner, parcel
 * geometry, structures) as trusted state. Tampered storage fails verification
 * and is discarded; the server returns only { valid: false }, never unverified
 * content. Commit metadata (node/event/revision counts) is display text from
 * the commit response — every provider-derived display fact is re-derived from
 * the server-verified session, never read straight from storage.
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

const RECORD_KEY = "acrevia.accepted-property";
const ENVELOPE_KEY = "acrevia.accepted-envelope";

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

export function readAcceptedProperty(): AcceptedPropertyRecord | null {
  const raw = safeGet(RECORD_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AcceptedPropertyRecord;
    if (
      typeof parsed.query !== "string" ||
      typeof parsed.nodeCount !== "number" ||
      !Array.isArray(parsed.captures)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeAcceptedProperty(record: AcceptedPropertyRecord): void {
  safeSet(RECORD_KEY, JSON.stringify(record));
  invalidateVerificationCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("acrevia:accepted"));
  }
}

export type StoredEnvelope = {
  envelope: { session: ResolutionSession; signature: string };
  commitSummary: string;
  query: string;
};

function readStoredEnvelope(): StoredEnvelope | null {
  const raw = safeGet(ENVELOPE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredEnvelope;
    const session = parsed?.envelope?.session;
    if (
      typeof parsed.commitSummary !== "string" ||
      typeof parsed.query !== "string" ||
      !session ||
      typeof session.sessionId !== "string" ||
      !Array.isArray(session.confirmedParcelIds)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeAcceptedEnvelope<T extends { session: ResolutionSession }>(
  envelope: T,
  commitSummary: string,
  query: string,
): void {
  safeSet(ENVELOPE_KEY, JSON.stringify({ envelope, commitSummary, query }));
  invalidateVerificationCache();
}

/** Drop everything stored — used when verification fails (tampered state). */
export function clearAcceptedState(): void {
  safeRemove(RECORD_KEY);
  safeRemove(ENVELOPE_KEY);
  invalidateVerificationCache();
}

export type VerificationResult =
  | { status: "none" }
  | {
      status: "valid";
      envelope: { session: ResolutionSession; signature: string };
      commitSummary: string;
      query: string;
      record: AcceptedPropertyRecord;
    }
  | { status: "invalid" };

let verificationCache: Promise<VerificationResult> | null = null;

export function invalidateVerificationCache(): void {
  verificationCache = null;
}

/**
 * Verify the stored envelope against the server before anything from storage
 * is displayed as trusted. Memoized per page load so the Site surface and the
 * workspace shell share a single verification round trip; a reload always
 * starts a fresh verification.
 */
export function verifyStoredEnvelope(): Promise<VerificationResult> {
  if (!verificationCache) {
    verificationCache = (async (): Promise<VerificationResult> => {
      const stored = readStoredEnvelope();
      if (!stored) return { status: "none" };
      try {
        const response = await fetch("/api/gis/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope: stored.envelope }),
        });
        if (!response.ok) {
          clearAcceptedState();
          return { status: "invalid" };
        }
        const payload = (await response.json()) as {
          valid: boolean;
          session?: ResolutionSession;
        };
        if (!payload.valid || !payload.session) {
          clearAcceptedState();
          return { status: "invalid" };
        }
        // Verified: re-derive every provider-derived display fact from the
        // server-verified session. Stored display copies are not trusted.
        const record = recordFromVerifiedSession(payload.session, readAcceptedProperty());
        safeSet(RECORD_KEY, JSON.stringify(record));
        return {
          status: "valid",
          envelope: { session: payload.session, signature: stored.envelope.signature },
          commitSummary: stored.commitSummary,
          query: stored.query,
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

/**
 * Build the display record from the SERVER-VERIFIED session. Provider facts
 * (owner, zoning, structures, captures, matched address) come only from the
 * verified session; node/event/revision counts and acceptedAt are commit
 * metadata retained from the previous record (they cannot be re-derived
 * without server-side persistence, which does not exist by design).
 */
export function recordFromVerifiedSession(
  session: ResolutionSession,
  previous: AcceptedPropertyRecord | null,
): AcceptedPropertyRecord {
  const structures = session.parcelContexts.flatMap((context) => context.structures);
  const primaryId = session.confirmedParcelIds[0];
  return {
    query: previous?.query ?? session.query,
    matchedAddress: session.selectedAddress?.matchedAddress,
    ownerName:
      session.parcelCandidates.find(
        (candidate) => (candidate.brtId ?? candidate.parcelId) === primaryId,
      )?.ownerName ?? undefined,
    acceptedAt: previous?.acceptedAt ?? new Date().toISOString(),
    nodeCount: previous?.nodeCount ?? 0,
    eventCount: previous?.eventCount ?? 0,
    revision: previous?.revision ?? 0,
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
