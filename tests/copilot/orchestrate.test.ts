import { beforeAll, describe, expect, it } from "vitest";
import { runCopilotTurn } from "../../src/application/copilot/orchestrate";
import { POST as copilotTurnPost } from "../../src/app/api/copilot/turn/route";
import { buildMissionState } from "../../src/application/mission/rebuild";
import type { CommitReceipt } from "../../src/adapters/gis/commit-receipt";
import type { CopilotProvider } from "../../src/adapters/ai/copilot-provider";
import {
  CANONICAL_MISSION_COMMANDS,
  acceptedPair,
  confirmCommand,
  copilotContextFor,
  fakeProvider,
} from "./helpers";

/**
 * Issue #10 — orchestration evals with a deterministic scripted provider and
 * route-level adversarial cases. These prove the LOOP and the BOUNDARIES
 * (tool use, grounding retry/fallback, honest AI failure, confirm-before-
 * mutate), not model prose quality.
 */

let harness: Awaited<ReturnType<typeof copilotContextFor>>;

beforeAll(async () => {
  harness = await copilotContextFor(
    await acceptedPair(),
    CANONICAL_MISSION_COMMANDS,
  );
});

function turn(provider: CopilotProvider, message: string) {
  return runCopilotTurn({
    message,
    history: [],
    context: harness.context,
    provider,
  });
}

describe("hero interactions through the generic tool loop", () => {
  it("1 — 'Keep at least 90 Sunday parking spaces' becomes a typed proposal, not a mutation", async () => {
    const { provider } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [
          { name: "get_project_context", args: {} },
          {
            name: "propose_mission_change",
            args: {
              missionType: "min-parking",
              value: 90,
              intentText: "Keep at least 90 Sunday parking spaces.",
            },
          },
        ],
      },
      {
        kind: "reply",
        content:
          "Proposed: lower the Sunday parking minimum from 110 spaces to 90 spaces. Confirm below to apply it through the mission command boundary.",
      },
    ]);
    const result = await turn(
      provider,
      "Keep at least 90 Sunday parking spaces.",
    );
    expect(result.status).toBe("ok");
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.normalized).toEqual({
      type: "min-parking",
      spaces: { value: 90, unit: "spaces" },
    });
    expect(result.proposal!.current?.summary).toContain("110");
    expect(result.grounding.ok).toBe(true);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "get_project_context",
      "propose_mission_change",
    ]);
  });

  it("2 — 'Why can't 124 homes fit?' is answered from the deterministic refusal", async () => {
    const { provider } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [{ name: "explain_feasibility", args: { targetHomes: 124 } }],
      },
      {
        kind: "reply",
        content:
          "The deterministic solver refuses 124 homes: the modeled upper bound is 123 homes under the current verified law and mission rules. Sunday parking (mission-locked) is among the binding constraints.",
      },
    ]);
    const result = await turn(provider, "Why can't 124 homes fit?");
    expect(result.status).toBe("ok");
    expect(result.grounding.ok).toBe(true);
    const feasibility = result.toolRuns.find(
      (run) => run.tool === "explain_feasibility",
    );
    expect(feasibility?.ok).toBe(true);
  });

  it("3 — 'Prepare this scenario for the board' returns the trusted board artifact with the grounded narrative as its executive summary", async () => {
    const reply =
      "Board brief ready from the current verified state — open it below. It separates modeled outcomes from assumptions and the items that still require experts.";
    const { provider } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [{ name: "prepare_board_context", args: {} }],
      },
      { kind: "reply", content: reply },
    ]);
    const result = await turn(provider, "Prepare this scenario for the board.");
    expect(result.board).not.toBeNull();
    const board = result.board as {
      boundaryNotice?: string;
      executiveSummary?: string;
      property?: { address?: string };
    };
    expect(board.boundaryNotice).toContain("not legal certification");
    // Review correction 2: the grounded final reply becomes the artifact's
    // executive summary; deterministic sections remain the source of facts.
    expect(result.grounding.ok).toBe(true);
    expect(board.executiveSummary).toBe(reply);
    expect(board.property?.address).toBeTruthy();
  });

  it("3b — rejected ungrounded prose can never enter the board artifact; the safe fallback becomes the summary", async () => {
    const { provider } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [{ name: "prepare_board_context", args: {} }],
      },
      {
        kind: "reply",
        content: "This option delivers 87 homes with certainty.",
      },
      { kind: "reply", content: "No — 87 homes are guaranteed." },
    ]);
    const result = await turn(provider, "Prepare this scenario for the board.");
    expect(result.grounding.ok).toBe(false);
    expect(result.grounding.replacedWithFacts).toBe(true);
    expect(result.board).not.toBeNull();
    const board = result.board as {
      executiveSummary?: string;
      boundaryNotice?: string;
      selectedScenario?: { homes?: number };
    };
    expect(board.executiveSummary).toContain("could not ground");
    expect(board.executiveSummary).not.toContain("87 homes");
    // The deterministic structured sections stay intact and authoritative.
    expect(board.boundaryNotice).toContain("not legal certification");
    expect(typeof board.selectedScenario?.homes).toBe("number");
  });

  it("confirmation applies through the EXISTING typed command boundary and recomputes downstream", async () => {
    const receipt = harness.pair.receipt as CommitReceipt;
    // Before confirm: mission parking is 110 under the canonical log.
    const before = buildMissionState(
      harness.pair.envelope,
      receipt,
      CANONICAL_MISSION_COMMANDS,
    );
    expect(
      before.missionConstraints.find(
        (mission) => mission.id === "mission:min-sunday-parking",
      )?.normalized,
    ).toEqual({ type: "min-parking", spaces: { value: 110, unit: "spaces" } });

    // The confirm command the rail appends after the user clicks Confirm:
    const confirm = confirmCommand({
      id: "mission:min-sunday-parking",
      intentText: "Keep at least 90 Sunday parking spaces.",
      normalized: {
        type: "min-parking",
        spaces: { value: 90, unit: "spaces" },
      },
      actorId: "church-leader",
    });
    const after = buildMissionState(harness.pair.envelope, receipt, [
      ...CANONICAL_MISSION_COMMANDS,
      confirm,
    ]);
    expect(
      after.missionConstraints.find(
        (mission) => mission.id === "mission:min-sunday-parking",
      )?.normalized,
    ).toEqual({ type: "min-parking", spaces: { value: 90, unit: "spaces" } });
    expect(after.revision).toBeGreaterThan(before.revision);
    // Recompute is real: the changed mission produces a different trusted project state.
    expect(after.attestation.projectHash).not.toBe(
      before.attestation.projectHash,
    );
  });
});

