import { commitResolvedSite, type CommitResolvedSiteInput } from "../../commands/site";
import { checkValidity, computedAreaSqFt } from "../../adapters/gis/geometry";
import type { CaptureMetadata } from "../../adapters/gis";
import type { ResolutionSession } from "./state";

/**
 * Session → atomic commit plan (issue #4). Only a CONFIRMED session may become
 * graph truth: userConfirmedProperty must be true and confirmed parcels must
 * exist. Half-resolved sessions are rejected loudly. All graph writes flow
 * through commitResolvedSite's staged, integrity-validated mutation boundary.
 *
 * Per-parcel provenance: every context fact (zoning-base, zoning-overlays,
 * flood, historic, RCO, structures) gets its OWN claim + source artifact.
 * A zoning-base claim is never sourced by an overlay response.
 */

export class IncompleteSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteSessionError";
  }
}

export class InvalidGeometryError extends Error {
  constructor(parcelId: string, problems: string[]) {
    super(
      `parcel ${parcelId} has invalid geometry (${problems.join("; ")}); ` +
      "ordinary confirmation cannot commit invalid geometry — an explicit override is required",
    );
    this.name = "InvalidGeometryError";
  }
}

function artifactFor(capture: CaptureMetadata) {
  return {
    id: `gis:src:${capture.logicalCaptureKey}:${capture.rawContentHash.slice(0, 12)}`,
    kind: "source-artifact" as const,
    logicalSourceKey: `gis:src:${capture.logicalCaptureKey}`,
    version: 1,
    sourceType: "official_gis" as const,
    title: capture.provider,
    publisher: capture.provider,
    canonicalUrl: capture.canonicalQuery,
    authority: capture.authority,
    retrievedAt: capture.retrievedAt,
    rawContentHash: capture.rawContentHash,
    rawEvidenceRef: capture.rawEvidenceRef,
    notes: `capture mode ${capture.mode}${capture.note ? `; ${capture.note}` : ""}`,
  };
}

