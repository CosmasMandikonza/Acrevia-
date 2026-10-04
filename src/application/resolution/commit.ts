import { commitResolvedSite, type CommitResolvedSiteInput } from "../../commands/site";
import { checkValidity, computedAreaSqFt } from "../../adapters/gis/geometry";
import type { ResolutionSession } from "./state";

/**
 * Session → atomic commit plan (issue #4). Only a CONFIRMED session may become
 * graph truth: userConfirmedProperty must be true and confirmed parcels must
 * exist. Half-resolved sessions are rejected loudly. All graph writes flow
 * through commitResolvedSite's staged, integrity-validated mutation boundary.
 */

export class IncompleteSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteSessionError";
  }
}

export function buildCommitPlan(
  session: ResolutionSession,
  options: {
    projectId: string;
    propertyId: string;
    actor: string;
    now: string;
  },
): CommitResolvedSiteInput {
  if (!session.userConfirmedProperty) {
    throw new IncompleteSessionError(
      "cannot commit: the property has not been user-confirmed (half-resolved sessions never become graph truth)",
    );
  }
  const chosen = session.parcelCandidates.filter((candidate) =>
    session.confirmedParcelIds.includes(candidate.brtId ?? candidate.parcelId),
  );
  if (chosen.length === 0) {
    throw new IncompleteSessionError("cannot commit: no confirmed parcels in the session");
  }
  const address = session.selectedAddress;
  if (!address) {
    throw new IncompleteSessionError("cannot commit: no selected address candidate");
  }

  const sourceArtifacts: CommitResolvedSiteInput["sourceArtifacts"] = [];
  const claims: CommitResolvedSiteInput["claims"] = [];

  // --- Address (Census hint, truthfully labeled as a geocode) --------------
  const censusArtifactId = `gis:src:${address.capture.providerId}:${address.capture.rawContentHash.slice(0, 12)}`;
  sourceArtifacts.push({
    id: censusArtifactId,
    kind: "source-artifact",
    logicalSourceKey: `gis:src:${address.capture.providerId}`,
    version: 1,
    sourceType: "official_gis",
    title: `${address.capture.provider} — address candidate`,
    publisher: address.capture.provider,
    canonicalUrl: address.capture.canonicalQuery,
    authority: address.capture.authority,
    retrievedAt: address.capture.retrievedAt,
    rawContentHash: address.capture.rawContentHash,
    rawEvidenceRef: address.capture.rawEvidenceRef,
    notes: `capture mode ${address.capture.mode}${address.capture.note ? `; ${address.capture.note}` : ""}`,
  });
  const addressClaimId = "gis:claim:geocoded-address";
  claims.push({
    id: addressClaimId,
    kind: "claim",
    subjectNodeId: options.propertyId,
    predicate: "geocoded-address",
    value: { type: "qualitative", text: `${address.matchedAddress} (${address.geocodeType})` },
    origin: { kind: "SOURCE_DERIVED" },
    sourceIds: [censusArtifactId],
    evidenceState: "SOURCE_CONFIRMED",
    verbatimQuote: `matchedAddress: "${address.matchedAddress}"; point [lon,lat] ${address.point.join(", ")}`,
    notes: "geocoder candidate — street-range interpolated point, a HINT not parcel identity",
  });

  // --- Parcels (official PWD geometry; recorded vs computed area separate) --
  const parcels: CommitResolvedSiteInput["parcels"] = chosen.map((candidate, index) => {
    const parcelId = `gis:parcel:${candidate.brtId ?? candidate.parcelId}`;
    const artifactId = `gis:src:${candidate.capture.providerId}:${candidate.capture.rawContentHash.slice(0, 12)}`;
    if (!sourceArtifacts.some((artifact) => artifact.id === artifactId)) {
      sourceArtifacts.push({
        id: artifactId,
        kind: "source-artifact",
        logicalSourceKey: `gis:src:${candidate.capture.providerId}`,
        version: 1,
        sourceType: "official_gis",
        title: `${candidate.capture.provider} — parcel candidates`,
        publisher: candidate.capture.provider,
        canonicalUrl: candidate.capture.canonicalQuery,
        authority: candidate.capture.authority,
        retrievedAt: candidate.capture.retrievedAt,
        rawContentHash: candidate.capture.rawContentHash,
        rawEvidenceRef: candidate.capture.rawEvidenceRef,
        notes: `capture mode ${candidate.capture.mode}${candidate.capture.note ? `; ${candidate.capture.note}` : ""}`,
      });
    }
    const geometryClaimId = `gis:claim:parcel-geometry:${candidate.brtId ?? candidate.parcelId}`;
    const validity = checkValidity(candidate.geometry);
    claims.push({
      id: `gis:claim:parcel-id:${candidate.brtId ?? candidate.parcelId}`,
      kind: "claim",
      subjectNodeId: parcelId,
      predicate: "parcel-source-id",
      value: {
        type: "qualitative",
        text: `${candidate.parcelIdSystem} ${candidate.parcelId}${candidate.brtId ? `; BRT ${candidate.brtId}` : ""}`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [artifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `brt_id: ${candidate.brtId ?? "n/a"}; parcelid: ${candidate.parcelId}`,
    });
    claims.push({
      id: geometryClaimId,
      kind: "claim",
      subjectNodeId: parcelId,
      predicate: "parcel-geometry",
      value: {
        type: "qualitative",
        text: `${validity.validity === "valid" ? "validated" : "INVALID"} WGS84 polygon from the official parcel service (match reasons: ${candidate.matchReasons.join(", ")})`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [artifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `owner1: "${candidate.ownerName ?? "n/a"}"; address: "${candidate.address ?? "n/a"}"`,
      notes: validity.validity === "invalid" ? `geometry problems: ${validity.problems.join("; ")}` : undefined,
    });
    if (candidate.ownerName) {
      claims.push({
        id: `gis:claim:owner:${candidate.brtId ?? candidate.parcelId}`,
        kind: "claim",
        subjectNodeId: parcelId,
        predicate: "owner-of-record",
        value: { type: "qualitative", text: candidate.ownerName },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [artifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `owner1: "${candidate.ownerName}"`,
      });
    }
    return {
      id: parcelId,
      parcelIdSystem: candidate.parcelIdSystem,
      parcelNumber: candidate.brtId ?? candidate.parcelId,
      geometry: {
        geojson: candidate.geometry,
        crs: "EPSG:4326",
        validity: validity.validity,
        derived: false,
        sourceClaimId: geometryClaimId,
      },
      recordedArea: candidate.recordedAreaSqFt
        ? { value: candidate.recordedAreaSqFt, unit: "sq_ft" as const }
        : undefined,
      computedAreas: [{ method: "turf geodesic (WGS84 ellipsoid)", valueSqFt: computedAreaSqFt(candidate.geometry) }],
      claimIds: [
        `gis:claim:parcel-id:${candidate.brtId ?? candidate.parcelId}`,
        geometryClaimId,
        ...(candidate.ownerName ? [`gis:claim:owner:${candidate.brtId ?? candidate.parcelId}`] : []),
      ],
      notes: index === 0 ? undefined : "additional campus parcel (user-confirmed)",
    };
  });

  // --- Structures (official footprint layer; attributes stay separate) ------
  const structures: CommitResolvedSiteInput["structures"] = session.structures.map((record) => {
    const artifactId = `gis:src:${record.capture.providerId}:${record.capture.rawContentHash.slice(0, 12)}`;
    if (!sourceArtifacts.some((artifact) => artifact.id === artifactId)) {
      sourceArtifacts.push({
        id: artifactId,
        kind: "source-artifact",
        logicalSourceKey: `gis:src:${record.capture.providerId}`,
        version: 1,
        sourceType: "official_gis",
        title: `${record.capture.provider} — building footprints`,
        publisher: record.capture.provider,
        canonicalUrl: record.capture.canonicalQuery,
        authority: record.capture.authority,
        retrievedAt: record.capture.retrievedAt,
        rawContentHash: record.capture.rawContentHash,
        rawEvidenceRef: record.capture.rawEvidenceRef,
        notes: `capture mode ${record.capture.mode}${record.capture.note ? `; ${record.capture.note}` : ""}`,
      });
    }
    const footprintClaimId = `gis:claim:footprint:${record.structureId}`;
    claims.push({
      id: footprintClaimId,
      kind: "claim",
      subjectNodeId: `gis:structure:${record.structureId}`,
      predicate: "structure-footprint",
      value: {
        type: "qualitative",
        text: `${record.buildingName ?? "mapped structure"} — official footprint polygon${record.approxHeightFt ? ` (~${record.approxHeightFt} ft approx height)` : ""}`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [artifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `bin: ${record.structureId}${record.buildingName ? `; building_name: "${record.buildingName}"` : ""}`,
      notes: "footprint proves mapped geometry only — occupancy/use/sanctuary identity remain unknown without church declaration",
    });
    return {
      id: `gis:structure:${record.structureId}`,
      parcelId: parcels[0].id,
      footprint: {
        geojson: record.footprint,
        crs: "EPSG:4326",
        validity: checkValidity(record.footprint).validity,
        derived: false,
        sourceClaimId: footprintClaimId,
      },
      attributeClaimIds: [footprintClaimId],
    };
  });

  // --- Jurisdiction / zoning assignment (method-scoped) --------------------
  let jurisdiction: CommitResolvedSiteInput["jurisdiction"] | undefined;
  if (session.zoning) {
    const zoningArtifactId = `gis:src:${session.zoning.capture.providerId}:${session.zoning.capture.rawContentHash.slice(0, 12)}`;
    if (!sourceArtifacts.some((artifact) => artifact.id === zoningArtifactId)) {
      sourceArtifacts.push({
        id: zoningArtifactId,
        kind: "source-artifact",
        logicalSourceKey: `gis:src:${session.zoning.capture.providerId}`,
        version: 1,
        sourceType: "official_gis",
        title: `${session.zoning.capture.provider} — zoning assignment`,
        publisher: session.zoning.capture.provider,
        canonicalUrl: session.zoning.capture.canonicalQuery,
        authority: session.zoning.capture.authority,
        retrievedAt: session.zoning.capture.retrievedAt,
        rawContentHash: session.zoning.capture.rawContentHash,
        rawEvidenceRef: session.zoning.capture.rawEvidenceRef,
        notes: `capture mode ${session.zoning.capture.mode}${session.zoning.capture.note ? `; ${session.zoning.capture.note}` : ""}`,
      });
    }
    const zoningClaimId = "gis:claim:zoning-district";
    claims.push({
      id: zoningClaimId,
      kind: "claim",
      subjectNodeId: parcels[0].id,
      predicate: "zoning-district",
      value: {
        type: "qualitative",
        text: `${session.zoning.baseDistrictLong ?? session.zoning.baseDistrict}${session.zoning.overlays.length > 0 ? ` + overlays (${session.zoning.overlays.map((o) => o.name).join("; ")})` : ""}`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [zoningArtifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `base district: ${session.zoning.baseDistrict}; method: ${session.zoning.method}`,
      notes: "zoning ASSIGNMENT from the official layer; regulatory interpretation is issue #5",
    });
    jurisdiction = {
      id: "gis:jurisdiction:assignment",
      jurisdiction: { city: "Philadelphia", state: "PA", country: "US" },
      method: session.zoning.method,
      claimIds: [zoningClaimId],
    };
  }

  const primary = chosen[0];
  return {
    projectId: options.projectId,
    property: {
      id: options.propertyId,
      displayName: primary.ownerName ?? primary.address ?? session.query,
      primaryParcelId: `gis:parcel:${primary.brtId ?? primary.parcelId}`,
      parcelIds: chosen.map((candidate) => `gis:parcel:${candidate.brtId ?? candidate.parcelId}`),
      addressText: address.matchedAddress,
    },
    sourceArtifacts,
    claims,
    parcels,
    structures,
    jurisdiction,
    ownerOfRecordClaimId: primary.ownerName
      ? `gis:claim:owner:${primary.brtId ?? primary.parcelId}`
      : undefined,
    summary: `GIS site resolution of "${session.query}" (${chosen.length} parcel${chosen.length > 1 ? "s" : ""}, user-confirmed)`,
    actor: options.actor,
    now: options.now,
    correlationId: session.sessionId,
  };
}

export function commitSession(
  session: ResolutionSession,
  options: { projectId: string; propertyId: string; actor: string; now: string },
) {
  const plan = buildCommitPlan(session, options);
  return { plan, project: commitResolvedSite(plan) };
}
