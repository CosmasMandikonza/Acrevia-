import { describe, expect, it } from "vitest";
import {
  newSession,
  resolveAddress,
  resolveParcels,
  confirmParcels,
  resolveParcelContexts,
} from "../../src/application/resolution/pipeline";
import { commitSession, IncompleteSessionError, InvalidGeometryError } from "../../src/application/resolution/commit";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import { ensureWgs84, checkValidity } from "../../src/adapters/gis/geometry";
import { ProviderFailure } from "../../src/adapters/gis/capabilities";
import {
  verifyEnvelope,
  createEnvelope,
  EnvelopeSignatureError,
  type ResolutionEnvelope,
} from "../../src/adapters/gis/resolution-envelope";
import type { ResolutionSession } from "../../src/application/resolution/state";
import {
  ScriptedGeocoder,
  ScriptedParcels,
  ScriptedZoning,
  ScriptedStructures,
  ScriptedContext,
  makeAddressCandidate,
  makeParcelCandidate,
  makeZoningBase,
  makeZoningOverlays,
  makeFlood,
  makeStructure,
} from "./fixtures";

const NOW = "2026-10-04T19:00:00.000Z";
const QUERY = "7200 Roosevelt Blvd, Philadelphia, PA 19149";

function fullStack(
  parcels: ReturnType<typeof makeParcelCandidate>[] = [makeParcelCandidate()],
  overrides: {
    zoningBase?: ReturnType<typeof makeZoningBase> | Error;
    zoningOverlays?: ReturnType<typeof makeZoningOverlays> | Error;
    structures?: ReturnType<typeof makeStructure>[] | Error;
    flood?: ReturnType<typeof makeFlood> | Error;
  } = {},
) {
  return {
    geocoder: new ScriptedGeocoder([makeAddressCandidate()]),
    parcels: new ScriptedParcels(parcels, parcels),
    zoning: new ScriptedZoning(
      overrides.zoningBase ?? makeZoningBase(),
      overrides.zoningOverlays ?? makeZoningOverlays(),
    ),
    structures: new ScriptedStructures(overrides.structures ?? [makeStructure()]),
    context: new ScriptedContext(overrides.flood ?? makeFlood()),
  };
}

async function confirmedSession(stack = fullStack()) {
  let session = newSession("test", QUERY, NOW);
  session = await resolveAddress(session, stack);
  session = await resolveParcels(session, stack);
  session = confirmParcels(session, [session.parcelCandidates[0].brtId!]);
  session = await resolveParcelContexts(session, stack);
  return session;
}

