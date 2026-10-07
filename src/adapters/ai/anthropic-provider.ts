import type {
  CopilotChatMessage,
  CopilotProvider,
  CopilotProviderTurn,
  CopilotToolCall,
  CopilotToolSpec,
} from "./copilot-provider";
import { CopilotProviderError } from "./copilot-provider";

/**
 * Anthropic Messages API adapter (provider fallback, issue #10 follow-up).
 *
 * Satisfies the EXISTING CopilotProvider contract, so orchestration, tools,
 * grounding, and the trust boundary never learn which vendor is active.
 * Translation only:
 *
 *   internal system prompt        → top-level `system` field
 *   internal user/assistant       → user/assistant messages
 *   assistant tool_calls          → `tool_use` content blocks
 *   internal tool results         → `tool_result` blocks inside a user
 *                                   message (consecutive results merged,
 *                                   results first — Anthropic alternation
 *                                   and tool_result placement rules)
 *   CopilotToolSpec               → { name, description, input_schema }
 *
 * Response: `tool_use` blocks → CopilotToolCall; stop_reason end_turn →
 * "stop", tool_use → "tool_calls", max_tokens → "length", else "other".
 *
 * Dependency-free fetch, 45s timeout, no streaming — same philosophy as the
 * Gloo/OpenAI-compatible adapter. Errors surface through the same
 * CopilotProviderError path.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
};

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json || "{}") ?? {};
  } catch {
    return {};
  }
}

function translateMessages(messages: CopilotChatMessage[]): AnthropicMessage[] {
  const translated: AnthropicMessage[] = [];
  const pushMerged = (
    role: "user" | "assistant",
    blocks: AnthropicContentBlock[],
  ) => {
    if (blocks.length === 0) return;
    // Anthropic expects alternating roles; consecutive same-role turns
    // (e.g. several tool results) merge into one message. tool_result
    // blocks come first within a merged user message.
    const previous = translated[translated.length - 1];
    if (previous && previous.role === role) {
      previous.content = [...blocks, ...previous.content];
      return;
    }
    translated.push({ role, content: blocks });
  };

  for (const message of messages) {
    // Tool results ride in user messages as tool_result blocks (checked
    // first: the "system" | "user" union member does not narrow away by
    // fall-through).
    if (message.role === "tool") {
      pushMerged("user", [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: message.content,
        },
      ]);
      continue;
    }
    if (message.role === "system") continue; // handled separately (top-level)
    if (message.role === "user") {
      pushMerged("user", [{ type: "text", text: message.content }]);
      continue;
    }
    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parseArguments(call.argumentsJson),
        });
      }
      pushMerged("assistant", blocks);
      continue;
    }
  }
  return translated;
}

export function anthropicProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): CopilotProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.ANTHROPIC_MODEL?.trim();
  if (!apiKey || !model) return null;
  return {
    model,
    async complete(call) {
      const system = call.messages
        .filter((message) => message.role === "system")
        .map((message) => (message as { content: string }).content)
        .join("\n\n");
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            // No `temperature`: current Anthropic models reject it as
            // deprecated; determinism pressure comes from the system prompt
            // and the grounding guard, not sampling knobs.
            ...(system ? { system } : {}),
            messages: translateMessages(call.messages),
            tools: call.tools.map((tool: CopilotToolSpec) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
            tool_choice: { type: "auto" },
          }),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (cause) {
        throw new CopilotProviderError(
          cause instanceof Error
            ? `AI provider request failed: ${cause.message}`
            : "AI provider request failed",
        );
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new CopilotProviderError(
          `AI provider returned ${response.status}${detail ? `: ${detail}` : ""}`,
          response.status,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new CopilotProviderError(
          "AI provider returned a non-JSON response",
        );
      }
      const typed = payload as {
        type?: string;
        error?: { message?: string };
        stop_reason?: string;
        content?: Array<{
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>;
      };
      if (typed.type === "error" || typed.error) {
        throw new CopilotProviderError(
          `AI provider returned an error: ${typed.error?.message ?? "unknown error"}`,
        );
      }
      const blocks = typed.content ?? [];
      const text = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
      const toolCalls: CopilotToolCall[] = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id ?? "",
          name: block.name ?? "",
          argumentsJson: JSON.stringify(block.input ?? {}),
        }))
        .filter((call_) => call_.name.length > 0);
      const stop = typed.stop_reason;
      const turn: CopilotProviderTurn = {
        finishReason:
          stop === "end_turn"
            ? "stop"
            : stop === "tool_use"
              ? "tool_calls"
              : stop === "max_tokens"
                ? "length"
                : "other",
        content: text.length > 0 ? text : null,
        toolCalls,
      };
      return turn;
    },
  };
}
