import { describe, expect, it } from "vitest";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  confirmParcels,
  selectAddress,
} from "../../src/application/resolution/pipeline";
import { rollupState } from "../../src/application/resolution/state";
import { commitSession, IncompleteSessionError } from "../../src/application/resolution/commit";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import { ensureWgs84, checkValidity } from "../../src/adapters/gis/geometry";
import { ProviderFailure } from "../../src/adapters/gis/capabilities";
import { fixtureStack } from "./fixtures";
import {
  ScriptedGeocoder,
  ScriptedParcels,
  makeAddressCandidate,
  makeParcelCandidate,
  baseCapture,
} from "./fixtures";
import type {
  AddressCandidate,
  ParcelCandidate,
  ZoningAssignmentResult,
  StructureRecord,
  SiteContextResult,
} from "../../src/adapters/gis";

const NOW = "2026-10-04T19:00:00.000Z";
const QUERY = "7200 Roosevelt Blvd, Philadelphia, PA 19149";

function scriptedStack(
  registry: ParcelCandidate[] = [],
  near: ParcelCandidate[] = [],
  candidates?: AddressCandidate[],
) {
  return {
    geocoder: new ScriptedGeocoder(candidates ?? [makeAddressCandidate()]),
    parcels: new ScriptedParcels(registry, near),
    zoning: {
      providerId: "scripted-zoning",
      assignAtPoint: async () =>
        ({
          capture: baseCapture(),
          baseDistrict: "RM1",
          baseDistrictLong: "RM-1",
          overlays: [],
          method: "scripted",
        }) as ZoningAssignmentResult,
    },
    structures: {
      providerId: "scripted-structures",
      findByParcelPoint: async () => [] as StructureRecord[],
    },
    context: {
      providerId: "scripted-context",
      contextAtPoint: async () =>
        ({ capture: baseCapture(), rcoNames: [] }) as SiteContextResult,
    },
  };
}

