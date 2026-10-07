"use client";

import { useCallback, useRef, useState } from "react";
import { CornerDownLeft, MessageSquare, X, Copy, FileText } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import type { AcceptedPropertyRecord } from "@/lib/accepted-property";
import {
  readMissionLogFor,
  readStoredAcceptedPair,
  writeMissionLogFor,
} from "@/lib/accepted-property";
import type { MissionCommand } from "@/application/mission/rebuild";
import type { MissionNormalized } from "@/domain/constraints/mission";
import type {
  CopilotMissionProposalForUi,
  CopilotToolRunForUi,
} from "@/application/copilot/orchestrate";

/**
 * Copilot rail (issue #10) — a sidecar over ONE living project, not a chat
 * product. The canvas stays primary; the rail does three things:
 *
 *  - runs the model through typed tools and shows which tools ran (truth is
 *    the tool cards, not the prose);
 *  - renders mission-change PROPOSALS as structured confirmations — nothing
 *    changes until Confirm, and confirmation goes through the existing
 *    mission command boundary (POST /api/mission/state), never a Copilot
 *    write path;
 *  - renders board briefs from trusted structured state.
 *
 * Conversation memory is this component's state only — no persistence layer.
 */

type UiProposal = CopilotMissionProposalForUi & {
  state: "pending" | "applying" | "applied" | "cancelled" | "failed";
  revision?: number;
  error?: string;
};

type BoardContext = {
  title?: string;
  property?: { address?: string; district?: string; overlay?: string | null };
  selectedScenario?: {
    label?: string;
    homes?: number;
    parkingStalls?: number;
    parkingMargin?: number;
    floors?: number;
    confidence?: string;
    certificate?: {
      certificateId?: string;
      freshness?: string;
      freshnessReasons?: string[];
    } | null;
    constraintResults?: Array<{
      constraint?: string;
      status?: string;
      actual?: string;
      limit?: string;
    }>;
    professionalQuestions?: string[];
  };
  missionCommitments?: Array<{ summary?: string; hardOrSoft?: string }>;
  assumptions?: Array<{ statement?: string; value?: string }>;
  expertReviews?: Array<{
    question?: string;
    severity?: string;
    reviewStatus?: string;
  }>;
  conflicts?: Array<{ predicate?: string; explanation?: string }>;
  blockingQuestionsForTheBoard?: string[];
  boundaryNotice?: string;
  certificateWarning?: string | null;
};

type RailEntry =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "tools"; runs: CopilotToolRunForUi[] }
  | { kind: "proposal"; proposal: UiProposal }
  | { kind: "board"; board: BoardContext }
  | { kind: "notice"; tone: "info" | "warn" | "error"; text: string };

type TurnResponse =
  | {
      status: "ok";
      reply: string;
      toolRuns: CopilotToolRunForUi[];
      proposal: CopilotMissionProposalForUi | null;
      board: BoardContext | null;
      grounding: {
        checked: boolean;
        ok: boolean;
        violations: string[];
        replacedWithFacts: boolean;
      };
      model?: string;
    }
  | {
      status:
        | "ai-unavailable"
        | "ai-error"
        | "needs-evidence"
        | "multi-parcel-unsupported"
        | "unsupported-district";
      reason?: string;
    };

const EXAMPLES = [
  "What are our strongest options if we keep ownership?",
  "Keep at least 90 Sunday parking spaces.",
  "Why can't 124 homes fit?",
  "What are we still assuming?",
  "Prepare this scenario for the board.",
];

function normalizedSummary(normalized: MissionNormalized): string {
  switch (normalized.type) {
    case "min-parking":
      return `at least ${normalized.spaces.value} Sunday parking spaces`;
    case "preserve-structure":
      return `preserve ${normalized.structureId}`;
    case "max-stories":
      return `at most ${normalized.stories.value} stories`;
    case "retain-ownership":
      return "congregation retains land ownership";
    case "max-height":
      return `no taller than ${normalized.limit.value} ft`;
  }
}

