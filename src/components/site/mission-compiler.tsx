"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  interpretMission,
  type InterpretationResult,
  type MissionProposal,
  type StructureContext,
} from "../../application/mission/parser";
import type { MissionCommand } from "../../application/mission/rebuild";
import type { MissionNormalized } from "../../domain/constraints/mission";
import {
  readMissionLog,
  readStoredAcceptedPair,
  writeMissionLog,
} from "../../lib/accepted-property";

/**
 * Mission Compiler (issue #6) — the moment after acceptance where Acrevia
 * asks what the church refuses to lose.
 *
 * Canonical state discipline: this component NEVER authors project truth. It
 * holds (a) unconfirmed interpretations/proposals and (b) a command log of
 * user intent; every rendered mission rule comes from the server-derived
 * project state returned by POST /api/mission/state, which verifies the
 * accepted { envelope, receipt } pair and replays the commands through the
 * typed command boundary. Only explicit confirmation sends a command.
 */

type MissionConstraintView = {
  id: string;
  intentText: string;
  normalized: MissionNormalized;
  hardOrSoft: "hard" | "soft";
  revision: number;
  lastModifiedAt: string;
};

type MissionStateResponse = {
  projectId: string;
  revision: number;
  eventCount: number;
  missionConstraints: MissionConstraintView[];
  error?: string;
  commandIndex?: number;
};

const CANONICAL_EXAMPLE =
  "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We are not selling the land.";

const TYPE_LABEL: Record<MissionNormalized["type"], string> = {
  "min-parking": "SUNDAY PARKING",
  "preserve-structure": "PRESERVE",
  "max-stories": "STORIES",
  "retain-ownership": "OWNERSHIP",
  "max-height": "HEIGHT",
};

function detailFor(normalized: MissionNormalized): string {
  switch (normalized.type) {
    case "min-parking":
      return `Minimum ${normalized.spaces.value} spaces`;
    case "preserve-structure":
      return normalized.structureId;
    case "max-stories":
      return `At most ${normalized.stories.value} stories`;
    case "retain-ownership":
      return "Congregation retains land ownership";
    case "max-height":
      return `No taller than ${normalized.limit.value} ft`;
  }
}

function preserveStructureName(
  normalized: MissionNormalized,
  structures: StructureContext[],
): string | undefined {
  if (normalized.type !== "preserve-structure") return undefined;
  return structures.find((s) => s.structureId === normalized.structureId)?.name;
}

