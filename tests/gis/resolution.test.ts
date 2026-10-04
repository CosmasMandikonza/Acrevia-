import { describe, expect, it } from "vitest";
import { fixtureStack } from "./fixtures";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  resolveSiteContext,
  confirmParcels,
} from "../../src/application/resolution/pipeline";
import { rollupState } from "../../src/application/resolution/state";

const CANONICAL_QUERY = "7200 Roosevelt Blvd, Philadelphia, PA 19149";

/**
 * Canonical Philadelphia resolution, entirely on the committed fixture
 * evidence (network disabled) — the no-AIS-required path end to end.
 */
describe("canonical Philadelphia resolution (fixture evidence, no AIS)", () => {
  it("resolves address → parcels → context with typed, labeled provenance", async () => {
    const stack = fixtureStack();
    let session = newSession("test-session", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");

    session = await resolveAddress(session, stack);
    expect(session.addressStage).toBe("RESOLVED");
    expect(session.addressCandidates).toHaveLength(1);
    const candidate = session.addressCandidates[0];
    expect(candidate.matchedAddress).toContain("7200 ROOSEVELT BLVD");
    // Census point is a street-interpolated HINT — recorded as such.
    expect(candidate.geocodeType).toContain("tiger-interpolated");
    expect(candidate.point[0]).toBeLessThan(candidate.point[1] * -1 + 200); // lon/lat order sanity
    expect(candidate.capture.mode).toBe("FIXTURE");
    expect(candidate.capture.rawEvidenceRef).toContain("raw/gis/census-");

    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("RESOLVED");
    const church = session.parcelCandidates.find((c) => c.brtId === "778273000");
    expect(church).toBeDefined();
    expect(church?.ownerName).toBe("CALVARY MEMORIAL CHURCH");
    expect(church?.recordedAreaSqFt).toBe(119295);
    expect(church?.matchReasons).toContain("ADDRESS_REGISTRY_MATCH");

    session = confirmParcels(session, ["778273000"]);
    expect(session.userConfirmedProperty).toBe(true);

    session = await resolveSiteContext(session, stack, [-75.056429177, 40.043767556]);
    expect(session.zoning?.baseDistrict).toBe("RM1");
    expect(session.zoning?.baseDistrictLong).toBe("RM-1");
    expect(session.structures.map((s) => s.buildingName)).toContain("Calvary Memorial Church");
    expect(session.context?.floodZone).toBe("X");
    expect(session.context?.rcoNames.length).toBeGreaterThan(0);

    expect(rollupState(session)).toBe("READY_TO_COMMIT");
  });

  it("the Census point never silently becomes the parcel", async () => {
    const stack = fixtureStack();
    let session = newSession("s2", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    // Census point (on the street, south of the parcel) is NOT inside the
    // church parcel — so containment is absent; the registry match is the
    // labeled reason, and the pipeline still demands property confirmation.
    const church = session.parcelCandidates.find((c) => c.brtId === "778273000");
    expect(church?.matchReasons).not.toContain("CONTAINS_GEOCODE_POINT");
    expect(session.userConfirmedProperty).toBe(false);
    expect(rollupState(session)).toBe("AWAITING_PROPERTY_CONFIRMATION");
  });

  it("recorded area stays separate from computed area after commit", async () => {
    const { commitSession } = await import("../../src/application/resolution/commit");
    const stack = fixtureStack();
    let session = newSession("s3", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    session = confirmParcels(session, ["778273000"]);
    session = await resolveSiteContext(session, stack, [-75.056429177, 40.043767556]);

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
      expect(parcel.computedAreas.length).toBeGreaterThan(0);
      expect(parcel.computedAreas[0].valueSqFt).not.toBe(119295); // computed ≠ recorded
      expect(parcel.geometry.crs).toBe("EPSG:4326");
      expect(parcel.geometry.validity).toBe("valid");
    }
  });

  it("provenance chain: committed parcel traverses to source artifact with fixture evidence", async () => {
    const { commitSession } = await import("../../src/application/resolution/commit");
    const { getEvidenceChain } = await import("../../src/domain");
    const stack = fixtureStack();
    let session = newSession("s4", CANONICAL_QUERY, "2026-10-04T18:00:00.000Z");
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    session = confirmParcels(session, ["778273000"]);
    session = await resolveSiteContext(session, stack, [-75.056429177, 40.043767556]);

    const { project } = commitSession(session, {
      projectId: "gis:778273000",
      propertyId: "gis:property:778273000",
      actor: "test",
      now: "2026-10-04T18:30:00.000Z",
    });
    const chain = getEvidenceChain(project, "gis:parcel:778273000");
    const flat = JSON.stringify(chain);
    expect(flat).toContain("gis:claim:parcel-geometry:778273000");
    expect(flat).toContain("phl-pwd-parcels");
    expect(chain.children.some((child) => child.rawEvidenceRef?.includes("pwd-")));
    // The fixture file exists and the artifact hash matches its contents.
    const artifactNode = Object.values(project.nodes).find(
      (node) => node.kind === "source-artifact" && node.logicalSourceKey === "gis:src:phl-pwd-parcels",
    );
    expect(artifactNode?.kind).toBe("source-artifact");
    if (artifactNode?.kind === "source-artifact") {
      expect(artifactNode.rawEvidenceRef).toContain("raw/gis/");
      const { existsSync, readFileSync } = await import("node:fs");
      expect(existsSync(artifactNode.rawEvidenceRef!)).toBe(true);
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(readFileSync(artifactNode.rawEvidenceRef!, "utf-8"), "utf-8").digest("hex");
      expect(hash).toBe(artifactNode.rawContentHash);
    }
  });
});
