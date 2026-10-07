import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectCopilotProvider } from "../../src/adapters/ai/provider-selection";
import { anthropicProviderFromEnv } from "../../src/adapters/ai/anthropic-provider";
import { CopilotProviderError } from "../../src/adapters/ai/copilot-provider";
import type { CopilotChatMessage } from "../../src/adapters/ai/copilot-provider";

/**
 * Issue #10 follow-up — provider selection + Anthropic adapter contract.
 * No real API is called: fetch is mocked for every adapter test. Secrets are
 * never asserted by value beyond presence in headers/body keys.
 */

const GLOO_COMPLETE = {
  ACREVIA_AI_BASE_URL: "https://gloo.example/v1",
  ACREVIA_AI_API_KEY: "gloo-key",
  ACREVIA_AI_MODEL: "gloo-model",
};
const ANTHROPIC_COMPLETE = {
  ANTHROPIC_API_KEY: "anthropic-key",
  ANTHROPIC_MODEL: "anthropic-model-x",
};

describe("provider selection precedence", () => {
  it("1 — AUTO with complete Gloo config selects Gloo", () => {
    const selection = selectCopilotProvider({
      ...GLOO_COMPLETE,
      ...ANTHROPIC_COMPLETE,
    });
    expect(selection.status).toBe("ready");
    if (selection.status !== "ready") return;
    expect(selection.kind).toBe("gloo");
    expect(selection.provider.model).toBe("gloo-model");
  });

  it("2 — AUTO with no Gloo but complete Anthropic selects Anthropic", () => {
    const selection = selectCopilotProvider({ ...ANTHROPIC_COMPLETE });
    expect(selection.status).toBe("ready");
    if (selection.status !== "ready") return;
    expect(selection.kind).toBe("anthropic");
    expect(selection.provider.model).toBe("anthropic-model-x");
  });

  it("3 — AUTO with neither configured reports honest unavailability (missing names only)", () => {
    const selection = selectCopilotProvider({});
    expect(selection.status).toBe("unavailable");
    if (selection.status !== "ready") {
      for (const name of [
        "ACREVIA_AI_BASE_URL",
        "ACREVIA_AI_API_KEY",
        "ACREVIA_AI_MODEL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
      ]) {
        expect(selection.reason).toContain(name);
      }
      // Variable NAMES only — no values ever leak into the reason.
      expect(selection.reason).not.toContain("gloo-key");
      expect(selection.reason).not.toContain("anthropic-key");
    }
  });

  it("4 — explicit gloo with missing config is unavailable; NO silent Anthropic fallback", () => {
    const selection = selectCopilotProvider({
      ACREVIA_AI_PROVIDER: "gloo",
      ...ANTHROPIC_COMPLETE,
      ACREVIA_AI_MODEL: "partial-gloo",
    });
    expect(selection.status).toBe("unavailable");
    if (selection.status !== "ready") {
      expect(selection.reason).toContain("ACREVIA_AI_PROVIDER=gloo");
      expect(selection.reason).toContain("ACREVIA_AI_BASE_URL");
      expect(selection.reason).toContain("ACREVIA_AI_API_KEY");
      expect(selection.reason).toContain("No fallback provider was used");
      expect(selection.reason).not.toContain("ACREVIA_AI_MODEL"); // present, so not missing
    }
  });

  it("5 — explicit anthropic with missing config is unavailable", () => {
    const selection = selectCopilotProvider({
      ACREVIA_AI_PROVIDER: "anthropic",
      ...GLOO_COMPLETE,
      ANTHROPIC_MODEL: "some-model",
    });
    expect(selection.status).toBe("unavailable");
    if (selection.status !== "ready") {
      expect(selection.reason).toContain("ACREVIA_AI_PROVIDER=anthropic");
      expect(selection.reason).toContain("ANTHROPIC_API_KEY");
      expect(selection.reason).toContain("No fallback provider was used");
    }
  });

  it("rejects an unsupported ACREVIA_AI_PROVIDER value honestly", () => {
    const selection = selectCopilotProvider({
      ACREVIA_AI_PROVIDER: "openai",
      ...GLOO_COMPLETE,
    });
    expect(selection.status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Anthropic adapter contract (mocked fetch)
// ---------------------------------------------------------------------------

const TOOL_SPECS = [
  {
    name: "get_project_context",
    description: "Current trusted project state.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

function mockFetchSequence(
  responses: Array<{ status?: number; body: unknown }>,
) {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const queue = [...responses];
  const fetchMock = vi
    .fn()
    .mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string) as Record<string, unknown>,
      });
      const next = queue.shift();
      if (!next) throw new Error("mock fetch exhausted");
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
      });
    });
  return { fetchMock, calls };
}

