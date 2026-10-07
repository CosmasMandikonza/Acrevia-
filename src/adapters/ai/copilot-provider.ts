/**
 * Copilot AI provider adapter (issue #10).
 *
 * A single, dependency-free adapter for any OpenAI-compatible chat-completions
 * endpoint (Gloo AI Studio / Gloo inference, or any compatible gateway). It
 * speaks tool/function calling; streaming is deliberately not implemented —
 * the rail renders tool actions, not typing theater.
 *
 * Configuration (all three required to enable the Copilot; documented in
 * .env.example):
 *   ACREVIA_AI_BASE_URL  e.g. https://<gloo-ai-host>/v1
 *   ACREVIA_AI_API_KEY    bearer token, never committed
 *   ACREVIA_AI_MODEL      provider model id
 *
 * When the provider is not configured the Copilot is honestly unavailable —
 * no canned prose, no fabricated answers — and every deterministic Acrevia
 * surface keeps working (the route returns `ai-unavailable` before any model
 * call). Provider failures surface as CopilotProviderError and never break
 * deterministic Acrevia.
 */

export type CopilotToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (derived from the typed Zod schemas). */
  parameters: Record<string, unknown>;
};

export type CopilotToolCall = {
  id: string;
  name: string;
  /** Raw JSON arguments exactly as the provider returned them. */
  argumentsJson: string;
};

export type CopilotChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: CopilotToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type CopilotProviderTurn = {
  finishReason: "stop" | "tool_calls" | "length" | "other";
  content: string | null;
  toolCalls: CopilotToolCall[];
};

export type CopilotProviderCall = {
  messages: CopilotChatMessage[];
  tools: CopilotToolSpec[];
};

export type CopilotProvider = {
  model: string;
  complete(call: CopilotProviderCall): Promise<CopilotProviderTurn>;
};

export class CopilotProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CopilotProviderError";
  }
}

export type CopilotProviderEnv = {
  ACREVIA_AI_BASE_URL?: string;
  ACREVIA_AI_API_KEY?: string;
  ACREVIA_AI_MODEL?: string;
};

/** The env vars required to enable the Copilot (for honest unavailability UI). */
export const COPILOT_AI_ENV_KEYS = [
  "ACREVIA_AI_BASE_URL",
  "ACREVIA_AI_API_KEY",
  "ACREVIA_AI_MODEL",
] as const;

export function copilotProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): CopilotProvider | null {
  const baseUrl = env.ACREVIA_AI_BASE_URL?.trim();
  const apiKey = env.ACREVIA_AI_API_KEY?.trim();
  const model = env.ACREVIA_AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return {
    model,
    async complete(call) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: call.messages,
            tools: call.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: "auto",
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (cause) {
        throw new CopilotProviderError(
          cause instanceof Error ? `AI provider request failed: ${cause.message}` : "AI provider request failed",
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
        throw new CopilotProviderError("AI provider returned a non-JSON response");
      }
      const choice = (payload as { choices?: unknown[] }).choices?.[0] as
        | {
            finish_reason?: string;
            message?: { content?: string | null; tool_calls?: unknown[] };
          }
        | undefined;
      if (!choice?.message) {
        throw new CopilotProviderError("AI provider response contained no message");
      }
      const toolCalls: CopilotToolCall[] = (choice.message.tool_calls ?? [])
        .map((raw) => {
          const call_ = raw as {
            id?: string;
            function?: { name?: string; arguments?: string };
          };
          return {
            id: call_.id ?? "",
            name: call_.function?.name ?? "",
            argumentsJson: call_.function?.arguments ?? "{}",
          };
        })
        .filter((call_) => call_.name.length > 0);
      const finish = choice.finish_reason;
      return {
        finishReason:
          finish === "stop" || finish === "tool_calls" || finish === "length" ? finish : "other",
        content: typeof choice.message.content === "string" ? choice.message.content : null,
        toolCalls,
      };
    },
  };
}
