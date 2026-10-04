import { describe, expect, it } from "vitest";
import { nodesOfKind, requireNode, getEvidenceChain, canonicalJson } from "../../src/domain";
import { Quantity } from "../../src/domain/units/quantity";
import {
  seedPhiladelphiaProject,
  seedWithBalanceScenario,
  PARKING_CONSTRAINT_ID,
} from "./helpers";

describe("benchmark mapping: canonical Philadelphia fixture", () => {
  const project = seedPhiladelphiaProject();

  it("maps property identity, parcel geometry, CRS, and recorded-vs-computed areas", () => {
    const parcel = requireNode(project, "phl:parcel:778273000", "parcel");
    expect(parcel.geometry.crs).toBe("EPSG:4326");
    expect(parcel.geometry.validity).toBe("unchecked");
    expect(parcel.geometry.derived).toBe(false);
    expect(parcel.recordedArea).toEqual({ value: 119295, unit: "sq_ft" });
    const methods = parcel.computedAreas.map((area) => area.method);
    expect(methods.some((method) => method.includes("postgis-geodesic"))).toBe(true);
    expect(methods.some((method) => method.includes("equirectangular"))).toBe(true);
    const property = requireNode(project, "phl:property:calvary-memorial", "property");
    expect(property.address?.note).toBe("display-only; not project identity");
  });

  it("maps all 13 manifest sources with authority and versioned identity", () => {
    const sources = nodesOfKind(project, "source-artifact");
    expect(sources).toHaveLength(13);
    for (const source of sources) {
      expect(source.id).toMatch(/^phl:src:S\d+@v1$/);
      expect(source.logicalSourceKey).toMatch(/^phl:src:S\d+$/);
      expect(source.version).toBe(1);
      expect(source.rawContentHash === undefined || /^[0-9a-f]{64}$/.test(source.rawContentHash)).toBe(true);
    }
    const s7 = requireNode(project, "phl:src:S7@v1", "source-artifact");
    expect(s7.authority).toBe("ADOPTED_CODE");
    expect(s7.rawEvidenceRef).toContain("code-14-802-excerpt.md");
    expect(s7.rawContentHash).toBeDefined();
  });

  it("maps the RM-1 zoning claim and jurisdiction assignment (one sourced truth)", () => {
    const jurisdiction = requireNode(project, "phl:jurisdiction:philadelphia", "jurisdiction");
    // Normalization: the district assertion is a Claim, not an entity field.
    expect("zoningDistrict" in jurisdiction).toBe(false);
    const zoningClaim = requireNode(project, "phl:claim:zoning-district", "claim");
    expect(zoningClaim.value).toEqual({ type: "qualitative", text: "RM-1" });
    expect(zoningClaim.evidenceState).toBe("SOURCE_CONFIRMED");
    expect(jurisdiction.claimIds).toContain("phl:claim:zoning-district");
  });

  it("maps multifamily use, parking = 0 (VERIFIED), and the /SIX ADU prohibition", () => {
    const useConstraint = requireNode(project, "phl:constraint:use-multifamily", "constraint");
    expect(useConstraint.constraintKind).toBe("use-permission");
    if (useConstraint.constraintKind === "use-permission") {
      expect(useConstraint.permission).toBe("BY_RIGHT");
    }
    const parkingClaim = requireNode(project, "phl:claim:parking-multifamily", "claim");
    expect(parkingClaim.evidenceState).toBe("VERIFIED");
    expect(parkingClaim.value).toEqual({
      type: "quantity",
      quantity: { value: 0, unit: "spaces" },
    });
    const parkingConstraint = requireNode(project, PARKING_CONSTRAINT_ID, "constraint");
    if (parkingConstraint.constraintKind === "parking-requirement") {
      expect(parkingConstraint.use).toBe("multi-family");
      expect(parkingConstraint.requirement).toEqual({
        type: "fixed",
        spaces: { value: 0, unit: "spaces" },
      });
    }
    const adu = requireNode(project, "phl:constraint:overlay-six-adu-prohibition", "constraint");
    if (adu.constraintKind === "overlay-prohibition") {
      expect(adu.overlay).toBe("/SIX");
      expect(adu.prohibits).toBe("accessory-dwelling-units");
    }
  });

  it("maps the religious-assembly parking rule as an unevaluated formula constraint", () => {
    const constraint = requireNode(project, "phl:constraint:parking-religious-assembly", "constraint");
    if (constraint.constraintKind === "parking-requirement") {
      expect(constraint.requirement.type).toBe("formula");
      expect(constraint.requirement.type === "formula" && constraint.requirement.text).toContain("1/10 seats");
    }
  });

  it("maps dimensional constraints: height, setbacks (numeric/range/contextual), occupied area, density", () => {
    const height = requireNode(project, "phl:constraint:height-max", "constraint");
    if (height.constraintKind === "height") {
      expect(Quantity.parse(height.limit)).toEqual({ value: 38, unit: "ft" });
    }
    const rear = requireNode(project, "phl:constraint:setback-rear", "constraint");
    if (rear.constraintKind === "setback" && rear.spec.type === "numeric") {
      expect(rear.spec.min).toEqual({ value: 9, unit: "ft" });
    }
    const side = requireNode(project, "phl:constraint:setback-side", "constraint");
    if (side.constraintKind === "setback" && side.spec.type === "range") {
      expect(side.spec.range).toEqual({ min: 5, max: 12, unit: "ft" });
    }
    const front = requireNode(project, "phl:constraint:setback-front", "constraint");
    if (front.constraintKind === "setback") {
      expect(front.spec.type).toBe("contextual");
    }
    const occupied = requireNode(project, "phl:constraint:occupied-area-max", "constraint");
    if (occupied.constraintKind === "occupied-area") {
      expect(occupied.byLotType).toEqual({ intermediate: 75, corner: 80 });
    }
    const density = requireNode(project, "phl:constraint:density-formula", "constraint");
    if (density.constraintKind === "density") {
      expect(density.spec.tiers).toEqual([
        { firstSqFt: 1440, perUnit: 360 },
        { firstSqFt: 1440, perUnit: 480 },
      ]);
      expect(density.spec.rounding).toBe("down");
    }
  });

  it("preserves VERIFIED vs SOURCE_CONFIRMED vs UNKNOWN exactly as the fixture records them", () => {
    const claims = nodesOfKind(project, "claim");
    const verified = claims.filter((claim) => claim.evidenceState === "VERIFIED");
    const confirmed = claims.filter((claim) => claim.evidenceState === "SOURCE_CONFIRMED");
    const unknown = claims.filter((claim) => claim.evidenceState === "UNKNOWN");
    expect(verified.length).toBeGreaterThanOrEqual(4); // parking x2 + /SIX x2
    expect(confirmed.length).toBeGreaterThan(10);
    expect(unknown.map((claim) => claim.id)).toEqual(["phl:claim:far"]);
  });

  it("FAR stays UNKNOWN: no FAR regulation, no FAR constraint, no default value", () => {
    const farClaim = requireNode(project, "phl:claim:far", "claim");
    expect(farClaim.value).toEqual({ type: "null", reason: "unknown" });
    expect(farClaim.evidenceState).toBe("UNKNOWN");
    const farRegulations = nodesOfKind(project, "regulation").filter((regulation) =>
      regulation.claimIds.includes("phl:claim:far"),
    );
    expect(farRegulations).toHaveLength(0);
    const farConstraints = nodesOfKind(project, "constraint").filter(
      (constraint) =>
        constraint.constraintKind === "height" ? false : JSON.stringify(constraint).toLowerCase().includes("far"),
    );
    expect(farConstraints).toHaveLength(0);
  });

  it("maps all 14 open questions as expert-review items with severity semantics", () => {
    const reviews = nodesOfKind(project, "expert-review");
    expect(reviews).toHaveLength(14);
    expect(reviews.every((review) => review.reviewStatus === "OPEN")).toBe(true);
    const farReview = reviews.find((review) => review.id === "phl:review:oq-far-confirmation");
    expect(farReview?.affectedNodeIds).toContain("phl:claim:far");
    const expertRequired = reviews.filter((review) => review.severity === "blocking");
    const unknownKind = reviews.filter((review) => review.severity === "non-blocking");
    expect(expertRequired.length).toBeGreaterThan(0);
    expect(unknownKind.length).toBeGreaterThan(0);
  });

  it("normalization: sourced attributes are not duplicated on identity entities", () => {
    const structure = requireNode(project, "phl:structure:bin-1282177", "structure");
    expect("heightApprox" in structure).toBe(false);
    expect("buildingCodeDescription" in structure).toBe(false);
    expect(structure.attributeClaimIds).toContain("phl:claim:building-name");
    expect(structure.attributeClaimIds).toContain("phl:claim:building-use");
    expect(structure.attributeClaimIds).toContain("phl:claim:site-building");
  });

  it("full provenance chain: parking constraint traces to the §14-802 source artifact and raw evidence", () => {
    const chain = getEvidenceChain(project, PARKING_CONSTRAINT_ID);
    const flat = JSON.stringify(chain);
    expect(flat).toContain("phl:reg:parking-multifamily");
    expect(flat).toContain("phl:claim:parking-multifamily");
    expect(flat).toContain("phl:src:S7@v1");
    expect(chain.rawEvidenceRef).toBeUndefined(); // on the artifact, not the constraint
    // Walk to the artifact explicitly.
    const artifact = requireNode(project, "phl:src:S7@v1", "source-artifact");
    expect(artifact.rawEvidenceRef).toContain("code-14-802-excerpt.md");
  });

  it("records one benchmark.imported event covering every node", () => {
    const imported = project.events.filter((event) => event.eventType === "benchmark.imported");
    expect(imported).toHaveLength(1);
    expect(imported[0].affectedNodeIds.length).toBe(Object.keys(project.nodes).length);
  });

  it("is deterministic: identical fixtures import to identical canonical JSON", () => {
    const first = seedPhiladelphiaProject();
    const second = seedPhiladelphiaProject();
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });
});

describe("benchmark mapping with scenario (contract prerequisites)", () => {
  it("seeds a scenario whose certificate is CURRENT before any mutation", () => {
    const project = seedWithBalanceScenario();
    const certificate = requireNode(project, "scenario:balance:certificate", "scenario-certificate");
    expect(certificate.freshness).toBe("CURRENT");
  });
});