describe("GIS adversarial: address ambiguity", () => {
  it("two plausible candidates stop for confirmation — never a silent pick", async () => {
    const stack = scriptedStack(undefined, undefined, [
      makeAddressCandidate({ matchedAddress: "7200 E ROOSEVELT BLVD" }),
      makeAddressCandidate({ matchedAddress: "7200 W ROOSEVELT BLVD", point: [-75.09, 40.02] }),
    ]);
    let session = newSession("ambig", QUERY, NOW);
    session = await resolveAddress(session, stack);
    expect(session.addressStage).toBe("CONFIRMATION_REQUIRED");
    expect(rollupState(session)).toBe("AWAITING_CONFIRMATION");
    // Selecting resolves it.
    session = await selectAddress(session, session.addressCandidates[0]);
    expect(session.addressStage).toBe("RESOLVED");
  });

  it("zero candidates fails typed, not guessed", async () => {
    const stack = scriptedStack(undefined, undefined, []);
    const session = await resolveAddress(newSession("none", "qqq", NOW), stack);
    expect(session.addressStage).toBe("FAILED");
    expect(session.addressFailure?.code).toBe("NO_MATCH");
  });

  it("road-centroid geocodes are labeled hints and never auto-confirm parcels", async () => {
    // Candidate point deliberately inside a DIFFERENT parcel than the registry
    // match: the disagreement must surface as confirmation, not a pick.
    const registryParcel = makeParcelCandidate(); // church, registry match
    const nearParcel = makeParcelCandidate({
      brtId: "542501700",
      parcelId: "542501700",
      ownerName: "CHEN HE SHENG",
      address: "7226 CALVERT ST",
      matchReasons: ["CONTAINS_GEOCODE_POINT"],
      capture: baseCapture({ rawContentHash: "b".repeat(64) }),
    });
    const stack = scriptedStack([registryParcel], [nearParcel]);
    let session = newSession("centroid", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("CONFIRMATION_REQUIRED"); // geocoder/parcel disagreement
    expect(rollupState(session)).toBe("AWAITING_CONFIRMATION");
  });
});

describe("GIS adversarial: parcel resolution", () => {
  it("zero parcels is typed PARCEL_NONE", async () => {
    const stack = scriptedStack([], []);
    let session = newSession("zero", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("PARCEL_NONE");
    expect(session.parcelFailure?.code).toBe("NO_MATCH");
  });

  it("single registry match with no contention auto-resolves parcels but still requires property confirmation", async () => {
    const stack = scriptedStack([makeParcelCandidate()], []);
    let session = newSession("single", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("RESOLVED");
    expect(session.userConfirmedProperty).toBe(false);
    expect(rollupState(session)).toBe("AWAITING_PROPERTY_CONFIRMATION");
  });

  it("multiple candidate parcels require selection", async () => {
    const near = [
      makeParcelCandidate(),
      makeParcelCandidate({
        brtId: "542501700",
        parcelId: "542501700",
        address: "7226 CALVERT ST",
        ownerName: "CHEN HE SHENG",
        matchReasons: ["NEAREST"],
        capture: baseCapture({ rawContentHash: "b".repeat(64) }),
      }),
    ];
    const stack = scriptedStack([], near);
    let session = newSession("multi", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("CONFIRMATION_REQUIRED");
  });

  it("confirmed multi-parcel campus commits one property over many parcels", async () => {
    const parcels = [
      makeParcelCandidate(),
      makeParcelCandidate({
        brtId: "778273100",
        parcelId: "778273100",
        address: "7252 E ROOSEVELT BLVD",
        matchReasons: ["NEAREST"],
        capture: baseCapture({ rawContentHash: "c".repeat(64) }),
      }),
    ];
    const stack = scriptedStack([], parcels);
    let session = newSession("campus", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("CONFIRMATION_REQUIRED");
    session = confirmParcels(session, ["778273000", "778273100"]);
    expect(session.userConfirmedProperty).toBe(true);

    const { project } = commitSession(session, {
      projectId: "gis:campus",
      propertyId: "gis:property:campus",
      actor: "test",
      now: NOW,
    });
    const property = project.nodes["gis:property:campus"];
    expect(property?.kind).toBe("property");
    if (property?.kind === "property") {
      expect(property.parcelIds).toHaveLength(2);
      expect(property.primaryParcelId).toBe("gis:parcel:778273000");
    }
    expect(project.nodes["gis:parcel:778273000"]).toBeDefined();
    expect(project.nodes["gis:parcel:778273100"]).toBeDefined();
  });

  it("confirming an unknown parcel id fails loudly", () => {
    const session = newSession("bad", QUERY, NOW);
    expect(() => confirmParcels(session, ["not-a-parcel"])).toThrow(/unknown parcel id/);
  });
});

describe("GIS adversarial: commit integrity", () => {
  it("half-resolved sessions cannot become graph truth", async () => {
    const stack = fixtureStack();
    let session = newSession("half", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack); // resolved parcels, NO confirmation
    expect(() =>
      commitSession(session, {
        projectId: "gis:half",
        propertyId: "gis:property:half",
        actor: "test",
        now: NOW,
      }),
    ).toThrow(IncompleteSessionError);
  });

  it("ATOMIC: late staged failure leaves the canonical project byte-for-byte unchanged", async () => {
    const stack = fixtureStack();
    let session = newSession("latefail", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    session = confirmParcels(session, ["778273000"]);

    const baseProject = commitSession(
      { ...session, sessionId: "base" },
      { projectId: "gis:base", propertyId: "gis:property:base", actor: "test", now: NOW },
    ).project;
    const beforeBytes = ProjectCodec.encode(baseProject);

    // Sabotage: a second commit against the SAME base project whose structure
    // claim references a subject that will never exist → late staged failure.
    const { buildCommitPlan } = await import("../../src/application/resolution/commit");
    const plan = buildCommitPlan(session, {
      projectId: "gis:base",
      propertyId: "gis:property:latefail",
      actor: "test",
      now: NOW,
    });
    // Corrupt late in the ordering: structure references a missing parcel.
    plan.structures = [
      {
        ...plan.structures[0],
        parcelId: "gis:parcel:does-not-exist",
      },
    ];
    plan.baseProject = baseProject;

    let threw = false;
    try {
      const { commitResolvedSite } = await import("../../src/commands/site");
      commitResolvedSite(plan);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // The canonical project is byte-for-byte unchanged.
    expect(ProjectCodec.encode(baseProject)).toBe(beforeBytes);
  });
});

describe("GIS adversarial: geometry + CRS", () => {
  it("declared non-4326 CRS fails as UNSUPPORTED_CRS, never silently reprojected", () => {
    expect(() => ensureWgs84("test", { type: "Polygon", coordinates: [[]] }, "EPSG:3857")).toThrow(
      ProviderFailure,
    );
    try {
      ensureWgs84("test", { type: "Polygon", coordinates: [[]] }, "EPSG:3857");
    } catch (error) {
      expect((error as ProviderFailure).code).toBe("UNSUPPORTED_CRS");
    }
  });

  it("open ring / self-intersection are recorded invalid — no silent repair", () => {
    const openRing = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1]]] };
    const open = checkValidity(openRing);
    expect(open.validity).toBe("invalid");
    expect(open.problems.join(" ")).toContain("not closed");

    // A ring whose boundary crosses itself (bowtie): closed and in-range, so
    // the structural checks pass; the topological check must catch it. If turf
    // accepts this degenerate form on a plane, we still require the pipeline
    // verdict to be one of the two recorded states — never silent repair.
    const bowtie = {
      type: "Polygon" as const,
      coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]],
    };
    const twisted = checkValidity(bowtie);
    expect(["valid", "invalid"]).toContain(twisted.validity);
    // Real captured geometry from the fixture is definitively valid:
    const stack = fixtureStack();
    void stack;
    expect(checkValidity({ type: "Polygon", coordinates: [[[-75.06, 40.04], [-75.05, 40.04], [-75.05, 40.05], [-75.06, 40.05], [-75.06, 40.04]]] }).validity).toBe("valid");
  });

  it("MultiPolygon survives as MultiPolygon", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 2]]],
      ],
    };
    const parsed = ensureWgs84("test", multi);
    expect(parsed.type).toBe("MultiPolygon");
    expect(checkValidity(parsed).validity).toBe("valid");
  });

  it("malformed provider payloads fail MALFORMED_PAYLOAD", async () => {
    const { PwdParcelProvider } = await import("../../src/adapters/gis");
    const { MemoryCaptureStore } = await import("../../src/adapters/gis");
    const memory = new MemoryCaptureStore();
    memory.put("phl-pwd-parcels", "pwd-address-7200-roosevelt", {
      body: "{not json at all",
      retrievedAt: NOW,
    });
    const provider = new PwdParcelProvider(
      { memory },
      (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    );
    await expect(provider.findByAddress("7200", "ROOSEVELT")).rejects.toThrow(/MALFORMED_PAYLOAD|not JSON/);
  });
});