describe("B5: tamper-evident resolution envelope", () => {
  it("valid envelope verifies and round-trips", async () => {
    const session = await confirmedSession();
    const envelope = createEnvelope(session);
    const verified = verifyEnvelope(envelope);
    expect(verified.sessionId).toBe(session.sessionId);
  });

  it("tampered zoning district (RM-1 → CMX-5) is rejected", async () => {
    const session = await confirmedSession();
    const envelope = createEnvelope(session);

    // Client alters the zoning base district from RM1 to CMX5
    const tampered: ResolutionEnvelope = {
      session: {
        ...envelope.session,
        parcelContexts: envelope.session.parcelContexts.map((ctx) => ({
          ...ctx,
          zoningBase: ctx.zoningBase
            ? { ...ctx.zoningBase, district: "CMX5", districtLong: "CMX-5" }
            : undefined,
        })),
      },
      signature: envelope.signature, // original signature, tampered payload
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("tampered parcel geometry is rejected", async () => {
    const session = await confirmedSession();
    const envelope = createEnvelope(session);

    const tampered: ResolutionEnvelope = {
      session: {
        ...envelope.session,
        parcelCandidates: envelope.session.parcelCandidates.map((c) => ({
          ...c,
          geometry: {
            type: "Polygon" as const,
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        })),
      },
      signature: envelope.signature,
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("tampered owner name is rejected", async () => {
    const session = await confirmedSession();
    const envelope = createEnvelope(session);
    const tampered: ResolutionEnvelope = {
      session: {
        ...envelope.session,
        parcelCandidates: envelope.session.parcelCandidates.map((c) => ({
          ...c,
          ownerName: "FAKE OWNER LLC",
        })),
      },
      signature: envelope.signature,
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("user-mutable fields (confirmedParcelIds) are allowed — server re-signs", async () => {
    const session = await confirmedSession();
    const envelope = createEnvelope(session);
    // User confirms a parcel — this is ALLOWED (user choice, not provider data)
    const updated: ResolutionSession = {
      ...envelope.session,
      userConfirmedProperty: true,
      confirmedParcelIds: ["778273000"],
    };
    const newEnvelope = createEnvelope(updated);
    expect(() => verifyEnvelope(newEnvelope)).not.toThrow();
  });
});

describe("B6: independent provider failures are additive, not silent", () => {
  it("zoning fails but structures + flood survive", async () => {
    const stack = fullStack(undefined, {
      zoningBase: new Error("zoning unavailable"),
      zoningOverlays: new Error("overlays unavailable"),
      flood: makeFlood(), // flood OK
    });
    const session = await confirmedSession(stack);
    const ctx = session.parcelContexts[0];
    const zoningFailures = ctx?.failures.filter((f) => f.capability.startsWith("zoning"));
    expect(zoningFailures).toHaveLength(2); // zoning-base + zoning-overlays
    expect(zoningFailures?.map((f) => f.capability)).toContain("zoning-base");
    expect(zoningFailures?.map((f) => f.capability)).toContain("zoning-overlays");
    // Siblings survived:
    expect(ctx?.structures.length).toBeGreaterThan(0); // structures OK
    expect(ctx?.flood?.zone).toBe("X"); // flood OK
  });

  it("structures fail but zoning + flood survive", async () => {
    const stack = fullStack(undefined, {
      structures: new Error("footprints unavailable"),
    });
    const session = await confirmedSession(stack);
    const ctx = session.parcelContexts[0];
    expect(ctx?.failures.map((f) => f.capability)).toContain("structures");
    expect(ctx?.zoningBase?.district).toBe("RM1"); // zoning OK
    expect(ctx?.flood?.zone).toBe("X"); // flood OK
  });

  it("flood fails but zoning + structures survive", async () => {
    const stack = fullStack(undefined, {
      flood: new Error("flood service down"),
    });
    const session = await confirmedSession(stack);
    const ctx = session.parcelContexts[0];
    expect(ctx?.failures.map((f) => f.capability)).toContain("flood");
    expect(ctx?.zoningBase?.district).toBe("RM1"); // zoning OK
    expect(ctx?.structures.length).toBeGreaterThan(0); // structures OK
  });

  it("rollup shows PARTIAL when any capability failed", async () => {
    const stack = fullStack(undefined, {
      flood: new Error("flood down"),
    });
    const session = await confirmedSession(stack);
    const { rollupState } = await import("../../src/application/resolution/state");
    expect(rollupState(session)).toBe("PARTIAL");
  });
});

describe("B8: invalid geometry commit gate", () => {
  it("invalid polygon is rejected from ordinary commit", async () => {
    const openRing = makeParcelCandidate({
      geometry: { type: "Polygon", coordinates: [[[-75.06, 40.04], [-75.05, 40.04], [-75.05, 40.05]]] }, // not closed
    });
    const stack = fullStack([openRing]);
    let session = newSession("invalid", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = { ...session, parcelCandidates: [openRing], parcelStage: "CONFIRMATION_REQUIRED" };
    // confirmParcels itself rejects invalid geometry
    expect(() => confirmParcels(session, ["778273000"])).toThrow(/invalid geometry/);
  });

  it("commit with invalid geometry throws InvalidGeometryError", async () => {
    const invalid = makeParcelCandidate({
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] }, // open ring
    });
    const session: ResolutionSession = {
      ...newSession("invalid-commit", QUERY, NOW),
      addressStage: "RESOLVED",
      selectedAddress: makeAddressCandidate(),
      parcelStage: "RESOLVED",
      parcelCandidates: [invalid],
      confirmedParcelIds: ["778273000"],
      userConfirmedProperty: true,
    };
    expect(() =>
      commitSession(session, {
        projectId: "gis:invalid",
        propertyId: "gis:property:invalid",
        actor: "test",
        now: NOW,
      }),
    ).toThrow(InvalidGeometryError);
  });

  it("valid geometry passes the gate", async () => {
    const session = await confirmedSession();
    expect(() =>
      commitSession(session, {
        projectId: "gis:valid",
        propertyId: "gis:property:valid",
        actor: "test",
        now: NOW,
      }),
    ).not.toThrow();
  });
});

describe("B8 + B5: atomic commit still leaves original unchanged on late failure", () => {
  it("late staged structure failure leaves canonical project byte-for-byte unchanged", async () => {
    const session = await confirmedSession();
    const { project: baseProject } = commitSession(session, {
      projectId: "gis:base",
      propertyId: "gis:property:base",
      actor: "test",
      now: NOW,
    });
    const before = ProjectCodec.encode(baseProject);

    // Sabotage: structure references a missing parcel
    const { buildCommitPlan } = await import("../../src/application/resolution/commit");
    const plan = buildCommitPlan(session, {
      projectId: "gis:base",
      propertyId: "gis:property:latefail",
      actor: "test",
      now: NOW,
    });
    plan.structures = plan.structures.map((s) => ({ ...s, parcelId: "gis:parcel:missing" }));
    plan.baseProject = baseProject;

    let threw = false;
    try {
      const { commitResolvedSite } = await import("../../src/commands/site");
      commitResolvedSite(plan);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(ProjectCodec.encode(baseProject)).toBe(before);
  });
});

describe("half-resolved sessions", () => {
  it("cannot commit without user confirmation", async () => {
    const stack = fullStack();
    let session = newSession("half", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    // NOT confirmed — userConfirmedProperty is false
    expect(() =>
      commitSession(session, {
        projectId: "gis:half",
        propertyId: "gis:property:half",
        actor: "test",
        now: NOW,
      }),
    ).toThrow(IncompleteSessionError);
  });
});

describe("address ambiguity and parcel edge cases", () => {
  it("two candidates stop for confirmation", async () => {
    const stack = {
      geocoder: new ScriptedGeocoder([
        makeAddressCandidate(),
        makeAddressCandidate({ matchedAddress: "7200 W ROOSEVELT BLVD", point: [-75.09, 40.02] }),
      ]),
      parcels: new ScriptedParcels([], []),
      zoning: new ScriptedZoning(makeZoningBase()),
      structures: new ScriptedStructures([]),
      context: new ScriptedContext(),
    };
    const session = await resolveAddress(newSession("ambig", QUERY, NOW), stack);
    expect(session.addressStage).toBe("CONFIRMATION_REQUIRED");
  });

  it("zero parcels is typed PARCEL_NONE", async () => {
    const stack = fullStack(
      [] as ReturnType<typeof makeParcelCandidate>[],
    );
    let session = newSession("zero", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("PARCEL_NONE");
  });

  it("multiple candidate parcels require selection", async () => {
    const parcels = [
      makeParcelCandidate(),
      makeParcelCandidate({
        brtId: "542501700",
        parcelId: "542501700",
        ownerName: "CHEN HE SHENG",
        matchReasons: ["NEAREST"],
      }),
    ];
    const stack = fullStack(parcels);
    let session = newSession("multi", QUERY, NOW);
    session = await resolveAddress(session, stack);
    session = await resolveParcels(session, stack);
    expect(session.parcelStage).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("CRS and geometry validation", () => {
  it("declared non-4326 CRS fails as UNSUPPORTED_CRS", () => {
    try {
      ensureWgs84("test", { type: "Polygon", coordinates: [[]] }, "EPSG:3857");
      expect.fail("should throw");
    } catch (error) {
      expect((error as ProviderFailure).code).toBe("UNSUPPORTED_CRS");
    }
  });

  it("open ring is recorded invalid", () => {
    const result = checkValidity({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(result.validity).toBe("invalid");
    expect(result.problems.join(" ")).toContain("not closed");
  });

  it("MultiPolygon preserved as MultiPolygon", () => {
    const parsed = ensureWgs84("test", {
      type: "MultiPolygon",
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
    });
    expect(parsed.type).toBe("MultiPolygon");
  });
});

describe("AIS optional enrichment", () => {
  it("canonical path never requires AIS", async () => {
    const { KeyedAisEnrichment } = await import("../../src/adapters/gis");
    const ais = new KeyedAisEnrichment({});
    expect(ais.available).toBe(false);
  });
});