const CONVERSATION: CopilotChatMessage[] = [
  { role: "system", content: "SYSTEM POLICY" },
  { role: "user", content: "What are our options?" },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Anthropic adapter", () => {
  it("6 — request translation: system top-level, messages, tool schema, key in header not body", async () => {
    const { fetchMock, calls } = mockFetchSequence([
      {
        body: {
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    expect(provider).not.toBeNull();
    await provider!.complete({
      messages: CONVERSATION,
      tools: TOOL_SPECS,
    });
    const request = calls[0];
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    // Key via header (never the body), required version header.
    expect(request.headers["x-api-key"]).toBe("anthropic-key");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.stringify(request.body)).not.toContain("anthropic-key");
    // System prompt is top-level, not a message.
    expect(request.body.system).toBe("SYSTEM POLICY");
    const messages = request.body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(messages[0].role).toBe("user");
    expect(JSON.stringify(messages)).not.toContain("SYSTEM POLICY");
    // Tools use the Anthropic shape.
    const tools = request.body.tools as Array<{
      name: string;
      description: string;
      input_schema: unknown;
    }>;
    expect(tools[0].name).toBe("get_project_context");
    expect(tools[0].description).toBe("Current trusted project state.");
    expect(tools[0].input_schema).toEqual(TOOL_SPECS[0].parameters);
    expect(request.body.model).toBe("anthropic-model-x");
  });

  it("7 — response tool_use blocks become normalized CopilotToolCalls", async () => {
    const { fetchMock } = mockFetchSequence([
      {
        body: {
          content: [
            { type: "text", text: "Checking the project." },
            {
              type: "tool_use",
              id: "tu_1",
              name: "get_project_context",
              input: { focus: "all" },
            },
          ],
          stop_reason: "tool_use",
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    const turn = await provider!.complete({
      messages: CONVERSATION,
      tools: TOOL_SPECS,
    });
    expect(turn.finishReason).toBe("tool_calls");
    expect(turn.content).toBe("Checking the project.");
    expect(turn.toolCalls).toEqual([
      {
        id: "tu_1",
        name: "get_project_context",
        argumentsJson: '{"focus":"all"}',
      },
    ]);
  });

  it("8 — tool results continue as tool_result blocks in a user message; the next round works", async () => {
    const { fetchMock, calls } = mockFetchSequence([
      {
        body: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "get_project_context",
              input: {},
            },
          ],
          stop_reason: "tool_use",
        },
      },
      {
        body: {
          content: [{ type: "text", text: "final grounded answer" }],
          stop_reason: "end_turn",
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    const first = await provider!.complete({
      messages: CONVERSATION,
      tools: TOOL_SPECS,
    });
    expect(first.toolCalls).toHaveLength(1);

    // Exactly the continuation the orchestrator builds after a tool round.
    const continuation: CopilotChatMessage[] = [
      ...CONVERSATION,
      {
        role: "assistant",
        content: first.content,
        tool_calls: first.toolCalls,
      },
      {
        role: "tool",
        tool_call_id: "tu_1",
        name: "get_project_context",
        content: '{"homes": 123}',
      },
    ];
    const second = await provider!.complete({
      messages: continuation,
      tools: TOOL_SPECS,
    });

    // The outgoing request carries tool_use in the assistant message and a
    // tool_result block in a user message (roles stay alternating).
    const messages = calls[1].body.messages as Array<{
      role: string;
      content: Array<{ type: string; tool_use_id?: string; id?: string }>;
    }>;
    const assistant = messages.find((message) => message.role === "assistant");
    expect(
      assistant?.content.some(
        (block) => block.type === "tool_use" && block.id === "tu_1",
      ),
    ).toBe(true);
    const toolResultMessage = messages.find((message) =>
      message.content.some((block) => block.type === "tool_result"),
    );
    expect(toolResultMessage?.role).toBe("user");
    expect(
      toolResultMessage?.content.some(
        (block) => block.type === "tool_result" && block.tool_use_id === "tu_1",
      ),
    ).toBe(true);
    // Alternation preserved: no two adjacent same-role messages.
    for (let index = 1; index < messages.length; index += 1) {
      expect(messages[index].role).not.toBe(messages[index - 1].role);
    }
    // The next model round completes normally.
    expect(second.finishReason).toBe("stop");
    expect(second.content).toBe("final grounded answer");
    expect(second.toolCalls).toEqual([]);
  });

  it("9 — normal text response becomes the normalized final reply", async () => {
    const { fetchMock } = mockFetchSequence([
      {
        body: {
          content: [{ type: "text", text: "The verified answer." }],
          stop_reason: "end_turn",
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    const turn = await provider!.complete({
      messages: CONVERSATION,
      tools: TOOL_SPECS,
    });
    expect(turn).toEqual({
      finishReason: "stop",
      content: "The verified answer.",
      toolCalls: [],
    });
  });

  it("maps max_tokens stop reason to the length finish and returns null content for empty text", async () => {
    const { fetchMock } = mockFetchSequence([
      { body: { content: [], stop_reason: "max_tokens" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    const turn = await provider!.complete({
      messages: CONVERSATION,
      tools: TOOL_SPECS,
    });
    expect(turn.finishReason).toBe("length");
    expect(turn.content).toBeNull();
  });

  it("10 — provider/network errors surface through the same CopilotProviderError path", async () => {
    const { fetchMock } = mockFetchSequence([
      {
        status: 529,
        body: { type: "error", error: { message: "overloaded" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const provider = anthropicProviderFromEnv(ANTHROPIC_COMPLETE);
    await expect(
      provider!.complete({ messages: CONVERSATION, tools: TOOL_SPECS }),
    ).rejects.toThrow(CopilotProviderError);

    const networkFailure = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", networkFailure);
    await expect(
      provider!.complete({ messages: CONVERSATION, tools: TOOL_SPECS }),
    ).rejects.toThrow(CopilotProviderError);
  });

  it("returns null provider (never throws) when Anthropic config is incomplete", () => {
    expect(anthropicProviderFromEnv({ ANTHROPIC_API_KEY: "k" })).toBeNull();
    expect(anthropicProviderFromEnv({ ANTHROPIC_MODEL: "m" })).toBeNull();
    expect(anthropicProviderFromEnv({})).toBeNull();
  });
});
