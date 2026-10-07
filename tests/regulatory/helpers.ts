import { createHash } from "node:crypto";
import type { SourceMetadata } from "../../src/application/regulatory/extraction";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import type { Project } from "../../src/domain/graph/project";
import { nodeWithMeta } from "../../src/domain/graph/node";

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
          : authority === "OFFICIAL_CITY_TOOL"
            ? "official_city_tool"
            : "official_city_reference",
    title: `Test source ${overrides.sourceRef}`,
    publisher: "Test City",
    canonicalUrl: `https://test.example/${overrides.sourceRef}`,
    authority,
    retrievedAt: "2026-01-01T00:00:00Z",
    rawContentHash: digest,
    rawEvidenceRefs: [`raw/${overrides.sourceRef}.md`],
    ...overrides,
  };
}

export function heightCandidate(
  sourceRef: string,
  feet: number,
  overrides: Partial<CandidateRule> = {},
): CandidateRule {
  return {
    candidateId: `cand:height:max:principal:${sourceRef}`,
    semanticRuleKey: "height:max:principal",
    sourceArtifactId: `phl:src:${sourceRef}@v1`,
    sourceRef,
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
    candidateId: `cand:use:multi-family:permission:${sourceRef}`,
    semanticRuleKey: "use:multi-family:permission",
    sourceArtifactId: `phl:src:${sourceRef}@v1`,
    sourceRef,
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
  return {
    projectId,
    schemaVersion: "acrevia.graph.v1",
    revision: 0,
    propertyId: PROPERTY_ID,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    nodes: { [PROPERTY_ID]: property, [PARCEL]: parcel },
    edges: [],
    events: [],
  } as unknown as Project;
}
