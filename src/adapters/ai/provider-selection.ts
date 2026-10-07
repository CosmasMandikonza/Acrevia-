import type { CopilotProvider } from "./copilot-provider";
import { copilotProviderFromEnv } from "./copilot-provider";
import { anthropicProviderFromEnv } from "./anthropic-provider";

/**
 * Copilot provider selection (issue #10 follow-up).
 *
 * Gloo AI Studio (any OpenAI-compatible endpoint) remains the intended
 * hackathon provider; Anthropic is the working fallback while Gloo promo
 * funding is unavailable. Selection is configuration-only — orchestration,
 * tools, grounding, and the trust boundary are provider-agnostic.
 *
 * `ACREVIA_AI_PROVIDER`: auto (default) | gloo | anthropic.
 *  - auto: complete Gloo config wins; else complete Anthropic config; else
 *    honest unavailability (missing variable NAMES only, never values).
 *  - explicit gloo/anthropic: that provider is REQUIRED — an incomplete
 *    configuration never silently falls through to the other provider.
 */

export const GLOO_ENV_KEYS = [
  "ACREVIA_AI_BASE_URL",
  "ACREVIA_AI_API_KEY",
  "ACREVIA_AI_MODEL",
] as const;
export const ANTHROPIC_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

export type CopilotProviderKind = "gloo" | "anthropic";

export type CopilotProviderSelection =
  | { status: "ready"; provider: CopilotProvider; kind: CopilotProviderKind }
  | { status: "unavailable"; reason: string };

export function selectCopilotProvider(
  env: Record<string, string | undefined> = process.env,
): CopilotProviderSelection {
  const requestedRaw = env.ACREVIA_AI_PROVIDER?.trim().toLowerCase() ?? "";
  const requested = requestedRaw === "" ? "auto" : requestedRaw;

  if (
    requested !== "auto" &&
    requested !== "gloo" &&
    requested !== "anthropic"
  ) {
    return {
      status: "unavailable",
      reason: `ACREVIA_AI_PROVIDER must be one of: auto, gloo, anthropic (received an unsupported value). All deterministic Acrevia surfaces keep working without the Copilot.`,
    };
  }

  const glooProvider = copilotProviderFromEnv(env);
  const anthropicProvider = anthropicProviderFromEnv(env);
  const missing = (keys: readonly string[]) =>
    keys.filter((key) => !env[key]?.trim());

  if (requested === "gloo") {
    // Explicit selection: REQUIRED provider, no silent fallback.
    if (!glooProvider) {
      return {
        status: "unavailable",
        reason: `ACREVIA_AI_PROVIDER=gloo requires a complete Gloo configuration; missing: ${missing(GLOO_ENV_KEYS).join(", ")}. No fallback provider was used. All deterministic Acrevia surfaces keep working without the Copilot.`,
      };
    }
    return { status: "ready", provider: glooProvider, kind: "gloo" };
  }

  if (requested === "anthropic") {
    if (!anthropicProvider) {
      return {
        status: "unavailable",
        reason: `ACREVIA_AI_PROVIDER=anthropic requires a complete Anthropic configuration; missing: ${missing(ANTHROPIC_ENV_KEYS).join(", ")}. No fallback provider was used. All deterministic Acrevia surfaces keep working without the Copilot.`,
      };
    }
    return { status: "ready", provider: anthropicProvider, kind: "anthropic" };
  }

  // auto: Gloo when complete, else Anthropic, else honest unavailability.
  if (glooProvider)
    return { status: "ready", provider: glooProvider, kind: "gloo" };
  if (anthropicProvider)
    return { status: "ready", provider: anthropicProvider, kind: "anthropic" };
  return {
    status: "unavailable",
    reason: `No AI provider is configured. Provide the Gloo variables (${GLOO_ENV_KEYS.join(", ")}) or the Anthropic variables (${ANTHROPIC_ENV_KEYS.join(", ")}). Missing: ${[...missing(GLOO_ENV_KEYS), ...missing(ANTHROPIC_ENV_KEYS)].join(", ")}. All deterministic Acrevia surfaces keep working without the Copilot.`,
  };
}