export function Copilot({
  accepted,
}: {
  accepted: AcceptedPropertyRecord | null;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RailEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [board, setBoard] = useState<BoardContext | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (message: string) => {
      const pair = readStoredAcceptedPair();
      if (!pair) return;
      setBusy(true);
      setEntries((current) => [
        ...current,
        { kind: "message", role: "user", content: message },
      ]);
      const history = entries
        .filter(
          (entry): entry is Extract<RailEntry, { kind: "message" }> =>
            entry.kind === "message",
        )
        .slice(-6)
        .map((entry) => ({ role: entry.role, content: entry.content }));
      try {
        const response = await fetch("/api/copilot/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands: readMissionLogFor<MissionCommand>(pair),
            message,
            history,
          }),
        });
        const payload = (await response.json()) as TurnResponse & {
          error?: string;
        };
        if (payload.status === "ai-unavailable") {
          setAiUnavailable(true);
          setEntries((current) => [
            ...current,
            {
              kind: "notice",
              tone: "warn",
              text:
                payload.reason ??
                "Copilot AI is not configured on this server.",
            },
          ]);
          return;
        }
        if (payload.status !== "ok") {
          setEntries((current) => [
            ...current,
            {
              kind: "notice",
              tone: response.ok ? "warn" : "error",
              text:
                payload.reason ?? payload.error ?? "The Copilot turn failed.",
            },
          ]);
          return;
        }
        const next: RailEntry[] = [];
        if (payload.toolRuns.length > 0)
          next.push({ kind: "tools", runs: payload.toolRuns });
        if (payload.proposal) {
          const proposal: UiProposal = {
            ...payload.proposal,
            state: "pending",
          };
          next.push({ kind: "proposal", proposal });
        }
        if (payload.board) next.push({ kind: "board", board: payload.board });
        next.push({
          kind: "message",
          role: "assistant",
          content: payload.reply,
        });
        if (payload.grounding.replacedWithFacts) {
          next.push({
            kind: "notice",
            tone: "warn",
            text: "The model cited numbers absent from verified tool results; its reply was replaced with the verified facts above.",
          });
        }
        setEntries((current) => [...current, ...next]);
      } catch (cause) {
        setEntries((current) => [
          ...current,
          {
            kind: "notice",
            tone: "error",
            text:
              cause instanceof Error
                ? cause.message
                : "The Copilot request failed.",
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [entries],
  );

  const confirmProposal = useCallback(
    async (entryIndex: number) => {
      const pair = readStoredAcceptedPair();
      setEntries((current) =>
        current.map((entry, index) =>
          entry.kind === "proposal" && index === entryIndex
            ? {
                ...entry,
                proposal: {
                  ...entry.proposal,
                  state: "applying",
                } as UiProposal,
              }
            : entry,
        ),
      );
      if (!pair) {
        setEntries((current) =>
          current.map((entry, index) =>
            entry.kind === "proposal" && index === entryIndex
              ? {
                  ...entry,
                  proposal: {
                    ...entry.proposal,
                    state: "failed",
                    error: "Accepted property session unavailable.",
                  } as UiProposal,
                }
              : entry,
          ),
        );
        return;
      }
      const proposal = (
        entries[entryIndex] as Extract<RailEntry, { kind: "proposal" }>
      ).proposal;
      const command: MissionCommand = {
        kind: "confirm",
        input: {
          id: proposal.proposalId,
          kind: "mission-constraint",
          intentText: proposal.intentText,
          normalized: proposal.normalized,
          origin: {
            kind: "USER_DECLARED",
            actorId: "church-leader",
            declaredAt: new Date().toISOString(),
          },
          confirmationState: "CONFIRMED",
          hardOrSoft: proposal.hardOrSoft,
        },
      };
      const nextCommands = [
        ...readMissionLogFor<MissionCommand>(pair),
        command,
      ];
      try {
        const response = await fetch("/api/mission/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands: nextCommands,
          }),
        });
        const payload = (await response.json()) as {
          revision?: number;
          error?: string;
        };
        if (!response.ok) {
          setEntries((current) =>
            current.map((entry, index) =>
              entry.kind === "proposal" && index === entryIndex
                ? {
                    ...entry,
                    proposal: {
                      ...entry.proposal,
                      state: "failed",
                      error: payload.error ?? "mission state failed",
                    } as UiProposal,
                  }
                : entry,
            ),
          );
          return;
        }
        writeMissionLogFor(pair, nextCommands);
        setEntries((current) => [
          ...current.map((entry, index) =>
            entry.kind === "proposal" && index === entryIndex
              ? {
                  ...entry,
                  proposal: {
                    ...entry.proposal,
                    state: "applied",
                    revision: payload.revision,
                  } as UiProposal,
                }
              : entry,
          ),
          {
            kind: "notice",
            tone: "info",
            text: "Mission updated through the standard command boundary. Scenarios, Forge, and Evidence recompute from the new state the next time you open them.",
          },
        ]);
      } catch (cause) {
        setEntries((current) =>
          current.map((entry, index) =>
            entry.kind === "proposal" && index === entryIndex
              ? {
                  ...entry,
                  proposal: {
                    ...entry.proposal,
                    state: "failed",
                    error:
                      cause instanceof Error ? cause.message : "network error",
                  } as UiProposal,
                }
              : entry,
          ),
        );
      }
    },
    [entries],
  );

  const cancelProposal = useCallback((entryIndex: number) => {
    setEntries((current) =>
      current.map((entry, index) =>
        entry.kind === "proposal" && index === entryIndex
          ? {
              ...entry,
              proposal: { ...entry.proposal, state: "cancelled" } as UiProposal,
            }
          : entry,
      ),
    );
  }, []);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="outline">
            <MessageSquare size={16} aria-hidden="true" />
            Copilot
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="rail-overlay" />
          <Dialog.Content className="copilot-rail" data-testid="copilot-rail">
            <div className="rail-heading">
              <Dialog.Title>Project Copilot</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close Copilot">
                  <X size={18} />
                </Button>
              </Dialog.Close>
            </div>
            <p className="copilot-subtitle">
              AI interprets. Acrevia&rsquo;s deterministic systems decide. You
              authorize.
            </p>
            <div className="copilot-log" data-testid="copilot-log" ref={logRef}>
              {entries.length === 0 && (
                <div className="copilot-empty">
                  <span className="eyebrow">ASK ABOUT YOUR PROPERTY</span>
                  {accepted ? (
                    <p>
                      Every answer comes from the current verified project state
                      through typed tools — never from the model alone.
                    </p>
                  ) : (
                    <p>
                      Resolve and accept a property on the Site surface first.
                    </p>
                  )}
                  {accepted && (
                    <ul>
                      {EXAMPLES.map((example) => (
                        <li key={example}>
                          <button
                            type="button"
                            className="copilot-example-chip"
                            onClick={() => void send(example)}
                            disabled={busy}
                          >
                            {example}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {entries.map((entry, index) =>
                entry.kind === "message" ? (
                  <div
                    key={index}
                    className={`copilot-msg ${entry.role}`}
                    data-testid={`copilot-msg-${entry.role}`}
                  >
                    <span className="copilot-msg-role">
                      {entry.role === "user" ? "YOU" : "COPILOT"}
                    </span>
                    <p>{entry.content}</p>
                  </div>
                ) : entry.kind === "tools" ? (
                  <div
                    key={index}
                    className="copilot-tools"
                    data-testid="copilot-tools"
                  >
                    {entry.runs.map((run, runIndex) => (
                      <span
                        key={runIndex}
                        className={`tool-chip ${run.ok ? "" : "failed"}`}
                      >
                        {run.ok
                          ? run.summary
                          : `${run.tool}: ${run.error ?? "failed"}`}
                      </span>
                    ))}
                  </div>
                ) : entry.kind === "proposal" ? (
                  <ProposalCard
                    key={index}
                    proposal={entry.proposal}
                    onConfirm={() => void confirmProposal(index)}
                    onCancel={() => cancelProposal(index)}
                  />
                ) : entry.kind === "board" ? (
                  <div key={index} className="copilot-board-card">
                    <span className="eyebrow">BOARD BRIEF</span>
                    <p>
                      Assembled from current verified state
                      {entry.board.selectedScenario?.certificate?.freshness
                        ? ` — certificate ${entry.board.selectedScenario.certificate.freshness}`
                        : ""}
                      .
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBoard(entry.board);
                        setBoardOpen(true);
                      }}
                      data-testid="copilot-board-open"
                    >
                      <FileText size={15} aria-hidden="true" />
                      Open board brief
                    </Button>
                  </div>
                ) : (
                  <p
                    key={index}
                    className={`copilot-notice ${entry.tone}`}
                    role="status"
                  >
                    {entry.text}
                  </p>
                ),
              )}
              {busy && (
                <p className="copilot-busy">
                  Running tools against the verified project…
                </p>
              )}
            </div>
            <div className="copilot-composer">
              <label htmlFor="copilot-message">Message Copilot</label>
              <textarea
                id="copilot-message"
                data-testid="copilot-composer-input"
                placeholder={
                  accepted
                    ? "Ask, propose, or challenge…"
                    : "Available once a property is accepted"
                }
                disabled={!accepted || busy || aiUnavailable}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    input.trim() &&
                    !busy
                  ) {
                    event.preventDefault();
                    const message = input.trim();
                    setInput("");
                    void send(message);
                  }
                }}
              />
              <Button
                variant="outline"
                data-testid="copilot-send"
                disabled={!accepted || busy || aiUnavailable || !input.trim()}
                onClick={() => {
                  const message = input.trim();
                  setInput("");
                  void send(message);
                }}
              >
                Send message
                <CornerDownLeft size={15} aria-hidden="true" />
              </Button>
            </div>
            <Dialog.Description className="sr-only">
              Copilot conversation over the accepted property.
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <BoardBriefDialog
        open={boardOpen}
        onOpenChange={setBoardOpen}
        board={board}
      />
    </>
  );
}

function ProposalCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: UiProposal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="proposal-card" data-testid="copilot-proposal">
      <span className="eyebrow">PROPOSED MISSION CHANGE</span>
      <div className="proposal-rows">
        <div>
          <span>CURRENT</span>
          <strong>
            {proposal.current ? proposal.current.summary : "no rule confirmed"}
          </strong>
        </div>
        <div>
          <span>PROPOSED</span>
          <strong>{normalizedSummary(proposal.normalized)}</strong>
        </div>
      </div>
      <p className="proposal-note">&ldquo;{proposal.intentText}&rdquo;</p>
      {proposal.state === "pending" && (
        <div className="proposal-actions">
          <Button onClick={onConfirm} data-testid="copilot-proposal-confirm">
            Confirm change
          </Button>
          <Button
            variant="ghost"
            onClick={onCancel}
            data-testid="copilot-proposal-cancel"
          >
            Cancel
          </Button>
        </div>
      )}
      {proposal.state === "applying" && (
        <p className="proposal-status">
          Applying through the mission command boundary…
        </p>
      )}
      {proposal.state === "applied" && (
        <p className="proposal-status applied">
          Applied — project revision {proposal.revision}. Downstream scenarios
          and certificates recompute on your next Scenarios, Evidence, or Forge
          view.
        </p>
      )}
      {proposal.state === "cancelled" && (
        <p className="proposal-status">
          Cancelled — no project state was changed.
        </p>
      )}
      {proposal.state === "failed" && (
        <p className="proposal-status failed">
          Not applied —{" "}
          {proposal.error ?? "the command boundary rejected the change"}.
        </p>
      )}
    </div>
  );
}

