// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectCopilotProvider } from "../../src/adapters/ai/provider-selection";
import { runCopilotTurn } from "../../src/application/copilot/orchestrate";
import { executeCopilotTool } from "../../src/application/copilot/tools";
import { ProjectCodec } from "../../src/adapters/persistence/project-codec";
import { CopilotProviderError } from "../../src/adapters/ai/copilot-provider";
import {
  CANONICAL_MISSION_COMMANDS,
  acceptedPair,
  copilotContextFor,
} from "./helpers";

/**
 * ONE-OFF live provider validation (issue #10 follow-up). Never runs in the
 * normal suite: requires ACREVIA_LIVE_VALIDATION=1 and loads credentials
 * from .env.local IN-PROCESS (never printed, never committed). Prints only
 * derived capture fields — model id, tool names/args, grounding status, and
 * a short reply excerpt — never raw provider payloads or headers.
 */

const live = process.env.ACREVIA_LIVE_VALIDATION === "1";

if (live) {
  try {
    const raw = readFileSync(
      join(import.meta.dirname, "../../.env.local"),
      "utf8",
    );
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env.local — selection will report unavailability honestly
  }
}

describe.skipIf(!live)(
  "LIVE Anthropic provider validation (5 canonical prompts)",
  () => {
    it(
      "runs the five demo prompts against the real provider over canonical trusted state",
      { timeout: 600_000 },
      async () => {
        const selection = selectCopilotProvider();
        expect(selection.status).toBe("ready");
        if (selection.status !== "ready") return;
        console.log(`PROVIDER SELECTED: ${selection.kind}`);
        console.log(`MODEL: ${selection.provider.model}`);

        const harness = await copilotContextFor(
          await acceptedPair(),
          CANONICAL_MISSION_COMMANDS,
        );
        const projectBefore = ProjectCodec.encode(harness.trusted.project);

        const prompts = [
          "What are our strongest options if we keep ownership?",
          "Keep at least 90 Sunday parking spaces.",
          "Why can't 124 homes fit?",
          "What are we still assuming?",
          "Prepare this scenario for the board.",
        ];

        for (const prompt of prompts) {
          let result: Awaited<ReturnType<typeof runCopilotTurn>> | null = null;
          let lastError: unknown = null;
          for (let attempt = 0; attempt < 2 && result === null; attempt += 1) {
            try {
              result = await runCopilotTurn({
                message: prompt,
                history: [],
                context: harness.context,
                provider: selection.provider,
              });
            } catch (cause) {
              if (!(cause instanceof CopilotProviderError)) throw cause;
              lastError = cause;
            }
          }
          if (result === null)
            throw new Error(`provider failed twice: ${String(lastError)}`);

          console.log("\nPROMPT:", prompt);
          console.log(
            "TOOLS SELECTED:",
            result.toolRuns.map((run) => run.tool).join(", ") || "(none)",
          );
          console.log(
            "TOOL ARGUMENTS:",
            result.toolRuns
              .map((run) => JSON.stringify(run.args))
              .join(" | ") || "(none)",
          );
          console.log(
            "GROUNDING:",
            `ok=${result.grounding.ok} violations=[${result.grounding.violations.join(",")}] replacedWithFacts=${result.grounding.replacedWithFacts}`,
          );
          console.log(
            "SHORT RESULT:",
            result.reply.replace(/\s+/g, " ").slice(0, 200),
          );
          if (result.proposal) {
            console.log(
              "PROPOSAL:",
              `${result.proposal.normalized.type} → ${JSON.stringify(result.proposal.normalized)} (current: ${result.proposal.current?.summary ?? "none"})`,
            );
          }
          if (result.board) {
            console.log(
              "BOARD:",
              `executiveSummary=${result.board.executiveSummary ? "present" : "MISSING"}, boundaryNotice=${(result.board as { boundaryNotice?: string }).boundaryNotice ? "present" : "MISSING"}`,
            );
          }

          // Prompt-specific MUSTs (deterministic assertions, not prose checks).
          if (prompt.startsWith("What are our strongest")) {
            expect(
              result.toolRuns.some(
                (run) =>
                  run.tool === "query_scenarios" ||
                  run.tool === "get_project_context",
              ),
            ).toBe(true);
          }
          if (prompt.startsWith("Keep at least 90")) {
            expect(result.proposal).not.toBeNull(); // proposes…
            expect(ProjectCodec.encode(harness.trusted.project)).toBe(
              projectBefore,
            ); // …and does NOT mutate
          }
          if (prompt.startsWith("Why can't 124")) {
            expect(
              result.toolRuns.some((run) => run.tool === "explain_feasibility"),
            ).toBe(true);
            const deterministic = executeCopilotTool(
              harness.context,
              "explain_feasibility",
              '{"targetHomes":124}',
            );
            expect(deterministic.ok).toBe(true);
            if (deterministic.ok) {
              expect(
                (deterministic.result as { outcome: string }).outcome,
              ).toBe("no-verified-solution");
            }
          }
          if (prompt.startsWith("What are we still assuming")) {
            expect(
              result.toolRuns.some((run) => run.tool === "inspect_assumptions"),
            ).toBe(true);
          }
          if (prompt.startsWith("Prepare this scenario")) {
            expect(
              result.toolRuns.some(
                (run) => run.tool === "prepare_board_context",
              ),
            ).toBe(true);
            expect(result.board).not.toBeNull();
            const board = result.board as {
              executiveSummary?: string;
              boundaryNotice?: string;
            };
            expect(board.executiveSummary).toBeTruthy();
            expect(board.boundaryNotice).toContain("not legal certification");
          }
        }

        // Nothing across the whole validation mutated trusted project state.
        expect(ProjectCodec.encode(harness.trusted.project)).toBe(
          projectBefore,
        );
      },
    );
  },
);