export function MissionCompiler({
  structures,
  onProtectedStructures,
}: {
  structures: StructureContext[];
  onProtectedStructures?: (structureIds: string[]) => void;
}) {
  const [sentence, setSentence] = useState("");
  const [interpretation, setInterpretation] = useState<InterpretationResult | null>(null);
  const [drafts, setDrafts] = useState<MissionProposal[]>([]);
  const [missionState, setMissionState] = useState<MissionStateResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  // Direct-control values
  const [parkingValue, setParkingValue] = useState("110");
  const [heightValue, setHeightValue] = useState("38");
  const [storiesValue, setStoriesValue] = useState("3");
  const [preservePick, setPreservePick] = useState(structures[0]?.structureId ?? "");
  const logRef = useRef<MissionCommand[]>([]);

  const refresh = useCallback(async (commands: MissionCommand[]) => {
    const pair = readStoredAcceptedPair();
    if (!pair) {
      setError("Accepted property session unavailable — resolve and accept a property first.");
      return null;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/mission/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope: pair.envelope, receipt: pair.receipt, commands }),
      });
      const payload = (await response.json()) as MissionStateResponse;
      if (!response.ok) {
        setError(payload.error ?? "mission state failed");
        return null;
      }
      setMissionState(payload);
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "network error");
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  // Mount: load the persisted command log and derive the canonical view.
  useEffect(() => {
    const stored = readMissionLog<MissionCommand>();
    logRef.current = Array.isArray(stored) ? stored : [];
    void refresh(logRef.current);
  }, [refresh]);

  // Keep the map honest: protected structures derive from CONFIRMED rules.
  useEffect(() => {
    const ids: string[] = [];
    for (const constraint of missionState?.missionConstraints ?? []) {
      if (constraint.normalized.type === "preserve-structure") {
        ids.push(constraint.normalized.structureId);
      }
    }
    onProtectedStructures?.(ids);
  }, [missionState, onProtectedStructures]);

  const runCommand = useCallback(
    async (command: MissionCommand) => {
      const next = [...logRef.current, command];
      const result = await refresh(next);
      if (result) {
        logRef.current = next;
        writeMissionLog(next);
        setLogError(null);
      }
      // On failure the log is NOT extended — canonical state and log stay in
      // step; the server response explains what was rejected.
      return result;
    },
    [refresh],
  );

  const confirmProposal = useCallback(
    (proposal: MissionProposal) => {
      void runCommand({
        kind: "confirm",
        input: {
          id: proposal.proposalId,
          kind: "mission-constraint",
          intentText: proposal.intentText,
          normalized: proposal.normalized,
          origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: new Date().toISOString() },
          confirmationState: "CONFIRMED",
          hardOrSoft: proposal.hardOrSoft,
        },
      }).then((ok) => {
        if (ok) {
          setInterpretation((current) =>
            current
              ? { ...current, proposals: current.proposals.filter((p) => p.proposalId !== proposal.proposalId) }
              : current,
          );
          setDrafts((current) => current.filter((p) => p.proposalId !== proposal.proposalId));
        }
      });
    },
    [runCommand],
  );

  const removeProposal = useCallback((proposalId: string) => {
    setInterpretation((current) =>
      current ? { ...current, proposals: current.proposals.filter((p) => p.proposalId !== proposalId) } : current,
    );
    setDrafts((current) => current.filter((p) => p.proposalId !== proposalId));
  }, []);

  const interpret = useCallback(() => {
    if (!sentence.trim()) return;
    setDrafts([]);
    setInterpretation(interpretMission(sentence, { structures }));
  }, [sentence, structures]);

  const addDraft = useCallback(
    (normalized: MissionNormalized, intentText: string) => {
      const proposal: MissionProposal = {
        proposalId:
          normalized.type === "preserve-structure"
            ? `mission:preserve:${normalized.structureId}`
            : `mission:${normalized.type}`,
        intentText,
        normalized,
        hardOrSoft: "hard",
        label: TYPE_LABEL[normalized.type],
        detail: detailFor(normalized),
      };
      setDrafts((current) => [
        ...current.filter((p) => p.proposalId !== proposal.proposalId),
        proposal,
      ]);
    },
    [],
  );

  const confirmed = missionState?.missionConstraints ?? [];

  return (
    <section aria-label="Mission Compiler" className="rounded-md border border-stone-300 bg-white">
      <div className="border-b border-stone-200 px-4 py-3.5">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-600">MISSION</p>
        <h3
          className="mt-1.5 text-lg font-normal leading-snug text-stone-900"
          style={{ fontFamily: "var(--font-editorial)" }}
        >
          What must this property protect?
        </h3>
        <p className="mt-1.5 text-sm text-stone-600">
          The law says what you may do. These rules say what your church refuses to sacrifice.
        </p>
      </div>

      <div className="space-y-4 px-4 py-3">
        {/* Natural language — an inspection step, not a conversation */}
        <div>
          <label htmlFor="mission-sentence" className="text-xs font-semibold tracking-[0.14em] text-stone-600">
            DESCRIBE IT IN A SENTENCE
          </label>
          <textarea
            id="mission-sentence"
            rows={3}
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
            placeholder={`e.g., ${CANONICAL_EXAMPLE}`}
            className="mt-1.5 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={interpret}
              disabled={!sentence.trim()}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-ivory disabled:opacity-40"
            >
              Interpret
            </button>
            <span className="text-xs text-stone-600">
              Deterministic interpretation — nothing becomes active until you confirm.
            </span>
          </div>
        </div>

        {/* Direct controls for the common rules */}
        <details className="rounded border border-stone-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-stone-700">
            Or set a rule directly
          </summary>
          <div className="space-y-2 border-t border-stone-200 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="mission-parking" className="text-stone-600">
                Sunday parking — at least
              </label>
              <input
                id="mission-parking"
                inputMode="numeric"
                value={parkingValue}
                onChange={(event) => setParkingValue(event.target.value)}
                className="w-16 rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
              />
              <span className="text-stone-600">spaces</span>
              <button
                type="button"
                onClick={() => {
                  const value = Number(parkingValue);
                  if (Number.isInteger(value) && value > 0) {
                    addDraft(
                      { type: "min-parking", spaces: { value, unit: "spaces" } },
                      `Keep at least ${value} Sunday parking spaces.`,
                    );
                  }
                }}
                className="rounded border border-stone-400 px-2 py-1 text-xs font-medium text-stone-700 hover:border-stone-600"
              >
                Propose
              </button>
            </div>
            {structures.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="mission-preserve" className="text-stone-600">
                  Preserve
                </label>
                <select
                  id="mission-preserve"
                  value={preservePick}
                  onChange={(event) => setPreservePick(event.target.value)}
                  className="rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
                >
                  {structures.map((structure) => (
                    <option key={structure.structureId} value={structure.structureId}>
                      {structure.name ?? structure.structureId}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    addDraft(
                      { type: "preserve-structure", structureId: preservePick },
                      `Preserve ${structures.find((s) => s.structureId === preservePick)?.name ?? preservePick}.`,
                    )
                  }
                  className="rounded border border-stone-400 px-2 py-1 text-xs font-medium text-stone-700 hover:border-stone-600"
                >
                  Propose
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => addDraft({ type: "retain-ownership" }, "We are not selling the land.")}
                className="rounded border border-stone-400 px-2 py-1 text-xs font-medium text-stone-700 hover:border-stone-600"
              >
                Propose: retain land ownership
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="mission-height" className="text-stone-600">
                No taller than
              </label>
              <input
                id="mission-height"
                inputMode="decimal"
                value={heightValue}
                onChange={(event) => setHeightValue(event.target.value)}
                className="w-16 rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
              />
              <span className="text-stone-600">ft</span>
              <button
                type="button"
                onClick={() => {
                  const value = Number(heightValue);
                  if (Number.isFinite(value) && value > 0) {
                    addDraft({ type: "max-height", limit: { value, unit: "ft" } }, `Keep it no taller than ${value} ft.`);
                  }
                }}
                className="rounded border border-stone-400 px-2 py-1 text-xs font-medium text-stone-700 hover:border-stone-600"
              >
                Propose
              </button>
              <span className="text-stone-400">|</span>
              <label htmlFor="mission-stories" className="text-stone-600">
                at most
              </label>
              <input
                id="mission-stories"
                inputMode="numeric"
                value={storiesValue}
                onChange={(event) => setStoriesValue(event.target.value)}
                className="w-14 rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
              />
              <span className="text-stone-600">stories</span>
              <button
                type="button"
                onClick={() => {
                  const value = Number(storiesValue);
                  if (Number.isInteger(value) && value > 0) {
                    addDraft({ type: "max-stories", stories: { value, unit: "stories" } }, `Keep it to at most ${value} stories.`);
                  }
                }}
                className="rounded border border-stone-400 px-2 py-1 text-xs font-medium text-stone-700 hover:border-stone-600"
              >
                Propose
              </button>
            </div>
          </div>
        </details>

        {error ? (
          <p role="alert" className="rounded border border-rust-500 bg-rust-50 px-3 py-2 text-sm text-rust-900">
            {error}
          </p>
        ) : null}

        {/* Interpretation review — proposals, clarifications, conflicts */}
        {interpretation ? (
          <div aria-label="Interpretation" className="space-y-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">
              WHAT ACREVIA UNDERSTOOD
            </p>
            {interpretation.proposals.map((proposal) => (
              <ProposalRow
                key={`i-${proposal.proposalId}`}
                proposal={proposal}
                structureName={preserveStructureName(proposal.normalized, structures)}
                onConfirm={() => confirmProposal(proposal)}
                onRemove={() => removeProposal(proposal.proposalId)}
                onSoftToggle={(soft) =>
                  setInterpretation((current) =>
                    current
                      ? {
                          ...current,
                          proposals: current.proposals.map((p) =>
                            p.proposalId === proposal.proposalId ? { ...p, hardOrSoft: soft ? "soft" : "hard" } : p,
                          ),
                        }
                      : current,
                  )
                }
              />
            ))}
            {drafts.map((proposal) => (
              <ProposalRow
                key={`d-${proposal.proposalId}`}
                proposal={proposal}
                structureName={preserveStructureName(proposal.normalized, structures)}
                onConfirm={() => confirmProposal(proposal)}
                onRemove={() => removeProposal(proposal.proposalId)}
                onSoftToggle={(soft) =>
                  setDrafts((current) =>
                    current.map((p) => (p.proposalId === proposal.proposalId ? { ...p, hardOrSoft: soft ? "soft" : "hard" } : p)),
                  )
                }
              />
            ))}
            {interpretation.needsClarification.map((item, index) => (
              <div key={`c-${index}`} className="border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2">
                <p className="text-[11px] font-semibold tracking-[0.1em] text-amber-800">NEEDS CLARIFICATION</p>
                <p className="mt-0.5 text-sm italic text-stone-700">&ldquo;{item.quote}&rdquo;</p>
                <p className="mt-0.5 text-xs text-stone-600">{item.reason}</p>
                {item.suggestion ? <p className="mt-0.5 text-xs text-stone-500">{item.suggestion}</p> : null}
              </div>
            ))}
            {interpretation.unsupported.map((item, index) => (
              <div key={`u-${index}`} className="border-l-2 border-stone-400 bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold tracking-[0.1em] text-stone-600">NOT EXECUTABLE YET</p>
                <p className="mt-0.5 text-sm italic text-stone-700">&ldquo;{item.quote}&rdquo;</p>
                <p className="mt-0.5 text-xs text-stone-600">{item.reason}</p>
                {item.suggestion ? <p className="mt-0.5 text-xs text-stone-500">{item.suggestion}</p> : null}
              </div>
            ))}
            {interpretation.conflicts.map((item, index) => (
              <div key={`x-${index}`} className="border-l-2 border-rust-500 bg-rust-50 px-3 py-2">
                <p className="text-[11px] font-semibold tracking-[0.1em] text-rust-800">CONFLICT</p>
                <p className="mt-0.5 text-sm text-stone-700">{item.reason}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Confirmed mission rules — canonical, server-derived */}
        <div aria-label="Confirmed mission rules">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">CONFIRMED MISSION RULES</p>
            {missionState ? (
              <p className="font-mono text-[11px] text-stone-400">
                rev {missionState.revision} · {missionState.eventCount} events
              </p>
            ) : null}
          </div>
          {pending ? <p className="mt-2 text-xs text-stone-500">Updating project state…</p> : null}
          {logError ? (
            <p className="mt-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {logError}
            </p>
          ) : null}
          {confirmed.length === 0 && !pending ? (
            <p className="mt-2 text-sm text-stone-500">
              No mission rules yet. Acrevia will not invent any — confirm one above and it becomes part of the project graph.
            </p>
          ) : null}
          <ul className="mt-2 divide-y divide-stone-100">
            {confirmed.map((constraint) => (
              <li key={constraint.id} className="py-2.5">
                <ConfirmedRule
                  constraint={constraint}
                  structureName={preserveStructureName(constraint.normalized, structures)}
                  pending={pending}
                  onEditValue={(normalized) =>
                    void runCommand({
                      kind: "confirm",
                      input: {
                        id: constraint.id,
                        kind: "mission-constraint",
                        intentText:
                          normalized.type === "min-parking"
                            ? `Keep at least ${normalized.spaces.value} Sunday parking spaces.`
                            : normalized.type === "max-height"
                              ? `Keep it no taller than ${normalized.limit.value} ft.`
                              : normalized.type === "max-stories"
                                ? `Keep it to at most ${normalized.stories.value} stories.`
                                : constraint.intentText,
                        normalized,
                        origin: {
                          kind: "USER_DECLARED",
                          actorId: "church-leader",
                          declaredAt: new Date().toISOString(),
                        },
                        confirmationState: "CONFIRMED",
                        hardOrSoft: constraint.hardOrSoft,
                      },
                    })
                  }
                  onToggleSoft={(soft) =>
                    void runCommand({
                      kind: "confirm",
                      input: {
                        id: constraint.id,
                        kind: "mission-constraint",
                        intentText: constraint.intentText,
                        normalized: constraint.normalized,
                        origin: {
                          kind: "USER_DECLARED",
                          actorId: "church-leader",
                          declaredAt: new Date().toISOString(),
                        },
                        confirmationState: "CONFIRMED",
                        hardOrSoft: soft ? "soft" : "hard",
                      },
                    })
                  }
                  onRetract={() =>
                    void runCommand({ kind: "retract", input: { id: constraint.id } }).then((ok) => {
                      if (!ok) setLogError("The rule could not be retracted — the server rejected the command.");
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ProposalRow({
  proposal,
  structureName,
  onConfirm,
  onRemove,
  onSoftToggle,
}: {
  proposal: MissionProposal;
  structureName?: string;
  onConfirm: () => void;
  onRemove: () => void;
  onSoftToggle: (soft: boolean) => void;
}) {
  return (
    <div className="border-l-2 border-olive-500 bg-olive-50/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] text-stone-500">
            PROPOSED · {proposal.label}
          </p>
          <p className="mt-0.5 text-sm font-medium text-stone-900">
            {proposal.normalized.type === "preserve-structure" && structureName ? structureName : proposal.detail}
          </p>
        </div>
      </div>
      {proposal.feasibilityNote ? (
        <p className="mt-1 text-xs text-amber-800">{proposal.feasibilityNote}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-olive-700 px-2.5 py-1 text-xs font-semibold text-white"
        >
          Confirm{proposal.hardOrSoft === "hard" ? " — must keep" : " — preference"}
        </button>
        <button
          type="button"
          onClick={() => onSoftToggle(proposal.hardOrSoft === "hard")}
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:border-stone-500"
        >
          {proposal.hardOrSoft === "hard" ? "Make preference" : "Make must keep"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs text-stone-500 underline hover:text-stone-700"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function ConfirmedRule({
  constraint,
  structureName,
  pending,
  onEditValue,
  onToggleSoft,
  onRetract,
}: {
  constraint: MissionConstraintView;
  structureName?: string;
  pending: boolean;
  onEditValue: (normalized: MissionNormalized) => void;
  onToggleSoft: (soft: boolean) => void;
  onRetract: () => void;
}) {
  const editable =
    constraint.normalized.type === "min-parking"
      ? { kind: "spaces" as const, value: String(constraint.normalized.spaces.value) }
      : constraint.normalized.type === "max-height"
        ? { kind: "ft" as const, value: String(constraint.normalized.limit.value) }
        : constraint.normalized.type === "max-stories"
          ? { kind: "stories" as const, value: String(constraint.normalized.stories.value) }
          : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const detail =
    constraint.normalized.type === "preserve-structure" && structureName
      ? structureName
      : detailFor(constraint.normalized);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-[0.1em] text-stone-500">
          {TYPE_LABEL[constraint.normalized.type]}
          {constraint.hardOrSoft === "hard" ? " · MUST KEEP" : " · PREFERENCE"}
        </p>
        <span className="font-mono text-[10px] text-stone-400">rev {constraint.revision}</span>
      </div>
      <p className="mt-0.5 text-sm font-medium text-stone-900">{detail}</p>
      <p className="text-xs text-stone-400">{constraint.intentText}</p>
      {editing && editable ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            aria-label={`New value for ${TYPE_LABEL[constraint.normalized.type]}`}
            inputMode={editable.kind === "ft" ? "decimal" : "numeric"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-16 rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const value = Number(draft);
              if (
                Number.isFinite(value) &&
                (editable.kind !== "stories" || Number.isInteger(value)) &&
                (editable.kind === "spaces" ? Number.isInteger(value) && value >= 1 : value > 0)
              ) {
                if (constraint.normalized.type === "min-parking") {
                  onEditValue({ type: "min-parking", spaces: { value, unit: "spaces" } });
                } else if (constraint.normalized.type === "max-height") {
                  onEditValue({ type: "max-height", limit: { value, unit: "ft" } });
                } else if (constraint.normalized.type === "max-stories") {
                  onEditValue({ type: "max-stories", stories: { value, unit: "stories" } });
                }
                setEditing(false);
              }
            }}
            className="rounded bg-stone-900 px-2 py-1 text-xs font-medium text-ivory disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded px-2 py-1 text-xs text-stone-500 underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setDraft(editable.value);
                setEditing(true);
              }}
              className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-600 hover:border-stone-500"
            >
              Edit value
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => onToggleSoft(constraint.hardOrSoft === "hard")}
            className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-600 hover:border-stone-500 disabled:opacity-40"
          >
            {constraint.hardOrSoft === "hard" ? "Change to preference" : "Change to must keep"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onRetract}
            className="rounded px-2 py-0.5 text-xs text-stone-500 underline hover:text-rust-700 disabled:opacity-40"
          >
            Retract
          </button>
        </div>
      )}
    </div>
  );
}