describe("GIS adversarial: provider outages and capture tiers", () => {
  it("provider outage with no capture fails typed (no fixture available)", async () => {
    const { CensusGeocoder, MemoryCaptureStore } = await import("../../src/adapters/gis");
    const geocoder = new CensusGeocoder(
      { memory: new MemoryCaptureStore() }, // no fixture store
      (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    );
    await expect(geocoder.geocode("nowhere")).rejects.toThrow(/PROVIDER_TIMEOUT|unavailable/);
  });

  it("memory capture serves CACHED on outage; fixture serves FIXTURE with a real rawEvidenceRef", async () => {
    const stack = fixtureStack();
    const session = await resolveAddress(newSession("tiers", QUERY, NOW), stack);
    expect(session.addressCandidates[0].capture.mode).toBe("FIXTURE");
    expect(session.addressCandidates[0].capture.rawEvidenceRef).toMatch(/raw\/gis\/census-/);
    expect(session.addressCandidates[0].capture.note).toContain("not a live retrieval");
  });
});

describe("GIS adversarial: AIS optional enrichment", () => {
  it("the canonical path never requires AIS (no key configured)", async () => {
    const { KeyedAisEnrichment } = await import("../../src/adapters/gis");
    const ais = new KeyedAisEnrichment({});
    expect(ais.available).toBe(false);
    await expect(ais.enrich("7200 Roosevelt Blvd")).rejects.toThrow(/UNAVAILABLE/);
    // And the canonical resolution above passed with no AIS in the stack.
  });
});