describe("grounding enforcement in the loop", () => {
  it("retries once when the model cites a number absent from tool state, and accepts the correction", async () => {
    const { provider, calls } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [{ name: "get_project_context", args: {} }],
      },
      {
        kind: "reply",
        content: "Sure — 87 homes could fit with a small variance.",
      },
      {
        kind: "reply",
        content:
          "I could not verify that claim. The verified picture: the modeled upper bound is 123 homes.",
      },
    ]);
    const result = await turn(provider, "How many homes can fit?");
    expect(result.grounding.ok).toBe(true);
    expect(result.grounding.replacedWithFacts).toBe(false);
    expect(calls.length).toBe(3);
    expect(result.reply).toContain("123");
  });

  it("replaces an uncorrectable reply with deterministic tool facts — never unverified numbers", async () => {
    const { provider } = fakeProvider([
      { kind: "reply", content: "87 homes, possibly 95." },
      { kind: "reply", content: "No really, 87 homes fits." },
    ]);
    const result = await turn(provider, "How many homes can fit?");
    expect(result.grounding.ok).toBe(false);
    expect(result.grounding.violations).toContain("87");
    expect(result.grounding.replacedWithFacts).toBe(true);
    expect(result.reply).toContain("could not ground");
    expect(result.reply).not.toContain("87 homes fits");
  });
});

describe("honest failure surfacing", () => {
  it("records failed tool calls and feeds the error back to the model as data", async () => {
    const { provider, calls } = fakeProvider([
      { kind: "tool-calls", calls: [{ name: "not_a_real_tool", args: {} }] },
      { kind: "reply", content: "That tool does not exist on this project." },
    ]);
    const result = await turn(provider, "Do something impossible.");
    expect(result.toolRuns[0].ok).toBe(false);
    expect(result.toolRuns[0].error).toContain("unknown tool");
    const toolMessage = calls[1].messages.find(
      (message) => message.role === "tool",
    ) as { content: string } | undefined;
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.content).toContain("unknown tool");
    expect(result.status).toBe("ok");
  });

  it("propagates provider failure after tools ran (route maps it to ai-error)", async () => {
    const { provider } = fakeProvider([
      {
        kind: "tool-calls",
        calls: [{ name: "get_project_context", args: {} }],
      },
      { kind: "error", message: "connection reset" },
    ]);
    await expect(turn(provider, "What do we have?")).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("POST /api/copilot/turn — route trust boundary", () => {
  const ENV_KEYS = [
    "ACREVIA_AI_PROVIDER",
    "ACREVIA_AI_BASE_URL",
    "ACREVIA_AI_API_KEY",
    "ACREVIA_AI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
  ] as const;
  let saved: Record<string, string | undefined>;

  function post(body: unknown) {
    return copilotTurnPost(
      new Request("http://localhost/api/copilot/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("answers ai-unavailable honestly when the provider is unconfigured (no canned prose)", async () => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    try {
      const response = await post({
        envelope: { session: {}, signature: "x" },
        receipt: { payload: {}, signature: "x" },
        commands: [],
        message: "Hello?",
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        status: string;
        reason: string;
      };
      expect(payload.status).toBe("ai-unavailable");
      expect(payload.reason).toContain("ACREVIA_AI_BASE_URL");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects a forged pair at the same boundary as every trusted route", async () => {
    const previous = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    process.env.ACREVIA_AI_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.ACREVIA_AI_API_KEY = "test-key";
    process.env.ACREVIA_AI_MODEL = "test-model";
    try {
      const response = await post({
        envelope: { session: { sessionId: "forged" }, signature: "deadbeef" },
        receipt: {
          payload: { projectId: "gis:778273000" },
          signature: "deadbeef",
        },
        commands: [],
        message: "What can we build?",
      });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { name?: string };
      expect(payload.name).toBe("PairVerificationError");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects oversized history (the only conversation memory is bounded client state)", async () => {
    const response = await post({
      envelope: {},
      receipt: {},
      commands: [],
      message: "Hi",
      history: Array.from({ length: 7 }, (_, index) => ({
        role: "user" as const,
        content: `message ${index}`,
      })),
    });
    expect(response.status).toBe(400);
  });
});