function BoardBriefDialog({
  open,
  onOpenChange,
  board,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardContext | null;
}) {
  const [copied, setCopied] = useState(false);
  if (!board) return null;
  const scenario = board.selectedScenario;
  const certificateFreshness = scenario?.certificate?.freshness ?? null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="rail-overlay" />
        <Dialog.Content
          className="copilot-board-dialog"
          data-testid="copilot-board-dialog"
        >
          <div className="rail-heading">
            <Dialog.Title>Board brief</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close board brief"
              >
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="copilot-board-body">
            {certificateFreshness && certificateFreshness !== "CURRENT" && (
              <p
                className="copilot-freshness-banner"
                data-testid="copilot-board-stale"
              >
                CERTIFICATE {certificateFreshness} — present as history, not a
                current verified result, until recompute.
              </p>
            )}
            <section>
              <span className="eyebrow">PROPERTY</span>
              <p>
                {board.property?.address} · zoned {board.property?.district}
                {board.property?.overlay ? ` · ${board.property.overlay}` : ""}
              </p>
            </section>
            {scenario && (
              <section>
                <span className="eyebrow">
                  SELECTED SCENARIO — {scenario.label}
                </span>
                <p className="copilot-board-metrics">
                  {scenario.homes} homes · {scenario.parkingStalls} parking
                  stalls · {scenario.floors} floors · confidence{" "}
                  {String(scenario.confidence)
                    .replaceAll("_", " ")
                    .toLowerCase()}
                </p>
                {scenario.certificate && (
                  <p className="copilot-board-certificate">
                    Certificate {scenario.certificate.certificateId} —{" "}
                    {scenario.certificate.freshness}
                  </p>
                )}
                {Array.isArray(scenario.constraintResults) &&
                  scenario.constraintResults.length > 0 && (
                    <table className="copilot-board-results">
                      <thead>
                        <tr>
                          <th>Constraint</th>
                          <th>Status</th>
                          <th>Actual / limit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scenario.constraintResults.map((row, index) => (
                          <tr key={index}>
                            <td>{row.constraint}</td>
                            <td>{row.status}</td>
                            <td>
                              {row.actual ?? "—"} / {row.limit ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </section>
            )}
            {Array.isArray(board.missionCommitments) &&
              board.missionCommitments.length > 0 && (
                <section>
                  <span className="eyebrow">MISSION COMMITMENTS</span>
                  <ul>
                    {board.missionCommitments.map((mission, index) => (
                      <li key={index}>
                        {mission.summary} ({mission.hardOrSoft})
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            {Array.isArray(board.assumptions) &&
              board.assumptions.length > 0 && (
                <section>
                  <span className="eyebrow">ASSUMPTIONS (NOT LAW)</span>
                  <ul>
                    {board.assumptions.map((assumption, index) => (
                      <li key={index}>
                        {assumption.statement} — {assumption.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            {Array.isArray(board.conflicts) && board.conflicts.length > 0 && (
              <section>
                <span className="eyebrow">CONFLICTS</span>
                <ul>
                  {board.conflicts.map((conflict, index) => (
                    <li key={index}>
                      {conflict.predicate} — {conflict.explanation}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {Array.isArray(board.expertReviews) &&
              board.expertReviews.length > 0 && (
                <section>
                  <span className="eyebrow">EXPERT REQUIRED</span>
                  <ul>
                    {board.expertReviews.map((review, index) => (
                      <li key={index}>
                        {review.question} ({review.severity},{" "}
                        {review.reviewStatus})
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            {Array.isArray(board.blockingQuestionsForTheBoard) &&
              board.blockingQuestionsForTheBoard.length > 0 && (
                <section>
                  <span className="eyebrow">QUESTIONS FOR THE BOARD</span>
                  <ul>
                    {board.blockingQuestionsForTheBoard.map(
                      (question, index) => (
                        <li key={index}>{question}</li>
                      ),
                    )}
                  </ul>
                </section>
              )}
            <p className="copilot-board-boundary">{board.boundaryNotice}</p>
          </div>
          <div className="copilot-board-footer">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(boardToMarkdown(board))
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <Copy size={15} aria-hidden="true" />
              {copied ? "Copied" : "Copy as Markdown"}
            </Button>
            <span className="copilot-board-source">
              Every fact above comes from the current verified Acrevia state.
            </span>
          </div>
          <Dialog.Description className="sr-only">
            Board brief assembled from verified project state.
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function boardToMarkdown(board: BoardContext): string {
  const lines: string[] = [`# ${board.title ?? "Board brief"}`, ""];
  lines.push(
    `**Property:** ${board.property?.address ?? ""} — zoned ${board.property?.district ?? ""}`,
    "",
  );
  const scenario = board.selectedScenario;
  if (scenario) {
    lines.push(
      `## Scenario — ${scenario.label}`,
      `${scenario.homes} homes · ${scenario.parkingStalls} parking stalls · ${scenario.floors} floors`,
      "",
    );
    if (scenario.certificate) {
      lines.push(
        `Certificate ${scenario.certificate.certificateId} — ${scenario.certificate.freshness}`,
        "",
      );
    }
    if (
      Array.isArray(scenario.constraintResults) &&
      scenario.constraintResults.length > 0
    ) {
      lines.push(
        "| Constraint | Status | Actual / limit |",
        "| --- | --- | --- |",
      );
      for (const row of scenario.constraintResults) {
        lines.push(
          `| ${row.constraint ?? ""} | ${row.status ?? ""} | ${row.actual ?? "—"} / ${row.limit ?? "—"} |`,
        );
      }
      lines.push("");
    }
  }
  if (
    Array.isArray(board.missionCommitments) &&
    board.missionCommitments.length > 0
  ) {
    lines.push("## Mission commitments");
    for (const mission of board.missionCommitments)
      lines.push(`- ${mission.summary} (${mission.hardOrSoft})`);
    lines.push("");
  }
  if (Array.isArray(board.assumptions) && board.assumptions.length > 0) {
    lines.push("## Assumptions (not law)");
    for (const assumption of board.assumptions)
      lines.push(`- ${assumption.statement} — ${assumption.value}`);
    lines.push("");
  }
  if (Array.isArray(board.expertReviews) && board.expertReviews.length > 0) {
    lines.push("## Expert required");
    for (const review of board.expertReviews)
      lines.push(
        `- ${review.question} (${review.severity}, ${review.reviewStatus})`,
      );
    lines.push("");
  }
  if (board.boundaryNotice) lines.push(`---`, "", `_${board.boundaryNotice}_`);
  return lines.join("\n");
}
