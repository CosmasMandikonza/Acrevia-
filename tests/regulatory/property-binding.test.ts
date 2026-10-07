import { describe, expect, it } from "vitest";
import { POST as regulatoryCompilePost } from "../../src/app/api/regulatory/compile/route";
import { POST as commitPost } from "../../src/app/api/gis/commit/route";
import { createEnvelope } from "../../src/adapters/gis/resolution-envelope";
import { createCommitReceipt } from "../../src/adapters/gis/commit-receipt";
import type { ResolutionSession } from "../../src/application/resolution/state";
import type { ResolvedParcelContext } from "../../src/adapters/gis";
import {
  makeAddressCandidate,
  makeParcelCandidate,
  makeZoningBase,
  makeZoningOverlays,
  makeStructure,
  makeFlood,
} from "../gis/fixtures";

/**
 * PROPERTY BINDING (issue #5 review): /api/regulatory/compile must never
 * apply Calvary-specific evidence or RM-1 law to another accepted property.
 * The accepted signed session decides: district from the signed GIS context,
 * /SIX only when the signed overlays prove it, honest unavailable states
 * outside the supported envelope — never a silent RM-1 default.
 */

const NOW = "2026-10-08T12:00:00.000Z";

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

function session(input: {
  sessionId: string;
  context: ResolvedParcelContext;
  parcelId?: string;
}): ResolutionSession {
  const parcelId = input.parcelId ?? input.context.parcelId;
  return {
    sessionId: input.sessionId,
    createdAt: NOW,
    query: "7200 Roosevelt Blvd, Philadelphia, PA",
    addressStage: "RESOLVED",
    addressCandidates: [makeAddressCandidate()],
    selectedAddress: makeAddressCandidate(),
    parcelStage: "RESOLVED",
    parcelCandidates: [
      makeParcelCandidate({
        brtId: parcelId,
        parcelId,
        pwdParcelNum: "494018",
        ownerName: "CITY OF PHILA",
        address: "1400 JOHN F KENNEDY BLVD",
      }),
    ],
    confirmedParcelIds: [parcelId],
    userConfirmedProperty: true,
    parcelContexts: [input.context],
    captures: [],
  };
}

async function acceptedPairFor(input: {
  sessionId: string;
  context: ResolvedParcelContext;
  parcelId?: string;
}) {
  const envelope = createEnvelope(session(input));
  const response = await commitPost(
    new Request("http://localhost/api/gis/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        envelope,
        projectId: `gis:${input.parcelId ?? input.context.parcelId}`,
        propertyId: `gis:property:${input.parcelId ?? input.context.parcelId}`,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const committed = (await response.json()) as {
    receipt: { payload: Parameters<typeof createCommitReceipt>[0]; signature: string };
  };
  return { envelope, receipt: committed.receipt as never };
}

async function compileFor(pair: { envelope: unknown; receipt: unknown }) {
  return regulatoryCompilePost(
    new Request("http://localhost/api/regulatory/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope: pair.envelope, receipt: pair.receipt }),
    }),
  );
}

describe("POST /api/regulatory/compile — property binding", () => {
  it("an RM-1 property WITH signed /SIX proof compiles RM-1 law including the /SIX prohibition", async () => {
    const pair = await acceptedPairFor({ sessionId: "bind-rm1-six", context: parcelContext() });
    const response = await compileFor(pair);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("compiled");
    expect(payload.district).toBe("RM-1");
    const ids = payload.law.map((row: { constraintId: string }) => row.constraintId);
    expect(ids).toContain("phl:constraint:height:max:principal");
    expect(ids).toContain("phl:constraint:overlay:/six:adu-prohibition");
  });

  it("A→B CONTAMINATION: a CMX-2 property (JFK-style) gets NO Calvary law — honest unsupported-district", async () => {
    const cmxContext = parcelContext({
      zoningBase: makeZoningBase({ district: "CMX2", districtLong: "CMX-2" }),
      zoningOverlays: undefined,
      structures: [],
      flood: undefined,
    });
    const pair = await acceptedPairFor({ sessionId: "bind-cmx-jfk", context: cmxContext, parcelId: "782273400" });
    const response = await compileFor(pair);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("unsupported-district");
    expect(payload.district).toBe("CMX-2");
    expect(payload.reason).toContain("CMX-2");
    expect(payload.law).toBeUndefined();
  });

  it("an RM-1 property WITHOUT signed /SIX proof compiles RM-1 law but NOT the /SIX prohibition", async () => {
    const rm1NoSix = parcelContext({
      zoningOverlays: { ...(makeZoningOverlays() as object), overlays: [] } as never,
    });
    const pair = await acceptedPairFor({ sessionId: "bind-rm1-nosix", context: rm1NoSix });
    const response = await compileFor(pair);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("compiled");
    const ids = payload.law.map((row: { constraintId: string }) => row.constraintId);
    expect(ids).toContain("phl:constraint:height:max:principal");
    expect(ids.some((id: string) => id.includes("/six"))).toBe(false);
  });

  it("a property with NO verified district NEVER defaults to RM-1 — needs-evidence", async () => {
    const noDistrict = parcelContext({ zoningBase: undefined });
    const pair = await acceptedPairFor({ sessionId: "bind-nodistrict", context: noDistrict });
    const response = await compileFor(pair);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("needs-evidence");
    expect(payload.reason).toContain("no verified base zoning district");
  });
});
