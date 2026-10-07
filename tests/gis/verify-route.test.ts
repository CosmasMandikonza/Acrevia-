import { describe, expect, it } from "vitest";
import { POST as verifyPost } from "../../src/app/api/gis/verify/route";
import { POST as commitPost } from "../../src/app/api/gis/commit/route";
import { createEnvelope } from "../../src/adapters/gis/resolution-envelope";
import {
  assertReceiptMatchesEnvelope,
  createCommitReceipt,
  type CommitReceipt,
} from "../../src/adapters/gis/commit-receipt";
import { rebuildAcceptedProject, sha256Project } from "../../src/application/mission/rebuild";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import type { ResolutionSession } from "../../src/application/resolution/state";
import type { ResolvedParcelContext } from "../../src/adapters/gis";
import {
  makeAddressCandidate,
  makeParcelCandidate,
  makeZoningBase,
  makeZoningOverlays,
  makeStructure,
  makeFlood,
} from "./fixtures";

/**
 * Trust invariant for browser session restore (PR #25 review): sessionStorage
 * is never a source of verified truth, and a signed ResolutionEnvelope alone
 * does not prove a commit happened. Restoring accepted state requires BOTH
 * server attestations — the full-session envelope HMAC and the CommitReceipt
 * HMAC — plus their mutual consistency. Any tampered provider fact (zoning,
 * owner, geometry) or commit fact (revision, node/event counts) fails
 * verification and is rejected without echoing unverified content.
 */

const NOW = "2026-10-04T21:00:00.000Z";

function parcelContext(overrides: Partial<ResolvedParcelContext> = {}): ResolvedParcelContext {
  return {
    parcelId: "778273000",
    zoningBase: makeZoningBase(),
    zoningOverlays: makeZoningOverlays(),
    structures: [makeStructure()],
    flood: makeFlood(),
    failures: [],
    ...overrides,
  };
}

function acceptedSession(sessionId = "verify-route"): ResolutionSession {
  return {
    sessionId,
    createdAt: NOW,
    query: "7200 Roosevelt Blvd, Philadelphia, PA",
    addressStage: "RESOLVED",
    addressCandidates: [makeAddressCandidate()],
    selectedAddress: makeAddressCandidate(),
    parcelStage: "RESOLVED",
    parcelCandidates: [makeParcelCandidate({ ownerName: "CALVARY MEMORIAL CHURCH" })],
    confirmedParcelIds: ["778273000"],
    userConfirmedProperty: true,
    parcelContexts: [parcelContext()],
    captures: [],
  };
}

/** A server-issued receipt bound to this exact envelope, with the projectHash
 *  computed from the deterministic base-project rebuild (as /api/gis/commit
 *  signs it at commit time). */
function receiptFor(
  envelope: { session: ResolutionSession; signature: string },
  overrides: Partial<CommitReceipt["payload"]> = {},
): CommitReceipt {
  const base: Omit<CommitReceipt["payload"], "projectHash"> = {
    projectId: `gis:${envelope.session.confirmedParcelIds[0]}`,
    propertyId: `gis:property:${envelope.session.confirmedParcelIds[0]}`,
    sessionId: envelope.session.sessionId,
    envelopeSignature: envelope.signature,
    revision: 23,
    nodeCount: 22,
    eventCount: 23,
    committedAt: NOW,
    commitVersion: "1",
  };
  const baseProject = rebuildAcceptedProject(envelope.session, base);
  const computedHash = sha256Project(ProjectCodec.encode(baseProject));
  return createCommitReceipt({
    ...base,
    ...overrides,
    projectHash: overrides.projectHash ?? computedHash,
  });
}

function verify(envelope: unknown, receipt?: unknown) {
  return verifyPost(
    new Request("http://localhost/api/gis/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope, receipt }),
    }),
  );
}

function commit(envelope: unknown, projectId: string, propertyId: string) {
  return commitPost(
    new Request("http://localhost/api/gis/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope, projectId, propertyId }),
    }),
  );
}

