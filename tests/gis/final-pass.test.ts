import { describe, expect, it } from "vitest";
import {
  createEnvelope,
  verifyEnvelope,
  EnvelopeSignatureError,
  MissingSecretError,
} from "../../src/adapters/gis/resolution-envelope";
import type { ResolutionSession } from "../../src/application/resolution/state";
import { commitSession } from "../../src/application/resolution/commit";
import {
  makeAddressCandidate,
  makeParcelCandidate,
  makeZoningBase,
  makeZoningOverlays,
  makeFlood,
} from "./fixtures";

const NOW = "2026-10-04T20:00:00.000Z";

function baseSession(): ResolutionSession {
  return {
    sessionId: "final-pass",
    createdAt: NOW,
    query: "7200 Roosevelt Blvd",
    addressStage: "RESOLVED",
    addressCandidates: [makeAddressCandidate()],
    selectedAddress: makeAddressCandidate(),
    parcelStage: "RESOLVED",
    parcelCandidates: [makeParcelCandidate()],
    confirmedParcelIds: ["778273000"],
    userConfirmedProperty: true,
    parcelContexts: [],
    captures: [],
  };
}

describe("final pass F1: full-session signing (no field exclusions)", () => {
  it("tampering userConfirmedProperty invalidates the envelope", () => {
    const envelope = createEnvelope(baseSession());
    const tampered = {
      ...envelope,
      session: { ...envelope.session, userConfirmedProperty: false },
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("tampering confirmedParcelIds invalidates the envelope", () => {
    const envelope = createEnvelope(baseSession());
    const tampered = {
      ...envelope,
      session: { ...envelope.session, confirmedParcelIds: ["FAKE-PARCEL-ID"] },
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("tampering parcelStage invalidates the envelope", () => {
    const envelope = createEnvelope(baseSession());
    const tampered = {
      ...envelope,
      session: { ...envelope.session, parcelStage: "FAILED" as const },
    };
    expect(() => verifyEnvelope(tampered)).toThrow(EnvelopeSignatureError);
  });

  it("production mode without ACREVIA_RESOLUTION_SECRET fails closed", () => {
    const env = process.env as Record<string, string | undefined>;
    const originalSecret = env.ACREVIA_RESOLUTION_SECRET;
    const originalNodeEnv = env.NODE_ENV;
    delete env.ACREVIA_RESOLUTION_SECRET;
    env.NODE_ENV = "production";
    try {
      expect(() => createEnvelope(baseSession())).toThrow(MissingSecretError);
    } finally {
      env.NODE_ENV = originalNodeEnv;
      if (originalSecret) env.ACREVIA_RESOLUTION_SECRET = originalSecret;
    }
  });
});

describe("final pass F2: jurisdictions[] persisted per parcel", () => {
  it("two parcels with different zoning produce two jurisdiction nodes", () => {
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

    // Different zoning for each parcel — the campus case
    const zoningBaseA = makeZoningBase();
    const zoningBaseB = makeZoningBase({
      district: "CMX2",
      districtLong: "CMX-2",
      capture: { ...makeZoningBase().capture, rawContentHash: "g".repeat(64), logicalCaptureKey: "scripted:zoning-base-b" },
    });

    const session: ResolutionSession = {
      ...baseSession(),
      sessionId: "campus-jurisdiction",
      parcelCandidates: parcels,
      confirmedParcelIds: ["778273000", "778273100"],
      parcelContexts: [
        {
          parcelId: "778273000",
          zoningBase: zoningBaseA,
          zoningOverlays: makeZoningOverlays(),
          structures: [],
          flood: makeFlood(),
          failures: [],
        },
        {
          parcelId: "778273100",
          zoningBase: zoningBaseB, // DIFFERENT zoning for parcel B
          structures: [],
          failures: [],
        },
      ],
    };

    const { project } = commitSession(session, {
      projectId: "gis:campus-j",
      propertyId: "gis:property:campus-j",
      actor: "test",
      now: NOW,
    });

    // TWO jurisdiction nodes exist
    const jurisdictions = Object.values(project.nodes).filter(
      (node) => node.kind === "jurisdiction",
    );
    expect(jurisdictions).toHaveLength(2);

    // Each references the correct parcel-scoped zoning claim
    const jA = jurisdictions.find((j) => j.id === "gis:jurisdiction:778273000");
    const jB = jurisdictions.find((j) => j.id === "gis:jurisdiction:778273100");
    expect(jA).toBeDefined();
    expect(jB).toBeDefined();

    if (jA?.kind === "jurisdiction" && jB?.kind === "jurisdiction") {
      expect(jA.claimIds).toContain("gis:claim:zoning-base:778273000");
      expect(jB.claimIds).toContain("gis:claim:zoning-base:778273100");
      // Different claims
      expect(jA.claimIds[0]).not.toBe(jB.claimIds[0]);
    }

    // Neither parcel's zoning is flattened into the other
    const claimA = project.nodes["gis:claim:zoning-base:778273000"];
    const claimB = project.nodes["gis:claim:zoning-base:778273100"];
    if (claimA?.kind === "claim" && claimB?.kind === "claim") {
      expect(claimA.value).toEqual({ type: "qualitative", text: "RM-1" });
      expect(claimB.value).toEqual({ type: "qualitative", text: "CMX-2" });
      expect(claimA.subjectNodeId).toBe("gis:parcel:778273000");
      expect(claimB.subjectNodeId).toBe("gis:parcel:778273100");
    }
  });
});
