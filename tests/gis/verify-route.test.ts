import { describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/gis/verify/route";
import { createEnvelope } from "../../src/adapters/gis/resolution-envelope";
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
 * Trust invariant for browser session restore: sessionStorage is never a
 * source of verified truth. The verify route is the server boundary that
 * decides — a valid signed envelope restores; any tampered provider-derived
 * fact (zoning, owner, parcel geometry) fails full-session HMAC verification
 * and is rejected without echoing unverified content.
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

function acceptedSession(): ResolutionSession {
  return {
    sessionId: "verify-route",
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

function post(envelope: unknown) {
  return POST(
    new Request("http://localhost/api/gis/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope }),
    }),
  );
}

describe("POST /api/gis/verify", () => {
  it("accepts a valid signed envelope and returns the verified session", async () => {
    const response = await post(createEnvelope(acceptedSession()));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { valid: boolean; session: ResolutionSession };
    expect(payload.valid).toBe(true);
    expect(payload.session.confirmedParcelIds).toEqual(["778273000"]);
    expect(payload.session.parcelContexts[0].zoningBase?.districtLong).toBe("RM-1");
  });

  it("rejects a tampered zoning district", async () => {
    const envelope = createEnvelope(acceptedSession());
    const tampered = structuredClone(envelope);
    tampered.session.parcelContexts[0].zoningBase = makeZoningBase({
      district: "CA2",
      districtLong: "CA-2 FORGED",
    });
    const response = await post(tampered);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { valid: boolean };
    expect(payload.valid).toBe(false);
  });

  it("rejects a tampered owner name", async () => {
    const envelope = createEnvelope(acceptedSession());
    const tampered = structuredClone(envelope);
    tampered.session.parcelCandidates[0].ownerName = "FORGED OWNER LLC";
    const response = await post(tampered);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { valid: boolean };
    expect(payload.valid).toBe(false);
  });

  it("rejects tampered parcel geometry", async () => {
    const envelope = createEnvelope(acceptedSession());
    const tampered = structuredClone(envelope);
    // Move the parcel polygon a full degree — forged geometry.
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
    const response = await post(tampered);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { valid: boolean };
    expect(payload.valid).toBe(false);
  });

  it("rejects a missing or malformed envelope without throwing", async () => {
    for (const body of [undefined, { session: {} }, { signature: "no-session" }]) {
      const response = await POST(
        new Request("http://localhost/api/gis/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope: body }),
        }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).valid).toBe(false);
    }
  });

  it("rejects an invalid JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/gis/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).valid).toBe(false);
  });
});