describe("POST /api/gis/verify — envelope + commit receipt", () => {
  it("accepts a valid envelope + receipt and returns verified session and receipt metadata", async () => {
    const envelope = createEnvelope(acceptedSession());
    const receipt = receiptFor(envelope);
    const response = await verify(envelope, receipt);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      valid: boolean;
      session: ResolutionSession;
      receipt: CommitReceipt["payload"];
    };
    expect(payload.valid).toBe(true);
    expect(payload.session.confirmedParcelIds).toEqual(["778273000"]);
    expect(payload.session.parcelContexts[0].zoningBase?.districtLong).toBe("RM-1");
    expect(payload.receipt.revision).toBe(23);
    expect(payload.receipt.nodeCount).toBe(22);
    expect(payload.receipt.eventCount).toBe(23);
  });

  it("rejects a confirmed envelope with NO receipt — acceptance requires commit attestation", async () => {
    const envelope = createEnvelope(acceptedSession());
    const response = await verify(envelope);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { valid: boolean; reason: string };
    expect(payload.valid).toBe(false);
    expect(payload.reason).toContain("commit receipt");
  });

  it("rejects a tampered zoning district even with a valid receipt for the original", async () => {
    const envelope = createEnvelope(acceptedSession());
    const receipt = receiptFor(envelope);
    const tampered = structuredClone(envelope);
    tampered.session.parcelContexts[0].zoningBase = makeZoningBase({
      district: "CA2",
      districtLong: "CA-2 FORGED",
    });
    const response = await verify(tampered, receipt);
    expect(response.status).toBe(400);
    expect((await response.json()).valid).toBe(false);
  });

  it("rejects a tampered owner name", async () => {
    const envelope = createEnvelope(acceptedSession());
    const tampered = structuredClone(envelope);
    tampered.session.parcelCandidates[0].ownerName = "FORGED OWNER LLC";
    const response = await verify(tampered, receiptFor(envelope));
    expect(response.status).toBe(400);
    expect((await response.json()).valid).toBe(false);
  });

  it("rejects tampered parcel geometry", async () => {
    const envelope = createEnvelope(acceptedSession());
    const tampered = structuredClone(envelope);
    tampered.session.parcelCandidates[0].geometry = {
      type: "Polygon",
      coordinates: [
        [
          [-74.0, 40.0],
          [-74.001, 40.0],
          [-74.001, 40.001],
          [-74.0, 40.001],
          [-74.0, 40.0],
        ],
      ],
    };
    const response = await verify(tampered, receiptFor(envelope));
    expect(response.status).toBe(400);
    expect((await response.json()).valid).toBe(false);
  });

  it.each(["revision", "nodeCount", "eventCount"] as const)(
    "rejects a tampered receipt %s",
    async (field) => {
      const envelope = createEnvelope(acceptedSession());
      const receipt = structuredClone(receiptFor(envelope));
      receipt.payload[field] = field === "revision" ? 999 : 9999;
      const response = await verify(envelope, receipt);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { valid: boolean; name: string };
      expect(payload.valid).toBe(false);
      expect(payload.name).toBe("ReceiptSignatureError");
    },
  );

  it("rejects a receipt from session A bound to an envelope from session B", async () => {
    const envelopeA = createEnvelope(acceptedSession("session-A"));
    const envelopeB = createEnvelope(acceptedSession("session-B"));
    const receiptA = receiptFor(envelopeA);
    const response = await verify(envelopeB, receiptA);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { valid: boolean; name: string };
    expect(payload.valid).toBe(false);
    expect(payload.name).toBe("ReceiptConsistencyError");
  });

  it("rejects a receipt whose project ids break the accepted-parcel convention", async () => {
    const envelope = createEnvelope(acceptedSession());
    const receipt = receiptFor(envelope, {
      projectId: "gis:someone-elses-parcel",
      propertyId: "gis:property:someone-elses-parcel",
    });
    const response = await verify(envelope, receipt);
    expect(response.status).toBe(400);
    expect((await response.json()).name).toBe("ReceiptConsistencyError");
  });

  it("rejects malformed bodies without throwing", async () => {
    const envelope = createEnvelope(acceptedSession());
    const cases: Array<[unknown, unknown]> = [
      [undefined, undefined],
      [{ session: {} }, undefined],
      [envelope, { payload: {}, signature: "x" }],
      [envelope, { payload: "not-an-object", signature: 42 }],
    ];
    for (const [env, rec] of cases) {
      const response = await verify(env, rec);
      expect(response.status).toBe(400);
      expect((await response.json()).valid).toBe(false);
    }
    const badJson = await verifyPost(
      new Request("http://localhost/api/gis/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).valid).toBe(false);
  });
});

describe("POST /api/gis/commit — signed receipt issuance", () => {
  it("returns a signed receipt after the atomic commit; the receipt round-trips through verify", async () => {
    const envelope = createEnvelope(acceptedSession("round-trip"));
    const commitResponse = await commit(envelope, "gis:778273000", "gis:property:778273000");
    expect(commitResponse.status).toBe(200);
    const committed = (await commitResponse.json()) as {
      revision: number;
      nodeCount: number;
      eventCount: number;
      receipt: CommitReceipt;
    };
    expect(committed.receipt).toBeDefined();
    expect(committed.receipt.payload.revision).toBe(committed.revision);
    expect(committed.receipt.payload.nodeCount).toBe(committed.nodeCount);
    expect(committed.receipt.payload.eventCount).toBe(committed.eventCount);
    expect(committed.receipt.payload.envelopeSignature).toBe(envelope.signature);
    expect(committed.receipt.payload.sessionId).toBe("round-trip");
    // Direct library-level checks alongside the route behavior.
    expect(() => assertReceiptMatchesEnvelope(committed.receipt.payload, envelope)).not.toThrow();

    const verifyResponse = await verify(envelope, committed.receipt);
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as { valid: boolean; receipt: CommitReceipt["payload"] };
    expect(verified.valid).toBe(true);
    expect(verified.receipt.revision).toBe(committed.revision);
  });
});
