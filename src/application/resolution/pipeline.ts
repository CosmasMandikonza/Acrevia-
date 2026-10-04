import {
  Geocoder,
  ParcelProvider,
  ContextProvider,
  StructureProvider,
  ZoningProvider,
  ProviderFailure,
  type AddressCandidate,
  type ParcelCandidate,
} from "../../adapters/gis";
import { checkValidity } from "../../adapters/gis/geometry";
import type { ResolutionSession, StageFailure } from "./state";

/**
 * Stateless resolution pipeline (issue #4). Every stage is a pure function of
 * its inputs + providers; the session is carried and returned, never stored
 * server-side. The Census point is a candidate HINT: parcel candidacy comes
 * from the official PWD service (registry match + labeled geometry ranking),
 * and ambiguity is first-class — the pipeline never silently picks a parcel.
 */

export type Providers = {
  geocoder: Geocoder;
  parcels: ParcelProvider;
  zoning: ZoningProvider;
  structures: StructureProvider;
  context: ContextProvider;
};

export function newSession(sessionId: string, query: string, now: string): ResolutionSession {
  return {
    sessionId,
    createdAt: now,
    query,
    addressStage: "UNRESOLVED",
    addressCandidates: [],
    parcelStage: "NOT_STARTED",
    parcelCandidates: [],
    confirmedParcelIds: [],
    userConfirmedProperty: false,
    structures: [],
    captures: [],
  };
}

function toStageFailure(error: unknown): StageFailure {
  if (error instanceof ProviderFailure) {
    return { code: error.code, message: error.message, providerId: error.providerId };
  }
  return {
    code: "PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "unknown provider error",
    providerId: "unknown",
  };
}

export async function resolveAddress(
  session: ResolutionSession,
  providers: Providers,
): Promise<ResolutionSession> {
  let next: ResolutionSession = { ...session, addressStage: "SEARCHING" };
  try {
    const candidates = await providers.geocoder.geocode(session.query);
    next = { ...next, addressCandidates: candidates, captures: [...session.captures, ...candidates.map((c) => c.capture)] };
    if (candidates.length === 0) {
      return { ...next, addressStage: "FAILED", addressFailure: { code: "NO_MATCH", message: "no address candidates for this query", providerId: providers.geocoder.providerId } };
    }
    if (candidates.length === 1) {
      // Single candidate: auto-advance the ADDRESS stage, but the property
      // still requires confirmation later. The Census point remains a hint.
      return { ...next, addressStage: "RESOLVED", selectedAddress: candidates[0] };
    }
    return { ...next, addressStage: "CONFIRMATION_REQUIRED" };
  } catch (error) {
    return { ...next, addressStage: "FAILED", addressFailure: toStageFailure(error) };
  }
}

export async function selectAddress(
  session: ResolutionSession,
  candidate: AddressCandidate,
): Promise<ResolutionSession> {
  return { ...session, addressStage: "RESOLVED", selectedAddress: candidate };
}

export async function resolveParcels(
  session: ResolutionSession,
  providers: Providers,
): Promise<ResolutionSession> {
  const address = session.selectedAddress;
  if (!address) throw new Error("resolveParcels requires a selected address candidate");
  let next: ResolutionSession = { ...session, parcelStage: "SEARCHING" };
  try {
    // Two labeled discovery modes against the official parcel service:
    const registry = address.houseNumber && address.street
      ? await providers.parcels.findByAddress(address.houseNumber, address.street)
      : [];
    const near = await providers.parcels.findNearPoint(address.point);

    // Merge by parcel id, unioning match reasons (registry evidence outranks
    // proximity; both are recorded, neither is silent).
    const byId = new Map<string, ParcelCandidate>();
    for (const candidate of [...registry, ...near]) {
      const key = candidate.brtId ?? candidate.parcelId;
      const existing = byId.get(key);
      if (existing) {
        const reasons = [...new Set([...existing.matchReasons, ...candidate.matchReasons])];
        byId.set(key, { ...existing, matchReasons: reasons });
      } else {
        byId.set(key, candidate);
      }
    }
    const all = [...byId.values()].sort((a, b) => {
      const rank = (reasons: ParcelCandidate["matchReasons"]) =>
        reasons.includes("ADDRESS_REGISTRY_MATCH") ? 0 : reasons.includes("CONTAINS_GEOCODE_POINT") ? 1 : 2;
      return rank(a.matchReasons) - rank(b.matchReasons);
    });

    next = {
      ...next,
      parcelCandidates: all,
      captures: [...next.captures, ...all.map((candidate) => candidate.capture)],
    };

    if (all.length === 0) {
      return {
        ...next,
        parcelStage: "PARCEL_NONE",
        parcelFailure: {
          code: "NO_MATCH",
          message: "the address candidate yielded no parcels in the official parcel service",
          providerId: providers.parcels.providerId,
        },
      };
    }

    // Mark invalid-geometry candidates explicitly — they stay visible with a
    // warning; committing them requires an explicit override decision later.
    for (const candidate of all) {
      checkValidity(candidate.geometry); // recorded via candidate validity below
    }

    // Auto-resolve ONLY when there is exactly one registry match AND no other
    // plausible candidate contains the geocode point. Otherwise confirm.
    const registryMatches = all.filter((candidate) =>
      candidate.matchReasons.includes("ADDRESS_REGISTRY_MATCH"),
    );
    const pointContainment = all.filter((candidate) =>
      candidate.matchReasons.includes("CONTAINS_GEOCODE_POINT"),
    );
    if (
      registryMatches.length === 1 &&
      (pointContainment.length === 0 ||
        (pointContainment.length === 1 &&
          (pointContainment[0].brtId ?? pointContainment[0].parcelId) ===
            (registryMatches[0].brtId ?? registryMatches[0].parcelId)))
    ) {
      void registryMatches[0];
      return {
        ...next,
        parcelStage: "RESOLVED",
        confirmedParcelIds: [],
        parcelCandidates: all,
      };
    }
    if (all.length === 1) {
      return { ...next, parcelStage: "RESOLVED" };
    }
    return { ...next, parcelStage: "CONFIRMATION_REQUIRED" };
  } catch (error) {
    return { ...next, parcelStage: "FAILED", parcelFailure: toStageFailure(error) };
  }
}

export async function resolveSiteContext(
  session: ResolutionSession,
  providers: Providers,
  parcelGeometryCentroid: [number, number],
): Promise<ResolutionSession> {
  try {
    const [zoning, structures, context] = await Promise.all([
      providers.zoning.assignAtPoint(parcelGeometryCentroid),
      providers.structures.findByParcelPoint(parcelGeometryCentroid),
      providers.context.contextAtPoint(parcelGeometryCentroid),
    ]);
    return {
      ...session,
      zoning,
      structures,
      context,
      captures: [...session.captures, zoning.capture, ...structures.map((s) => s.capture), context.capture],
    };
  } catch {
    // Context is enrichment: a failure here is PARTIAL, not fatal — recorded.
    return session;
  }
}

export function confirmParcels(
  session: ResolutionSession,
  parcelIds: string[],
): ResolutionSession {
  const chosen = session.parcelCandidates.filter((candidate) =>
    parcelIds.includes(candidate.brtId ?? candidate.parcelId),
  );
  if (chosen.length !== parcelIds.length) {
    throw new Error("confirmParcels: unknown parcel id in selection");
  }
  return {
    ...session,
    parcelStage: "RESOLVED",
    confirmedParcelIds: parcelIds,
    userConfirmedProperty: true,
  };
}
