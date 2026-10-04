import {
  Geocoder,
  ParcelProvider,
  ContextProvider,
  StructureProvider,
  ZoningProvider,
  ProviderFailure,
  type AddressCandidate,
  type ParcelCandidate,
  type ResolvedParcelContext,
} from "../../adapters/gis";
import { centroidOf, checkValidity } from "../../adapters/gis/geometry";
import type { ResolutionSession, StageFailure } from "./state";

/**
 * Stateless resolution pipeline (issue #4). Every stage is a pure function of
 * its inputs + providers; the session is carried and returned, never stored
 * server-side. The Census point is a candidate HINT: parcel candidacy comes
 * from the official PWD service (registry match + labeled geometry ranking),
 * and ambiguity is first-class — the pipeline never silently picks a parcel.
 *
 * Per-parcel context: each CONFIRMED parcel gets its own zoning, structures,
 * and site-context resolution, preserving campus-level differences. Context
 * failures are ADDITIVE (allSettled): successful sibling results survive and
 * typed failures are recorded per capability.
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
    parcelContexts: [],
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

function toCapabilityFailure(
  capability: ResolvedParcelContext["failures"][number]["capability"],
  error: unknown,
): ResolvedParcelContext["failures"][number] {
  const failure = toStageFailure(error);
  return { capability, code: failure.code, message: failure.message };
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
    const registry = address.houseNumber && address.street
      ? await providers.parcels.findByAddress(address.houseNumber, address.street)
      : [];
    const near = await providers.parcels.findNearPoint(address.point);

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
      return { ...next, parcelStage: "RESOLVED", confirmedParcelIds: [], parcelCandidates: all };
    }
    if (all.length === 1) {
      return { ...next, parcelStage: "RESOLVED" };
    }
    return { ...next, parcelStage: "CONFIRMATION_REQUIRED" };
  } catch (error) {
    return { ...next, parcelStage: "FAILED", parcelFailure: toStageFailure(error) };
  }
}

/**
 * Resolve site context for EACH confirmed parcel independently. Uses
 * allSettled so one failing provider never discards sibling successes —
 * failures are recorded per-capability in the parcel context.
 */
export async function resolveParcelContexts(
  session: ResolutionSession,
  providers: Providers,
): Promise<ResolutionSession> {
  const chosen = session.parcelCandidates.filter((candidate) =>
    session.confirmedParcelIds.includes(candidate.brtId ?? candidate.parcelId),
  );
  if (chosen.length === 0) return session;

  const contexts: ResolvedParcelContext[] = [];
  const newCaptures: ResolutionSession["captures"] = [];

  for (const parcel of chosen) {
    const centroid = centroidOf(parcel.geometry);
    const context: ResolvedParcelContext = {
      parcelId: parcel.brtId ?? parcel.parcelId,
      structures: [],
      failures: [],
    };

    const [zoningBase, zoningOverlays, structures, flood, historic, rco] = await Promise.allSettled([
      providers.zoning.baseDistrictAtPoint(centroid),
      providers.zoning.overlaysAtPoint(centroid),
      providers.structures.findByParcel({
        parcelId: parcel.pwdParcelNum ?? parcel.parcelId,
        geometry: parcel.geometry,
      }),
      providers.context.floodAtPoint(centroid),
      providers.context.historicAtPoint(centroid),
      providers.context.rcoAtPoint(centroid),
    ]);

    if (zoningBase.status === "fulfilled") {
      context.zoningBase = zoningBase.value;
      newCaptures.push(zoningBase.value.capture);
    } else {
      context.failures.push(toCapabilityFailure("zoning-base", zoningBase.reason));
    }
    if (zoningOverlays.status === "fulfilled") {
      context.zoningOverlays = zoningOverlays.value;
      newCaptures.push(zoningOverlays.value.capture);
    } else {
      context.failures.push(toCapabilityFailure("zoning-overlays", zoningOverlays.reason));
    }
    if (structures.status === "fulfilled") {
      context.structures = structures.value;
      for (const structure of structures.value) newCaptures.push(structure.capture);
    } else {
      context.failures.push(toCapabilityFailure("structures", structures.reason));
    }
    if (flood.status === "fulfilled") {
      context.flood = flood.value;
      newCaptures.push(flood.value.capture);
    } else {
      context.failures.push(toCapabilityFailure("flood", flood.reason));
    }
    if (historic.status === "fulfilled") {
      context.historic = historic.value;
      newCaptures.push(historic.value.capture);
    } else {
      context.failures.push(toCapabilityFailure("historic", historic.reason));
    }
    if (rco.status === "fulfilled") {
      context.rco = rco.value;
      newCaptures.push(rco.value.capture);
    } else {
      context.failures.push(toCapabilityFailure("rco", rco.reason));
    }

    contexts.push(context);
  }

  return {
    ...session,
    parcelContexts: contexts,
    captures: [...session.captures, ...newCaptures],
  };
}

export function confirmParcels(
  session: ResolutionSession,
  parcelIds: string[],
  options?: { allowInvalidGeometry?: boolean },
): ResolutionSession {
  const chosen = session.parcelCandidates.filter((candidate) =>
    parcelIds.includes(candidate.brtId ?? candidate.parcelId),
  );
  if (chosen.length !== parcelIds.length) {
    throw new Error("confirmParcels: unknown parcel id in selection");
  }
  if (!options?.allowInvalidGeometry) {
    for (const parcel of chosen) {
      const verdict = checkValidity(parcel.geometry);
      if (verdict.validity === "invalid") {
        throw new Error(
          `confirmParcels: parcel ${parcel.brtId ?? parcel.parcelId} has invalid geometry (${verdict.problems.join("; ")}). Ordinary confirmation cannot commit invalid geometry — an explicit override is required.`,
        );
      }
    }
  }
  return {
    ...session,
    parcelStage: "RESOLVED",
    confirmedParcelIds: parcelIds,
    userConfirmedProperty: true,
  };
}
