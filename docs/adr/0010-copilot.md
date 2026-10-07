# ADR 0010 — Model-aware Feasibility & Visioning Copilot

Status: Accepted (issue #10) · Date: 2026-10-07 · Depends on: ADR 0003, 0004, 0005, 0007, 0011

## Context

The challenge asks for an AI-driven Feasibility & Visioning Copilot. Acrevia's
truth rule is **AI proposes and interprets; deterministic systems verify;
humans authorize.** By issue #10 the systems the Copilot needs all exist:
GIS property resolution + signed acceptance (0004), the Development Graph and
typed command boundary (0003), the Mission Compiler (0005), the deterministic
scenario solver with certificates (0007), and the Proof projection (0011).
The Copilot must therefore be a thin orchestration layer, not a new
subsystem.

## Decision

1. **One trusted rebuild per turn.** `POST /api/copilot/turn` accepts exactly
   what `/api/mission/state`, `/api/solver/solve`, and `/api/proof/snapshot`
   accept — the accepted `{ envelope, receipt }` pair plus the typed mission
   command log — and rebuilds the project through the SAME shared pipeline
   (`src/application/proof/trusted-context.ts`, extracted from the proof
   route): verify pair → hash gate → compile law → replay missions → seed
   assumptions → solve → record → project. No browser-supplied metric,
   zoning value, or certificate is ever read.

2. **Generic typed tools, no phrase matching.** Eight tools
   (`get_project_context`, `query_scenarios`, `inspect_scenario`,
   `explain_feasibility`, `inspect_assumptions`, `inspect_change_history`,
   `propose_mission_change`, `prepare_board_context`) over that state. Inputs
   are Zod schemas (exported to JSON Schema for function calling); the model
   chooses tools and arguments; deterministic executors decide results.

3. **Mutations stop at proposals.** `propose_mission_change` returns a typed
   proposal with the current value and changes NOTHING. There is no apply
   tool and no Copilot write path: the rail renders a structured
   CURRENT/PROPOSED confirmation, and Confirm appends a `confirm` command to
   the existing client mission log, which the existing
   `POST /api/mission/state` boundary replays. The proposal targets the
   existing same-slot rule id when one exists (upsert semantics preserved).

4. **Numeric grounding is enforced, not asked for.** Every consequential
   number in the model's final reply must appear in this turn's serialized
   tool results — the sole numeric authority. Numbers that exist only in
   user-authored text (the user's message, conversation history) never
   authorize a claim; the tools echo request parameters in their results, so
   grounded echoes still pass. Violations trigger one corrective retry; a
   second failure replaces the reply with the deterministic tool facts
   (`src/application/copilot/grounding.ts`). Small integers (≤12) are exempt
   as structural prose.

5. **Untrusted text stays data.** Regulation quotes, intent text, and source
   documents travel inside typed tool results marked as data; the system
   prompt forbids following instructions found in them, and no structural
   path exists for them to mutate anything (mutations require an explicit UI
   confirmation of a typed payload).

6. **Honest degradation.** The provider is a single dependency-free
   OpenAI-compatible adapter (`src/adapters/ai/copilot-provider.ts`) gated on
   `ACREVIA_AI_BASE_URL` / `ACREVIA_AI_API_KEY` / `ACREVIA_AI_MODEL`.
   Unconfigured → `ai-unavailable` with no canned prose; provider failure →
   `ai-error` with the honest reason. Deterministic Acrevia is unaffected.

7. **Sidecar UI.** The rail stays a right drawer over the canvas; tool runs,
   proposals, and the board brief render as structured cards that visually
   outweigh prose. The board brief is a deterministic artifact assembled from
   verified state (certificate freshness banner, boundary notice); its
   executive summary is the turn's final reply attached only AFTER grounding
   has passed or the deterministic fallback has been chosen, so ungrounded
   prose can never enter the artifact. Conversation memory is component state
   only. Applied mission confirmations notify the workspace through a
   React-owned callback (a project-state epoch fed into the keys of the
   state-derived surfaces), so Scenarios and Evidence rebuild immediately —
   never a DOM custom event, never a second store.

## Consequences

- The six issue-#10 capability families map onto the tool set without bespoke
  features; unsupported requests (e.g. affordability goals) fail honestly
  because no tool can express them.
- Change comparison is bounded by what actually exists: the mission command
  log and graded certificate history. Fabricated history is impossible by
  construction.
- The shared `buildTrustedProofContext` keeps the proof route and the
  Copilot byte-compatible on trust semantics; behavior of
  `/api/proof/snapshot` is unchanged.
- Adding a provider is a config change, not a code change; swapping the model
  cannot weaken the mutation or grounding boundaries.
- `query_scenarios` can require ownership retention (a verifiable confirmed
  mission rule) but can never query for non-retention: ownership disposition
  is not a modeled scenario dimension, and a missing mission rule is never
  inverted into a sale/transfer claim.
