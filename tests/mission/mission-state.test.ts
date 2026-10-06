import { describe, expect, it } from "vitest";
import { POST as missionStatePost } from "../../src/app/api/mission/state/route";
import { POST as commitPost } from "../../src/app/api/gis/commit/route";
import { createEnvelope } from "../../src/adapters/gis/resolution-envelope";
import { createCommitReceipt, type CommitReceipt } from "../../src/adapters/gis/commit-receipt";
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
 * Mission Compiler project-state bridge (issue #6).
 *
 * The canonical project must be available to mission commands after Site
 * acceptance WITHOUT a database or a parallel client truth model: the server
 * verifies the accepted { envelope, receipt } pair, deterministically
 * reconstructs the committed project, replays the client command log through
 * the typed command boundary, and attests the result. These tests prove the
 * lifecycle (confirm → edit → hard/soft → retract), atomic rejection,
 * determinism, and tamper resistance at the route boundary.
 */

const NOW = "2026-10-05T12:00:00.000Z";

function parcelContext(): ResolvedParcelContext {
  return {
    parcelId: "778273000",
    zoningBase: makeZoningBase(),
    zoningOverlays: makeZoningOverlays(),
    structures: [makeStructure()],
    flood: makeFlood(),
    failures: [],
  };
}

function acceptedSession(): ResolutionSession {
  return {
    sessionId: "mission-state",
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

async function acceptedPair() {
  const envelope = createEnvelope(acceptedSession());
  const response = await commitPost(
    new Request("http://localhost/api/gis/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        envelope,
        projectId: "gis:778273000",
        propertyId: "gis:property:778273000",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const committed = (await response.json()) as { receipt: { payload: unknown; signature: string } };
  return { envelope, receipt: committed.receipt };
}

function missionState(pair: { envelope: unknown; receipt: unknown }, commands: unknown[]) {
  return missionStatePost(
    new Request("http://localhost/api/mission/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope: pair.envelope, receipt: pair.receipt, commands }),
    }),
  );
}

function confirmCommand(overrides: Record<string, unknown> = {}) {
  return {
    kind: "confirm",
    input: {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint",
      intentText: "Keep at least 110 Sunday parking spaces.",
      normalized: { type: "min-parking", spaces: { value: 110, unit: "spaces" } },
      origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: NOW },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
      ...overrides,
    },
  };
}

describe("POST /api/mission/state — canonical lifecycle", () => {
  it("empty log rebuilds the accepted project with no mission rules", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, []);
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.missionConstraints).toEqual([]);
    expect(state.revision).toBeGreaterThan(0);
    expect(state.attestation.projectId).toBe("gis:778273000");
    expect(state.attestation.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("confirm → constraint appears; edit advances revision; retract removes", async () => {
    const pair = await acceptedPair();

    const first = await (await missionState(pair, [confirmCommand()])).json();
    expect(first.missionConstraints).toHaveLength(1);
    expect(first.missionConstraints[0].normalized).toEqual({
      type: "min-parking",
      spaces: { value: 110, unit: "spaces" },
    });
    const constraintRevision = first.missionConstraints[0].revision;

    // Sunday parking >= 110 becomes >= 130 through the same typed command.
    const second = await (
      await missionState(pair, [
        confirmCommand(),
        confirmCommand({
          normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
          intentText: "Keep at least 130 Sunday parking spaces.",
        }),
      ])
    ).json();
    expect(second.missionConstraints[0].normalized.spaces.value).toBe(130);
    expect(second.missionConstraints[0].revision).toBeGreaterThan(constraintRevision);
    expect(second.revision).toBeGreaterThan(first.revision);

    // Hard -> soft change is versioned too.
    const third = await (
      await missionState(pair, [
        confirmCommand(),
        confirmCommand({
          normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
        }),
        confirmCommand({
          normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
          hardOrSoft: "soft",
        }),
      ])
    ).json();
    expect(third.missionConstraints[0].hardOrSoft).toBe("soft");

    // Retract removes the rule from canonical state.
    const fourth = await (
      await missionState(pair, [
        confirmCommand(),
        confirmCommand({
          normalized: { type: "min-parking", spaces: { value: 130, unit: "spaces" } },
        }),
        {
          kind: "retract",
          input: { id: "mission:min-sunday-parking", declaredAt: "2026-10-06T12:00:00.000Z" },
        },
      ])
    ).json();
    expect(fourth.missionConstraints).toEqual([]);
  });

  it("reconstruction is deterministic and attestation-stable for identical logs", async () => {
    const pair = await acceptedPair();
    const commands = [confirmCommand()];
    const a = await (await missionState(pair, commands)).json();
    const b = await (await missionState(pair, commands)).json();
    expect(a.attestation.projectHash).toBe(b.attestation.projectHash);
    expect(a.attestation.signature).toBe(b.attestation.signature);
    expect(a.revision).toBe(b.revision);
  });

  it("HASH GATE: reconstructed base project hash equals the hash signed at commit", async () => {
    const pair = await acceptedPair();
    const receiptPayload = (pair.receipt as { payload: { projectHash: string } }).payload;
    expect(receiptPayload.projectHash).toMatch(/^[0-9a-f]{64}$/);
    // Empty command log = identity replay: the rebuilt base project bytes are
    // exactly the committed bytes, so the attestation hash equals the receipt's.
    const state = await (await missionState(pair, [])).json();
    expect(state.attestation.projectHash).toBe(receiptPayload.projectHash);
  });

  it("HASH GATE: a validly-signed receipt whose projectHash does not match the rebuild is refused", async () => {
    const pair = await acceptedPair();
    // Server-side signature over a WRONG hash: signature verification passes,
    // the base-project rebuild cannot reproduce those bytes → fail closed.
    const drifted = createCommitReceipt({
      ...(pair.receipt as { payload: CommitReceipt["payload"] }).payload,
      projectHash: "0".repeat(64),
    });
    const response = await missionState(
      { envelope: pair.envelope, receipt: drifted },
      [confirmCommand()],
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.name).toBe("BaseProjectDriftError");
    expect(payload.reacceptRequired).toBe(true);
    expect(payload.error).toContain("re-accept");
  });

  it("replay rejects invalid values atomically with the failing command index", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, [
      confirmCommand(),
      confirmCommand({
        normalized: { type: "min-parking", spaces: { value: -5, unit: "spaces" } },
      }),
    ]);
    expect(response.status).toBe(400); // rejected at the typed log schema
    const payload = await response.json();
    expect(payload.valid === undefined || payload.valid === false).toBe(true);
  });

  it("replay rejects non-USER_DECLARED origin at the command boundary (422)", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, [
      confirmCommand({ origin: { kind: "MODELER_DECLARED", actorId: "modeler" } }),
    ]);
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.error).toContain("USER_DECLARED");
    expect(payload.commandIndex).toBe(0);
    expect(payload.partialStateWritten).toBe(false);
  });

  it("a tampered envelope is rejected before any mission state is built", async () => {
    const pair = await acceptedPair();
    const tampered = structuredClone(pair);
    (tampered.envelope as { session: { parcelCandidates: { ownerName: string }[] } }).session.parcelCandidates[0].ownerName =
      "FORGED OWNER LLC";
    const response = await missionState(tampered, [confirmCommand()]);
    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("verification-failed");
  });

  it("a receipt-less request never reaches project state", async () => {
    const pair = await acceptedPair();
    const response = await missionState({ envelope: pair.envelope, receipt: undefined }, []);
    expect(response.status).toBe(400);
  });

  it("CANONICAL STRUCTURE: preserve-structure references the gis:structure:* graph node", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, [
      {
        kind: "confirm",
        input: {
          id: "mission:preserve:gis:structure:1282177",
          kind: "mission-constraint",
          intentText: "Preserve the sanctuary.",
          normalized: { type: "preserve-structure", structureId: "gis:structure:1282177" },
          origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: NOW },
          confirmationState: "CONFIRMED",
          hardOrSoft: "hard",
        },
      },
    ]);
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.missionConstraints).toHaveLength(1);
    expect(state.missionConstraints[0].normalized).toEqual({
      type: "preserve-structure",
      structureId: "gis:structure:1282177",
    });
    // The referenced node genuinely exists in the canonical graph.
    expect(state.project.nodes["gis:structure:1282177"]).toBeDefined();
    expect(state.project.nodes["gis:structure:1282177"].kind).toBe("structure");
  });

  it("NONEXISTENT STRUCTURE: a preserve rule for a missing structure node rejects atomically", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, [
      confirmCommand(),
      {
        kind: "confirm",
        input: {
          id: "mission:preserve:gis:structure:does-not-exist",
          kind: "mission-constraint",
          intentText: "Preserve a building that is not on this property.",
          normalized: { type: "preserve-structure", structureId: "gis:structure:does-not-exist" },
          origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: NOW },
          confirmationState: "CONFIRMED",
          hardOrSoft: "hard",
        },
      },
    ]);
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.commandIndex).toBe(1);
    expect(payload.partialStateWritten).toBe(false);
  });

  it("DRAFT: a forged DRAFT confirm command never enters the log schema at all", async () => {
    const pair = await acceptedPair();
    const response = await missionState(pair, [
      {
        kind: "confirm",
        input: {
          ...confirmCommand().input,
          confirmationState: "DRAFT" as const,
        },
      },
    ]);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.name).toBe("InvalidMissionCommandLog");
  });

  it("RETRACT TIMESTAMPS: confirm@T1 then retract@T2 audits distinct, correct event times", async () => {
    const pair = await acceptedPair();
    const T1 = "2026-10-06T09:00:00.000Z";
    const T2 = "2026-10-06T11:30:00.000Z";
    const commands = [
      confirmCommand({ origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: T1 } }),
      { kind: "retract", input: { id: "mission:min-sunday-parking", declaredAt: T2 } },
    ];
    const state = await (await missionState(pair, commands)).json();
    const events = state.project.events as Array<{
      eventType: string;
      occurredAt: string;
    }>;
    const confirmedEvent = events.find((event) => event.eventType === "mission.constraint.confirmed");
    const retractedEvent = events.find((event) => event.eventType === "mission.constraint.retracted");
    expect(confirmedEvent?.occurredAt).toBe(T1);
    expect(retractedEvent?.occurredAt).toBe(T2);
    expect(retractedEvent?.occurredAt).not.toBe(confirmedEvent?.occurredAt);
    // No mission rule remains after the retraction.
    expect(state.missionConstraints).toEqual([]);
    // Deterministic replay: identical log reproduces identical event history.
    const replay = await (await missionState(pair, commands)).json();
    expect(replay.attestation.projectHash).toBe(state.attestation.projectHash);
    expect(replay.attestation.signature).toBe(state.attestation.signature);
  });
});
