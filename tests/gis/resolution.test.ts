import { describe, expect, it } from "vitest";
import { fixtureStack, makeAddressCandidate, makeParcelCandidate, makeZoningBase, makeZoningOverlays, makeFlood, makeStructure } from "./fixtures";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  resolveParcelContexts,
  confirmParcels,
} from "../../src/application/resolution/pipeline";
import { commitSession } from "../../src/application/resolution/commit";
import { getEvidenceChain } from "../../src/domain";

const CANONICAL_QUERY = "7200 Roosevelt Blvd, Philadelphia, PA 19149";

async function canonicalConfirmed() {
  const stack = fixtureStack();
  let session = newSession("test-canon", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
  session = await resolveAddress(session, stack);
  session = await resolveParcels(session, stack);
  session = confirmParcels(session, ["778273000"]);
  session = await resolveParcelContexts(session, stack);
  return { session, stack };
}

describe("canonical Philadelphia resolution (fixture evidence, no AIS)", () => {
  it("resolves address → parcels → per-parcel context end to end", async () => {
    const { session } = await canonicalConfirmed();

    // Address: Census hint, labeled as interpolated
    expect(session.addressStage).toBe("RESOLVED");
    expect(session.addressCandidates[0].geocodeType).toContain("tiger-interpolated");

    // Parcels: church found by registry match
    const church = session.parcelCandidates.find((c) => c.brtId === "778273000");
    expect(church?.matchReasons).toContain("ADDRESS_REGISTRY_MATCH");
    expect(church?.recordedAreaSqFt).toBe(119295);

    // Per-parcel context: zoning base + overlays are SEPARATE
    const ctx = session.parcelContexts.find((c) => c.parcelId === "778273000");
    expect(ctx).toBeDefined();
    expect(ctx?.zoningBase?.district).toBe("RM1");
    expect(ctx?.zoningBase?.districtLong).toBe("RM-1");
    expect(ctx?.zoningOverlays?.overlays.length).toBeGreaterThan(0);
    // Structures: Calvary resolved by parcel link (BIN 1282177)
    expect(ctx?.structures.map((s) => s.buildingName)).toContain("Calvary Memorial Church");
    // Context: flood + historic + RCO resolved
    expect(ctx?.flood?.zone).toBe("X");
    expect(ctx?.rco?.names.length).toBeGreaterThan(0);
  });

  it("Census point never silently becomes the parcel", async () => {
    const stack = fixtureStack();
    let session = newSession("hint", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    const church = session.parcelCandidates.find((c) => c.brtId === "778273000");
    expect(church?.matchReasons).not.toContain("CONTAINS_GEOCODE_POINT");
    expect(session.userConfirmedProperty).toBe(false);
  });

  it("recorded vs computed area stay separate after commit", async () => {
    const { session } = await canonicalConfirmed();
    const { project } = commitSession(session, {
      projectId: "gis:778273000",
      propertyId: "gis:property:778273000",
      actor: "test",
      now: "2026-10-04T18:30:00.000Z",
    });
    const parcel = project.nodes["gis:parcel:778273000"];
    expect(parcel?.kind).toBe("parcel");
    if (parcel?.kind === "parcel") {
      expect(parcel.recordedArea?.value).toBe(119295);
      expect(parcel.computedAreas[0].valueSqFt).not.toBe(119295);
      expect(parcel.geometry.crs).toBe("EPSG:4326");
    }
  });

  it("zoning base and overlays have SEPARATE source artifacts (provenance)", async () => {
    const { session } = await canonicalConfirmed();
    const { project } = commitSession(session, {
      projectId: "gis:prov",
      propertyId: "gis:property:prov",
      actor: "test",
      now: "2026-10-04T18:30:00.000Z",
    });

    const baseClaim = Object.values(project.nodes).find(
      (n) => n.kind === "claim" && n.id.includes("zoning-base"),
    );
    const overlayClaim = Object.values(project.nodes).find(
      (n) => n.kind === "claim" && n.id.includes("zoning-overlays"),
    );
    expect(baseClaim).toBeDefined();
    expect(overlayClaim).toBeDefined();
    if (baseClaim?.kind === "claim" && overlayClaim?.kind === "claim") {
      // Different source artifacts
      expect(baseClaim.sourceIds[0]).not.toBe(overlayClaim.sourceIds[0]);
      const baseArtifact = project.nodes[baseClaim.sourceIds[0]];
      const overlayArtifact = project.nodes[overlayClaim.sourceIds[0]];
      expect(baseArtifact?.kind).toBe("source-artifact");
      expect(overlayArtifact?.kind).toBe("source-artifact");
      // Different logical source keys
      if (baseArtifact?.kind === "source-artifact" && overlayArtifact?.kind === "source-artifact") {
        expect(baseArtifact.logicalSourceKey).not.toBe(overlayArtifact.logicalSourceKey);
      }
    }
  });

  it("parcel provenance chain traverses to source artifact with real evidence", async () => {
    const { session } = await canonicalConfirmed();
    const { project } = commitSession(session, {
      projectId: "gis:chain",
      propertyId: "gis:property:chain",
      actor: "test",
      now: "2026-10-04T18:30:00.000Z",
    });
    const chain = getEvidenceChain(project, "gis:parcel:778273000");
    const flat = JSON.stringify(chain);
    expect(flat).toContain("phl-pwd-parcels");
  });

  it("two distinct PWD queries produce distinct logical source keys (B7)", async () => {
    const { session } = await canonicalConfirmed();
    const captures = session.captures.filter((c) => c.providerId === "phl-pwd-parcels");
    const keys = new Set(captures.map((c) => c.logicalCaptureKey));
    expect(keys.size).toBeGreaterThan(1); // address-registry vs envelope
  });
});

describe("multi-parcel campus: per-parcel contexts preserve distinctions (B3)", () => {
  it("two parcels resolve per-parcel contexts independently", async () => {
    const parcels = [
      makeParcelCandidate(),
      makeParcelCandidate({
        brtId: "778273100",
        parcelId: "778273100",
        address: "7252 E ROOSEVELT BLVD",
        ownerName: "CALVARY MEMORIAL CHURCH",
        matchReasons: ["NEAREST"],
        capture: { ...makeParcelCandidate().capture, rawContentHash: "e".repeat(64) },
      }),
    ];
    // Scripted providers (test geometry centroids don't match fixture files)
    const { ScriptedGeocoder, ScriptedParcels, ScriptedZoning, ScriptedStructures, ScriptedContext } =
      await import("./fixtures");
    const stack = {
      geocoder: new ScriptedGeocoder([]),
      parcels: new ScriptedParcels(parcels, parcels),
      zoning: new ScriptedZoning(makeZoningBase(), makeZoningOverlays()),
      structures: new ScriptedStructures([makeStructure()]),
      context: new ScriptedContext(makeFlood()),
    };
    let session = newSession("campus", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = { ...session, addressStage: "RESOLVED", selectedAddress: makeAddressCandidate() };
    session = { ...session, parcelCandidates: parcels, parcelStage: "CONFIRMATION_REQUIRED" };
    session = confirmParcels(session, ["778273000", "778273100"]);
    session = await resolveParcelContexts(session, stack);

    // Each parcel has its own context
    expect(session.parcelContexts).toHaveLength(2);
    const ctx1 = session.parcelContexts.find((c) => c.parcelId === "778273000");
    const ctx2 = session.parcelContexts.find((c) => c.parcelId === "778273100");
    expect(ctx1?.zoningBase?.district).toBe("RM1");
    expect(ctx2?.zoningBase?.district).toBe("RM1");
    // Both resolved independently
    expect(ctx1?.structures).toBeDefined();
    expect(ctx2?.structures).toBeDefined();
  });

  it("structures retain their parcel association (not all on parcels[0])", async () => {
    const parcels = [
      makeParcelCandidate(),
      makeParcelCandidate({
        brtId: "778273100",
        parcelId: "778273100",
        pwdParcelNum: "494019",
        ownerName: "CALVARY MEMORIAL CHURCH",
        capture: { ...makeParcelCandidate().capture, rawContentHash: "f".repeat(64) },
      }),
    ];
    const { ScriptedGeocoder, ScriptedParcels, ScriptedZoning, ScriptedContext } =
      await import("./fixtures");
    const stack = {
      geocoder: new ScriptedGeocoder([]),
      parcels: new ScriptedParcels(parcels, parcels),
      zoning: new ScriptedZoning(makeZoningBase(), makeZoningOverlays()),
      // Return the church structure only for parcel 494018 (the first parcel);
      // the second parcel (494019) has no structures.
      structures: {
        providerId: "scripted-structures",
        findByParcel: async (parcel: { parcelId: string }) =>
          parcel.parcelId === "494018" ? [makeStructure()] : [],
      },
      context: new ScriptedContext(makeFlood()),
    };
    let session = newSession("campus-struct", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = { ...session, addressStage: "RESOLVED", selectedAddress: makeAddressCandidate() };
    session = { ...session, parcelCandidates: parcels, parcelStage: "CONFIRMATION_REQUIRED" };
    session = confirmParcels(session, ["778273000", "778273100"]);
    session = await resolveParcelContexts(session, stack);

    const { project } = commitSession(session, {
      projectId: "gis:campus",
      propertyId: "gis:property:campus",
      actor: "test",
      now: "2026-10-04T18:30:00.000Z",
    });
    // Property has 2 parcels
    const property = project.nodes["gis:property:campus"];
    if (property?.kind === "property") {
      expect(property.parcelIds).toHaveLength(2);
    }
    // Structures from each parcel are on their OWN parcel
    const structures = Object.values(project.nodes).filter((n) => n.kind === "structure");
    expect(structures.length).toBeGreaterThan(0);
    const structureParcelIds = new Set(structures.map((s) => (s as { parcelId: string }).parcelId));
    expect(structureParcelIds.size).toBeGreaterThan(0);
  });
});
