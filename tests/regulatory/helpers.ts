import { createHash } from "node:crypto";
import type { SourceMetadata } from "../../src/application/regulatory/extraction";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import type { Project } from "../../src/domain/graph/project";
import { nodeWithMeta } from "../../src/domain/graph/node";
import { addEdge } from "../../src/domain/graph/project";
import type { RawEvidenceDocument } from "../../src/application/regulatory/extraction";

/** Shared regulatory test fixtures (issue #5 review regressions). */

export const PARCEL = "phl:parcel:778273000";

export function testSource(overrides: Partial<SourceMetadata> & { sourceRef: string }): SourceMetadata {
  const authority = overrides.authority ?? "OFFICIAL_CITY_REFERENCE";
  const digest = createHash("sha256").update(`${overrides.sourceRef}:test-bytes`).digest("hex");
  return {
    sourceArtifactId: `phl:src:${overrides.sourceRef}@v1`,
    logicalSourceKey: `phl:src:${overrides.sourceRef}`,
    version: 1,
    sourceType:
      authority === "ADOPTED_CODE"
        ? "adopted_code"
        : authority === "OFFICIAL_GIS"
          ? "official_gis"
          : "official_city_reference",
    title: `Test source ${overrides.sourceRef}`,
    publisher: "Test City",
    canonicalUrl: `https://test.example/${overrides.sourceRef}`,
    rawContentHash: digest,
    rawEvidenceRefs: [`raw/${overrides.sourceRef}.md`],
    authority,
    retrievedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function heightCandidate(
  sourceRef: string,
  feet: number,
  overrides: Partial<CandidateRule> = {},
): CandidateRule {
  return {
    candidateId: `cand:height:max:principal:phl:src:${sourceRef}@v1`,
    semanticRuleKey: "height:max:principal",
    sourceArtifactId: `phl:src:${sourceRef}@v1`,
    sourceRef,
    evidenceAnchor: {
      documentId: `${sourceRef}.md`,
      exactText: overrides.verbatimSupportingText ?? `maximum building height ... ${feet} ft`,
    },
    subjectNodeId: PARCEL,
    jurisdictionKey: "philadelphia-pa",
    predicate: "max-height",
    proposedValue: { kind: "quantity", value: feet, unit: "ft" },
    applicability: { district: "RM-1" },
    codeSection: "§ test-1",
    verbatimSupportingText: `maximum building height ... ${feet} ft`,
    authority: sourceRef === "A2" || sourceRef === "S7" ? "ADOPTED_CODE" : "OFFICIAL_CITY_REFERENCE",
    retrievedAt: "2026-01-01T00:00:00Z",
    extractionMethod: "test",
    ...overrides,
  };
}

export function useCandidate(
  sourceRef: string,
  permissionText: string,
  overrides: Partial<CandidateRule> = {},
): CandidateRule {
  return {
    candidateId: `cand:use:multi-family:permission:phl:src:${sourceRef}@v1`,
    semanticRuleKey: "use:multi-family:permission",
    sourceArtifactId: `phl:src:${sourceRef}@v1`,
    sourceRef,
    evidenceAnchor: {
      documentId: `${sourceRef}.md`,
      exactText: `| Multi-Family | ${permissionText} |`,
    },
    subjectNodeId: PARCEL,
    jurisdictionKey: "philadelphia-pa",
    predicate: "use-permission",
    proposedValue: { kind: "qualitative", text: permissionText },
    applicability: { district: "RM-1", use: "multi-family" },
    codeSection: "§ test-use",
    verbatimSupportingText: `Multi-Family | ${permissionText}`,
    authority: "OFFICIAL_GIS",
    retrievedAt: "2026-01-01T00:00:00Z",
    extractionMethod: "test",
    ...overrides,
  };
}

export const FIXED_NOW = "2026-10-08T00:00:00.000Z";
export const PROPERTY_ID = "test:property:regulatory";

/** A raw-capture document per test source, carrying each candidate's anchor
 *  text verbatim so the verifier can independently resolve evidence. */
export function testDocuments(sourceRefs: string[], texts: Record<string, string> = {}): RawEvidenceDocument[] {
  return sourceRefs.map((sourceRef) => ({
    documentId: `${sourceRef}.md`,
    sourceRef,
    kind: "code-text" as const,
    text: texts[sourceRef] ?? "",
  }));
}

/** Build capture text containing the anchors heightCandidate/useCandidate emit. */
export function captureTextFor(entries: Array<{ feet?: number; permission?: string }>): string {
  return entries
    .map((e) =>
      e.permission
        ? `Multi-Family | ${e.permission}`
        : `maximum building height ... ${e.feet} ft`,
    )
    .join("\n");
}

export const ZONING_BASE_CLAIM = `gis:claim:zoning-base:778273000`;
export const OVERLAY_CLAIM = `gis:claim:zoning-overlays:778273000`;

/** The accepted property's own signed-GIS applicability claims (as the
 *  rebuilt GIS project would contain them). */
function applicabilityClaims(now: string, district = "RM-1") {
  return [
    nodeWithMeta(
      {
        id: ZONING_BASE_CLAIM,
        kind: "claim" as const,
        subjectNodeId: PARCEL,
        predicate: "zoning-district",
        value: { type: "qualitative", text: district },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: ["gis:src:zoning-base"],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: `zoning: "${district}"`,
      },
      now,
    ),
    nodeWithMeta(
      {
        id: OVERLAY_CLAIM,
        kind: "claim" as const,
        subjectNodeId: PARCEL,
        predicate: "zoning-overlays",
        value: {
          type: "qualitative",
          text: "/SIX Sixth District Overlay District; /NIS Narcotics Injection Sites Overlay District; Accessory Sign Controls - Special Controls for Cobbs Creek, Roosevelt Boulevard, and Department of Parks and Recreation Land; Use-Specific Standards - Child Care - Family Child Care - Area 1 and Area 2",
        },
        origin: { kind: "SOURCE_DERIVED" },
        sourceIds: ["gis:src:zoning-overlays"],
        evidenceState: "SOURCE_CONFIRMED",
        verbatimQuote: "layer features: overlay_name x4",
      },
      now,
    ),
    nodeWithMeta(
      {
        id: "gis:src:zoning-base",
        kind: "source-artifact" as const,
        logicalSourceKey: "gis:src:zoning-base",
        version: 1,
        sourceType: "official_gis" as const,
        title: "Zoning Base Districts (L&I zoning GIS layer)",
        publisher: "City of Philadelphia",
        canonicalUrl: "https://test.example/zoning-base",
        authority: "OFFICIAL_GIS" as const,
        retrievedAt: "2026-10-04T04:30:00Z",
        rawContentHash: "a".repeat(64),
      },
      now,
    ),
    nodeWithMeta(
      {
        id: "gis:src:zoning-overlays",
        kind: "source-artifact" as const,
        logicalSourceKey: "gis:src:zoning-overlays",
        version: 1,
        sourceType: "official_gis" as const,
        title: "Zoning Overlays (L&I zoning GIS layer)",
        publisher: "City of Philadelphia",
        canonicalUrl: "https://test.example/zoning-overlays",
        authority: "OFFICIAL_GIS" as const,
        retrievedAt: "2026-10-04T04:30:00Z",
        rawContentHash: "b".repeat(64),
      },
      now,
    ),
  ];
}

/** Benchmark-compile tests build the same base under a distinct project id. */
export function makeBenchmarkBase(): Project {
  return bareProject("test:regulatory-benchmark");
}

export function bareProject(projectId = "test:regulatory"): Project {
  const parcel = nodeWithMeta(
    {
      id: PARCEL,
      kind: "parcel" as const,
      parcelIdSystem: "test",
      parcelNumber: "778273000",
      geometry: {
        geojson: {
          type: "Polygon",
          coordinates: [
            [
              [-75.056, 40.043],
              [-75.055, 40.043],
              [-75.055, 40.044],
              [-75.056, 40.044],
              [-75.056, 40.043],
            ],
          ],
        },
        crs: "EPSG:4326",
        validity: "unchecked",
        derived: false,
      },
      claimIds: [],
    },
    FIXED_NOW,
  );
  const property = nodeWithMeta(
    {
      id: PROPERTY_ID,
      kind: "property" as const,
      displayName: "Test Property",
      parcelIds: [PARCEL],
      primaryParcelId: PARCEL,
    },
    FIXED_NOW,
  );
  const applicability = applicabilityClaims(FIXED_NOW);
  const project = {
    projectId,
    schemaVersion: "acrevia.graph.v1",
    revision: 0,
    propertyId: PROPERTY_ID,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    nodes: {
      [PROPERTY_ID]: property,
      [PARCEL]: parcel,
      ...Object.fromEntries(applicability.map((node) => [node.id, node])),
    },
    edges: [] as Array<{ dependentId: string; dependencyId: string; role: string }>,
    events: [],
  } as unknown as Project;
  addEdge(project, { dependentId: ZONING_BASE_CLAIM, dependencyId: "gis:src:zoning-base", role: "supported-by" });
  addEdge(project, { dependentId: OVERLAY_CLAIM, dependencyId: "gis:src:zoning-overlays", role: "supported-by" });
  return project;
}

/** Standard compile inputs for tests: documents + applicability proof. */
export function applicabilityInput() {
  return {
    applicabilityClaims: {
      zoningBaseClaimId: ZONING_BASE_CLAIM,
      overlayClaimIds: [OVERLAY_CLAIM],
    },
  };
}
