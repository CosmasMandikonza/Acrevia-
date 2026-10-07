import { expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POST as commitPost } from "../../src/app/api/gis/commit/route";
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
} from "../gis/fixtures";
import { buildTrustedProofContext } from "../../src/application/proof/trusted-context";
import type { TrustedProofContext } from "../../src/application/proof/trusted-context";
import type { MissionCommand } from "../../src/application/mission/rebuild";
import type { MissionNormalized } from "../../src/domain/constraints/mission";
import type { CopilotToolContext } from "../../src/application/copilot/tools";

/**
 * Shared harness for Copilot tests — the same route-level pattern as
 * tests/proof/snapshot.test.ts: a real committed canonical session (signed
 * envelope + receipt), the canonical mission commands, and the trusted
 * rebuild the Copilot route itself uses.
 */

const NOW = "2026-10-08T12:00:00.000Z";
const FIXTURE_DIR = join(
  import.meta.dirname,
  "../../docs/benchmarks/calvary-memorial-philadelphia",
);

const PARCEL_GEOJSON = JSON.parse(
  readFileSync(
    join(FIXTURE_DIR, "raw/gis/pwd-parcel-brt-778273000.geojson"),
    "utf8",
  ),
).features[0].geometry;
const SANCTUARY_GEOJSON = JSON.parse(
  readFileSync(
    join(FIXTURE_DIR, "raw/gis/footprints-parcel-494018.json"),
    "utf8",
  ),
).features[0].geometry;

export const SANCTUARY_STRUCTURE_ID = "gis:structure:1282177";

function parcelContext(
  overrides: Partial<ResolvedParcelContext> = {},
): ResolvedParcelContext {
  return {
    parcelId: "778273000",
    zoningBase: makeZoningBase(),
    zoningOverlays: makeZoningOverlays(),
    structures: [
      makeStructure({
        structureId: "1282177",
        footprint: SANCTUARY_GEOJSON,
      }),
    ],
    flood: makeFlood(),
    failures: [],
    ...overrides,
  };
}

function canonicalSession(): ResolutionSession {
  return {
    sessionId: "copilot-session-1",
    createdAt: NOW,
    query: "7200 Roosevelt Blvd, Philadelphia, PA",
    addressStage: "RESOLVED",
    addressCandidates: [makeAddressCandidate()],
    selectedAddress: makeAddressCandidate(),
    parcelStage: "RESOLVED",
    parcelCandidates: [
      makeParcelCandidate({
        brtId: "778273000",
        parcelId: "778273000",
        pwdParcelNum: "494018",
        geometry: PARCEL_GEOJSON,
      }),
    ],
    confirmedParcelIds: ["778273000"],
    userConfirmedProperty: true,
    parcelContexts: [parcelContext()],
    captures: [],
  };
}

export type AcceptedPair = {
  envelope: Awaited<ReturnType<typeof createEnvelope>>;
  receipt: unknown;
};

export async function acceptedPair(): Promise<AcceptedPair> {
  const envelope = createEnvelope(canonicalSession());
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
  const committed = (await response.json()) as { receipt: unknown };
  return { envelope, receipt: committed.receipt };
}

export function confirmCommand(overrides: {
  id: string;
  intentText: string;
  normalized: MissionNormalized;
  actorId?: string;
}): MissionCommand {
  return {
    kind: "confirm",
    input: {
      id: overrides.id,
      kind: "mission-constraint",
      intentText: overrides.intentText,
      normalized: overrides.normalized,
      origin: {
        kind: "USER_DECLARED",
        actorId: overrides.actorId ?? "board-chair",
        declaredAt: NOW,
      },
      confirmationState: "CONFIRMED",
      hardOrSoft: "hard",
    },
  };
}

export const CANONICAL_MISSION_COMMANDS: MissionCommand[] = [
  confirmCommand({
    id: "mission:min-sunday-parking",
    intentText: "Keep at least 110 Sunday parking spaces.",
    normalized: { type: "min-parking", spaces: { value: 110, unit: "spaces" } },
  }),
  confirmCommand({
    id: "mission:preserve-sanctuary",
    intentText: "Keep the sanctuary.",
    normalized: {
      type: "preserve-structure",
      structureId: SANCTUARY_STRUCTURE_ID,
    },
  }),
  confirmCommand({
    id: "mission:retain-ownership",
    intentText: "We are not selling the land.",
    normalized: { type: "retain-ownership" },
  }),
];

/** The exact trusted context the Copilot route builds (cached per command log). */
export async function copilotContext(
  commands: MissionCommand[] = CANONICAL_MISSION_COMMANDS,
) {
  const pair = await acceptedPair();
  return copilotContextFor(pair, commands);
}

export type ReadyTrustedContext = Extract<
  TrustedProofContext,
  { status: "ready" }
>;

export async function copilotContextFor(
  pair: AcceptedPair,
  commands: MissionCommand[],
) {
  const trusted = await buildTrustedProofContext(
    pair.envelope,
    pair.receipt as Parameters<typeof buildTrustedProofContext>[1],
    commands,
  );
  expect(trusted.status).toBe("ready");
  const ready = trusted as ReadyTrustedContext;
  return {
    pair,
    trusted: ready,
    context: { trusted: ready, commands } as CopilotToolContext,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fake provider — scripted turns for orchestration evals
// ---------------------------------------------------------------------------

import type {
  CopilotProvider,
  CopilotProviderCall,
  CopilotProviderTurn,
  CopilotToolCall,
} from "../../src/adapters/ai/copilot-provider";

export type ScriptedTurn =
  | {
      kind: "tool-calls";
      calls: Array<{ name: string; args: unknown }>;
      content?: string | null;
    }
  | { kind: "reply"; content: string }
  | { kind: "error"; message: string };

export function toolCall(name: string, args: unknown): CopilotToolCall {
  return {
    id: `call-${name}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    argumentsJson: JSON.stringify(args),
  };
}

/** A provider that replays scripted turns and records every call it received. */
export function fakeProvider(script: ScriptedTurn[]): {
  provider: CopilotProvider;
  calls: CopilotProviderCall[];
} {
  const calls: CopilotProviderCall[] = [];
  const scriptCopy = [...script];
  const provider: CopilotProvider = {
    model: "fake/test-model",
    async complete(call) {
      calls.push(call);
      const next = scriptCopy.shift();
      if (!next) throw new Error("fake provider: script exhausted");
      if (next.kind === "error") {
        const error = new Error(next.message);
        error.name = "CopilotProviderError";
        throw error;
      }
      if (next.kind === "tool-calls") {
        const turn: CopilotProviderTurn = {
          finishReason: "tool_calls",
          content: next.content ?? null,
          toolCalls: next.calls.map((entry) =>
            toolCall(entry.name, entry.args),
          ),
        };
        return turn;
      }
      return { finishReason: "stop", content: next.content, toolCalls: [] };
    },
  };
  return { provider, calls };
}