export function buildCommitPlan(
  session: ResolutionSession,
  options: {
    projectId: string;
    propertyId: string;
    actor: string;
    now: string;
    allowInvalidGeometry?: boolean;
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

  // B8: invalid geometry gate
  if (!options.allowInvalidGeometry) {
    for (const parcel of chosen) {
      const verdict = checkValidity(parcel.geometry);
      if (verdict.validity === "invalid") {
        throw new InvalidGeometryError(
          parcel.brtId ?? parcel.parcelId,
          verdict.problems,
        );
      }
    }
  }

  const sourceArtifacts: CommitResolvedSiteInput["sourceArtifacts"] = [];
  const claims: CommitResolvedSiteInput["claims"] = [];
  const artifactByKey = new Map<string, CommitResolvedSiteInput["sourceArtifacts"][number]>();
  function ensureArtifact(capture: CaptureMetadata): string {
    const artifact = artifactFor(capture);
    if (!artifactByKey.has(artifact.logicalSourceKey)) {
      artifactByKey.set(artifact.logicalSourceKey, artifact);
      sourceArtifacts.push(artifact);
    }
    return artifactByKey.get(artifact.logicalSourceKey)!.id;
  }

  // --- Address (Census hint) ---
  const censusArtifactId = ensureArtifact(address.capture);
  claims.push({
    id: "gis:claim:geocoded-address",
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

  // --- Parcels + per-parcel context ---
  const parcels: CommitResolvedSiteInput["parcels"] = [];
  const structures: CommitResolvedSiteInput["structures"] = [];
  const jurisdictions: CommitResolvedSiteInput["jurisdiction"][] = [];

  for (const candidate of chosen) {
    const parcelKey = candidate.brtId ?? candidate.parcelId;
    const parcelNodeId = `gis:parcel:${parcelKey}`;
    const parcelArtifactId = ensureArtifact(candidate.capture);
    const validity = checkValidity(candidate.geometry);

    // Parcel id claim
    claims.push({
      id: `gis:claim:parcel-id:${parcelKey}`,
      kind: "claim",
      subjectNodeId: parcelNodeId,
      predicate: "parcel-source-id",
      value: {
        type: "qualitative",
        text: `${candidate.parcelIdSystem} ${candidate.parcelId}${candidate.brtId ? `; BRT ${candidate.brtId}` : ""}`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [parcelArtifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `brt_id: ${candidate.brtId ?? "n/a"}; parcelid: ${candidate.parcelId}`,
    });

    // Parcel geometry claim
    const geometryClaimId = `gis:claim:parcel-geometry:${parcelKey}`;
    claims.push({
      id: geometryClaimId,
      kind: "claim",
      subjectNodeId: parcelNodeId,
      predicate: "parcel-geometry",
      value: {
        type: "qualitative",
        text: `${validity.validity === "valid" ? "validated" : "INVALID"} WGS84 polygon from the official parcel service (match reasons: ${candidate.matchReasons.join(", ")})`,
      },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: [parcelArtifactId],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `owner1: "${candidate.ownerName ?? "n/a"}"; address: "${candidate.address ?? "n/a"}"`,
      notes: validity.validity === "invalid" ? `geometry problems: ${validity.problems.join("; ")}` : undefined,
    });

    // Owner claim
    if (candidate.ownerName) {
      claims.push({
        id: `gis:claim:owner:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "owner-of-record",
        value: { type: "qualitative", text: candidate.ownerName },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [parcelArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `owner1: "${candidate.ownerName}"`,
      });
    }

    parcels.push({
      id: parcelNodeId,
      parcelIdSystem: candidate.parcelIdSystem,
      parcelNumber: parcelKey,
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
        `gis:claim:parcel-id:${parcelKey}`,
        geometryClaimId,
        ...(candidate.ownerName ? [`gis:claim:owner:${parcelKey}`] : []),
      ],
    });

    // --- Per-parcel context (from ResolvedParcelContext) ---
    const context = session.parcelContexts.find((c) => c.parcelId === parcelKey);
    if (!context) continue;

    // Zoning base — its OWN claim + artifact (never sourced by overlay response)
    if (context.zoningBase) {
      const baseArtifactId = ensureArtifact(context.zoningBase.capture);
      claims.push({
        id: `gis:claim:zoning-base:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "zoning-district",
        value: {
          type: "qualitative",
          text: context.zoningBase.districtLong ?? context.zoningBase.district,
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [baseArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `base district: ${context.zoningBase.district}; method: ${context.zoningBase.method}`,
        notes: "zoning base district assignment; regulatory interpretation is issue #5",
      });
      jurisdictions.push({
        id: `gis:jurisdiction:${parcelKey}`,
        jurisdiction: { city: "Philadelphia", state: "PA", country: "US" },
        method: context.zoningBase.method,
        claimIds: [`gis:claim:zoning-base:${parcelKey}`],
      });
    }

    // Zoning overlays — its OWN claim + artifact (never sourced by base response)
    if (context.zoningOverlays && context.zoningOverlays.overlays.length > 0) {
      const overlayArtifactId = ensureArtifact(context.zoningOverlays.capture);
      claims.push({
        id: `gis:claim:zoning-overlays:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "zoning-overlays",
        value: {
          type: "qualitative",
          text: context.zoningOverlays.overlays.map((o) => o.name).join("; "),
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [overlayArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `overlays: ${context.zoningOverlays.overlays.map((o) => o.name).join("; ")}; method: ${context.zoningOverlays.method}`,
        notes: "overlay assignments from the separate official overlay layer",
      });
    }

    // Structures — each keeps its parcel association
    for (const structure of context.structures) {
      const structureArtifactId = ensureArtifact(structure.capture);
      const footprintClaimId = `gis:claim:footprint:${structure.structureId}`;
      claims.push({
        id: footprintClaimId,
        kind: "claim",
        subjectNodeId: `gis:structure:${structure.structureId}`,
        predicate: "structure-footprint",
        value: {
          type: "qualitative",
          text: `${structure.buildingName ?? "mapped structure"} — official footprint polygon${structure.approxHeightFt ? ` (~${structure.approxHeightFt} ft approx height)` : ""}`,
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [structureArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `bin: ${structure.structureId}${structure.buildingName ? `; building_name: "${structure.buildingName}"` : ""}`,
        notes: "footprint proves mapped geometry only — occupancy/use/sanctuary identity remain unknown without church declaration",
      });
      structures.push({
        id: `gis:structure:${structure.structureId}`,
        parcelId: parcelNodeId,
        footprint: {
          geojson: structure.footprint,
          crs: "EPSG:4326",
          validity: checkValidity(structure.footprint).validity,
          derived: false,
          sourceClaimId: footprintClaimId,
        },
        attributeClaimIds: [footprintClaimId],
      });
    }

    // Flood — its OWN claim + artifact
    if (context.flood) {
      const floodArtifactId = ensureArtifact(context.flood.capture);
      claims.push({
        id: `gis:claim:flood:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "site-flood",
        value: {
          type: "qualitative",
          text: context.flood.zone
            ? `FEMA zone ${context.flood.zone}${context.flood.description ? ` — ${context.flood.description}` : ""}`
            : "no flood zone data at sampled point",
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [floodArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `fld_zone: ${context.flood.zone ?? "n/a"}; method: ${context.flood.method}`,
      });
    }

    // Historic — its OWN claim + artifact
    if (context.historic) {
      const historicArtifactId = ensureArtifact(context.historic.capture);
      claims.push({
        id: `gis:claim:historic:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "site-historic-screen",
        value: {
          type: "qualitative",
          text: context.historic.districtFeature ?? "no local historic district feature at the sampled point",
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [historicArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `method: ${context.historic.method}; features: ${context.historic.districtFeature ? "present" : "absent"}`,
      });
    }

    // RCO — its OWN claim + artifact
    if (context.rco && context.rco.names.length > 0) {
      const rcoArtifactId = ensureArtifact(context.rco.capture);
      claims.push({
        id: `gis:claim:rco:${parcelKey}`,
        kind: "claim",
        subjectNodeId: parcelNodeId,
        predicate: "rco-coverage",
        value: { type: "qualitative", text: context.rco.names.join("; ") },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: [rcoArtifactId],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `rco names: ${context.rco.names.join("; ")}; method: ${context.rco.method}`,
      });
    }
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
    jurisdiction: jurisdictions[0],
    ownerOfRecordClaimId: primary.ownerName
      ? `gis:claim:owner:${primary.brtId ?? primary.parcelId}`
      : undefined,
    summary: `GIS site resolution of "${session.query}" (${chosen.length} parcel${chosen.length > 1 ? "s" : ""}, user-confirmed; ${session.parcelContexts.flatMap((c) => c.failures).length} context gap${session.parcelContexts.flatMap((c) => c.failures).length === 1 ? "" : "s"})`,
    actor: options.actor,
    now: options.now,
    correlationId: session.sessionId,
  };
}

export function commitSession(
  session: ResolutionSession,
  options: { projectId: string; propertyId: string; actor: string; now: string; allowInvalidGeometry?: boolean },
) {
  const plan = buildCommitPlan(session, options);
  return { plan, project: commitResolvedSite(plan) };
}
