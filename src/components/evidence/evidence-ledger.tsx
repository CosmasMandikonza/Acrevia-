"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import type {
  ProofSnapshot,
  ProofResultRow,
} from "../../application/proof/snapshot";
import type { MissionCommand } from "../../application/mission/rebuild";
import { readMissionLogFor, readStoredAcceptedPair } from "../../lib/accepted-property";
import { buildDiligenceSummary } from "./diligence";
import { CompiledLaw } from "./compiled-law";
import type { AcceptedPropertyRecord } from "../../lib/accepted-property";

/**
 * EVIDENCE / PROOF (issue #11) — a premium inspection workspace over the
 * trusted Proof projection. Everything rendered is a projection of
 * Development Graph truth: sources, claims, regulations, constraints,
 * ConstraintResults, scenarios, ScenarioCertificates, assumptions, missions,
 * conflicts, and ExpertReview nodes. No parallel evidence store exists.
 *
 * The center column walks the core chain
 *   SOURCE → CLAIM → REGULATION → CONSTRAINT → RESULT → SCENARIO → CERTIFICATE
 * with #5's two strands (LAW vs APPLIES HERE) kept visibly separate. The
 * right rail inspects whatever the user clicked. Lower bands hold
 * assumptions, mission rules, the conflict compare view, and the expert
 * queue. MACHINE CHECKED is a presentation label for deterministic results —
 * never an evidence state.
 */

type Unavailable = { status: string; reason?: string };

type SnapshotResponse = ProofSnapshot | Unavailable | { error: string; name?: string };

const isSnapshot = (value: SnapshotResponse | null): value is ProofSnapshot =>
  Boolean(value) && (value as ProofSnapshot).projectionVersion === "acrevia.proof.v1";

const STATUS_CHIP: Record<string, string> = {
  SATISFIED: "border-olive-600 bg-olive-50 text-olive-800",
  VIOLATED: "border-red-700 bg-red-50 text-red-800",
  UNKNOWN: "border-stone-400 bg-stone-100 text-stone-700",
  NOT_EVALUATED: "border-amber-500 bg-amber-50 text-amber-800",
  EXPERT_REQUIRED: "border-amber-600 bg-amber-50 text-amber-900",
};

const STATUS_LABEL: Record<string, string> = {
  SATISFIED: "SATISFIED",
  VIOLATED: "VIOLATED",
  UNKNOWN: "UNKNOWN",
  NOT_EVALUATED: "NOT EVALUATED",
  EXPERT_REQUIRED: "EXPERT REQUIRED",
};

function quantityText(value: { value: number; unit: string } | null): string {
  if (!value) return "—";
  return `${value.value.toLocaleString("en-US")} ${value.unit}`;
}

function resultLabel(snapshot: ProofSnapshot, result: ProofResultRow): string {
  const constraint = snapshot.constraints.find((entry) => entry.id === result.constraintId);
  if (constraint) return constraint.valueSummary;
  const mission = snapshot.missions.find((entry) => entry.id === result.constraintId);
  if (mission) return mission.normalizedSummary;
  const assumption = snapshot.assumptions.find((entry) => entry.id === result.constraintId);
  if (assumption) return assumption.statement;
  return result.constraintId;
}

function nodeKindOf(snapshot: ProofSnapshot, nodeId: string): string | null {
  if (snapshot.sources.some((row) => row.id === nodeId)) return "source";
  if (snapshot.claims.some((row) => row.id === nodeId)) return "claim";
  if (snapshot.regulations.some((row) => row.id === nodeId)) return "regulation";
  if (snapshot.constraints.some((row) => row.id === nodeId)) return "constraint";
  if (snapshot.results.some((row) => row.id === nodeId)) return "result";
  if (snapshot.scenarios.some((row) => row.id === nodeId)) return "scenario";
  if (snapshot.certificates.some((row) => row.id === nodeId)) return "certificate";
  if (snapshot.assumptions.some((row) => row.id === nodeId)) return "assumption";
  if (snapshot.missions.some((row) => row.id === nodeId)) return "mission";
  return null;
}

export function EvidenceLedger({ record }: { record: AcceptedPropertyRecord }) {
  const params = useSearchParams();
  const focusParam = params.get("focus");
  const scenarioParam = params.get("scenario");
  const certificateParam = params.get("certificate");

  const [snapshot, setSnapshot] = useState<ProofSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userScenarioId, setUserScenarioId] = useState<string | null>(null);
  const [userInspectedId, setUserInspectedId] = useState<string | null>(null);
  const chainRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const pair = readStoredAcceptedPair();
    if (!pair) return;
    const commands = readMissionLogFor<MissionCommand>(pair);
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/proof/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands,
            ...(scenarioParam ? { scenarioId: scenarioParam } : {}),
            ...(certificateParam ? { certificateId: certificateParam } : {}),
            ...(focusParam ? { focusNodeId: focusParam } : {}),
          }),
        });
        const payload = (await response.json()) as SnapshotResponse;
        if (cancelled) return;
        if (!response.ok && "error" in payload) {
          setError(payload.error);
        } else if (isSnapshot(payload)) {
          setSnapshot(payload);
        } else {
          setUnavailable(payload as Unavailable);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "network error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deep-link params are read once per Evidence mount; changing them
    // re-mounts via key in the workspace host.
  }, [focusParam, scenarioParam, certificateParam]);

  // Deep-link resolution derived during render (no cascading effect state):
  // select the scenario, open the certificate, focus the node — or fail
  // closed for ids that are not part of this current project.
  const deepLink = useMemo(() => {
    if (!snapshot) return { scenarioId: null as string | null, inspectedId: null as string | null, invalid: [] as string[] };
    const invalid: string[] = [];
    let scenarioId: string | null = null;
    let inspectedId: string | null = null;
    if (scenarioParam) {
      const found = snapshot.scenarios.find((entry) => entry.id === scenarioParam);
      if (found) scenarioId = found.id;
      else invalid.push(scenarioParam);
    }
    if (focusParam) {
      if (nodeKindOf(snapshot, focusParam)) inspectedId = focusParam;
      else invalid.push(focusParam);
    }
    if (certificateParam) {
      const certificate = snapshot.certificates.find((entry) => entry.id === certificateParam);
      if (certificate) {
        scenarioId = certificate.scenarioId;
        // The certificate owns the inspector; the focus keeps the ring/scroll
        // on its chain row below.
        inspectedId = certificate.id;
      } else if (snapshot.requestedCertificate?.status !== "current") {
        // A superseded/foreign certificate id: the STALE / RECOMPUTE banner
        // carries this case; no foreign data is rendered.
      } else {
        invalid.push(certificateParam);
      }
    }
    return { scenarioId, inspectedId, invalid };
  }, [snapshot, scenarioParam, certificateParam, focusParam]);

  const selectedScenarioId =
    userScenarioId ?? deepLink.scenarioId ?? (snapshot && snapshot.scenarios.length > 0 ? snapshot.scenarios[0].id : null);
  const inspectedId = userInspectedId ?? deepLink.inspectedId;

  // Scroll the focused chain row into view once rendered. A constraint focus
  // highlights its result row (the proof node a judge clicks); any other node
  // id highlights its own row.
  useEffect(() => {
    if (!snapshot || !focusParam || !nodeKindOf(snapshot, focusParam)) return;
    const element =
      chainRef.current?.querySelector(`[data-node-id="${focusParam}"]`) ??
      chainRef.current?.querySelector(`[data-constraint-id="${focusParam}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [snapshot, focusParam, inspectedId]);

  const maps = useMemo(() => {
    if (!snapshot) return null;
    return {
      source: new Map(snapshot.sources.map((row) => [row.id, row])),
      claim: new Map(snapshot.claims.map((row) => [row.id, row])),
      regulation: new Map(snapshot.regulations.map((row) => [row.id, row])),
      constraint: new Map(snapshot.constraints.map((row) => [row.id, row])),
      result: new Map(snapshot.results.map((row) => [row.id, row])),
      scenario: new Map(snapshot.scenarios.map((row) => [row.id, row])),
      certificate: new Map(snapshot.certificates.map((row) => [row.id, row])),
      assumption: new Map(snapshot.assumptions.map((row) => [row.id, row])),
      mission: new Map(snapshot.missions.map((row) => [row.id, row])),
    };
  }, [snapshot]);

  const selectedScenario = snapshot && selectedScenarioId
    ? snapshot.scenarios.find((entry) => entry.id === selectedScenarioId) ?? null
    : null;

  function downloadDiligence() {
    if (!snapshot) return;
    const markdown = buildDiligenceSummary(snapshot, selectedScenarioId);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `acrevia-diligence-${snapshot.identity.projectId.replace(/[^a-z0-9-]/gi, "")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <section aria-label="Evidence ledger" className="spatial-canvas spatial-canvas-live overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <p className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>
        </div>
      </section>
    );
  }

  if (unavailable) {
    return (
      <section aria-label="Evidence ledger" className="spatial-canvas spatial-canvas-live overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-stone-900">No verified proof to project</h2>
            <p className="mt-1 text-sm text-stone-800" data-testid="proof-unavailable">
              {unavailable.reason ?? "The proof projection is not available for this property yet."}
            </p>
          </div>
          <CompiledLaw />
        </div>
      </section>
    );
  }

  if (!snapshot || !maps) {
    return (
      <section aria-label="Evidence ledger" className="spatial-canvas spatial-canvas-live overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-stone-500">Building the proof projection…</p>
        </div>
      </section>
    );
  }

  const requestedStale = snapshot.requestedCertificate && snapshot.requestedCertificate.status !== "current";

  return (
    <section aria-label="Evidence ledger" className="spatial-canvas spatial-canvas-live overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {/* Header — identity + trust counts */}
        <header className="border-b border-stone-200 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">PROOF</p>
              <h2 className="mt-1 text-xl font-semibold text-stone-900" style={{ fontFamily: "var(--font-editorial)" }}>
                {snapshot.identity.matchedAddress ?? record.query}
              </h2>
              <p className="mt-0.5 text-sm text-stone-600">
                {snapshot.identity.district ?? "district unknown"}
                {snapshot.identity.overlay ? ` · ${snapshot.identity.overlay}` : ""} · project{" "}
                <span className="font-mono text-xs">{snapshot.identity.projectId}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={downloadDiligence}
              data-testid="diligence-download"
              className="flex items-center gap-2 rounded border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:border-stone-400"
            >
              <Download size={15} aria-hidden="true" />
              Diligence summary (.md)
            </button>
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-600">
            <div>
              <dt className="inline text-stone-500">Sources </dt>
              <dd className="inline font-medium">{snapshot.sources.length}</dd>
            </div>
            <div>
              <dt className="inline text-stone-500">Executable rules </dt>
              <dd className="inline font-medium">{snapshot.constraints.filter((c) => c.executable).length}</dd>
            </div>
            <div>
              <dt className="inline text-stone-500">Conflicts </dt>
              <dd className="inline font-medium">{snapshot.conflicts.length}</dd>
            </div>
            <div>
              <dt className="inline text-stone-500">Expert questions </dt>
              <dd className="inline font-medium">{snapshot.expertReviews.length}</dd>
            </div>
            <div>
              <dt className="inline text-stone-500">Assumptions </dt>
              <dd className="inline font-medium">{snapshot.assumptions.length}</dd>
            </div>
          </dl>
        </header>

        {requestedStale ? (
          <div
            className="rounded-md border-2 border-red-700 bg-red-50 p-4"
            data-testid="proof-stale-banner"
            role="alert"
          >
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-red-800">
              <ShieldAlert size={15} aria-hidden="true" />
              STALE / RECOMPUTE
            </p>
            <p className="mt-1 text-sm text-red-900">
              This proof belongs to an earlier project state. Certificate{" "}
              <span className="font-mono text-xs">{snapshot.requestedCertificate?.requestedId}</span> is not
              reproduced by the current deterministic rebuild of the accepted property.
            </p>
            <p className="mt-1 text-sm text-red-800">{snapshot.requestedCertificate?.reason}</p>
            {snapshot.certificates[0] ? (
              <p className="mt-1 text-sm text-red-900">
                Current proof:{" "}
                <button
                  type="button"
                  className="font-mono text-xs underline"
                  onClick={() => {
                    setUserScenarioId(snapshot.certificates[0].scenarioId);
                    setUserInspectedId(snapshot.certificates[0].id);
                  }}
                >
                  {snapshot.certificates[0].id}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}

        {deepLink.invalid.length > 0 ? (
          <div
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
            data-testid="focus-invalid-notice"
            role="alert"
          >
            {deepLink.invalid.map((id) => (
              <p key={id}>
                <span className="font-mono text-xs">{id}</span> is not part of this current project — Acrevia
                will not display another project&apos;s data.
              </p>
            ))}
          </div>
        ) : null}

        {/* Main grid: chain (left) + inspector (right) */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4" ref={chainRef}>
            {/* Scenario selector */}
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">SCENARIOS</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {snapshot.scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    data-testid="proof-scenario-option"
                    data-node-id={scenario.id}
                    data-focused={focusParam === scenario.id ? "true" : undefined}
                    onClick={() => {
                      setUserScenarioId(scenario.id);
                      setUserInspectedId(scenario.id);
                    }}
                    className={`rounded border px-3 py-2 text-left text-sm ${
                      scenario.id === selectedScenarioId
                        ? "border-stone-900 bg-white"
                        : "border-stone-200 bg-white hover:border-stone-400"
                    } ${focusParam === scenario.id ? "outline outline-2 outline-olive-600" : ""}`}
                  >
                    <span className="block font-medium text-stone-900">{scenario.label}</span>
                    <span className="block text-xs text-stone-600">
                      {scenario.metrics.find((metric) => metric.metricId === "homes")?.value?.value ?? "—"} homes ·{" "}
                      {scenario.metrics.find((metric) => metric.metricId === "parking-stalls")?.value?.value ?? "—"}{" "}
                      stalls
                    </span>
                    <span
                      className={`mt-1 inline-block rounded px-1 py-0.5 text-[11px] font-semibold ${
                        scenario.freshness === "CURRENT"
                          ? "bg-olive-100 text-olive-800"
                          : "bg-red-100 text-red-800"
                      }`}
                      data-testid="proof-certificate-freshness"
                    >
                      {scenario.freshness}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {selectedScenario ? (
              <ProofChain
                snapshot={snapshot}
                scenarioId={selectedScenario.id}
                focusParam={focusParam}
                onSelect={setUserInspectedId}
              />
            ) : null}
          </div>

          {/* Inspector rail */}
          <aside aria-label="Proof inspector" className="lg:sticky lg:top-0 self-start">
            <div className="rounded-md border border-stone-300 bg-white">
              <p className="border-b border-stone-200 px-4 py-2.5 text-xs font-semibold tracking-[0.14em] text-stone-500">
                INSPECTOR
              </p>
              <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
                {inspectedId ? (
                  <Inspector snapshot={snapshot} nodeId={inspectedId} />
                ) : (
                  <p className="text-sm text-stone-600">
                    Click any result, law, source, mission, assumption, or certificate in the chain to inspect
                    its derivation.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Compiled law — kept from issue #5, same contract */}
        <CompiledLaw />

        {/* Assumptions + mission */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Assumptions" className="rounded-md border border-amber-300 bg-amber-50/40 p-4">
            <h3 className="text-xs font-semibold tracking-[0.14em] text-amber-900">
              ASSUMPTIONS — MODEL-DECLARED, NOT LAW
            </h3>
            <ul className="mt-2 divide-y divide-amber-100">
              {snapshot.assumptions.map((assumption) => (
                <li key={assumption.id} className="py-2" data-testid="assumption-row">
                  <button
                    type="button"
                    data-node-id={assumption.id}
                    data-focused={focusParam === assumption.id ? "true" : undefined}
                    className={`w-full rounded text-left ${focusParam === assumption.id ? "outline outline-2 outline-olive-600" : ""}`}
                    onClick={() => setUserInspectedId(assumption.id)}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-stone-900">{assumption.valueSummary}</span>
                      <span className="shrink-0 rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-amber-900">
                        ASSUMPTION
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-600">{assumption.statement}</span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      origin MODELER_DECLARED · used by {assumption.usedByScenarioIds.length} scenario(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Mission rules" className="rounded-md border border-olive-300 bg-olive-50/40 p-4">
            <h3 className="text-xs font-semibold tracking-[0.14em] text-olive-900">
              MISSION RULES — USER DECLARED, NOT SOURCED FACTS
            </h3>
            <ul className="mt-2 divide-y divide-olive-100">
              {snapshot.missions.map((mission) => (
                <li key={mission.id} className="py-2" data-testid="mission-row">
                  <button
                    type="button"
                    data-node-id={mission.id}
                    data-focused={focusParam === mission.id ? "true" : undefined}
                    className={`w-full rounded text-left ${focusParam === mission.id ? "outline outline-2 outline-olive-600" : ""}`}
                    onClick={() => setUserInspectedId(mission.id)}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-stone-900">{mission.normalizedSummary}</span>
                      <span className="shrink-0 rounded border border-olive-600 bg-olive-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-olive-900">
                        USER DECLARED · CONFIRMED · {mission.hardOrSoft.toUpperCase()}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-600">“{mission.intentText}”</span>
                  </button>
                </li>
              ))}
              {snapshot.missions.length === 0 ? (
                <li className="py-2 text-sm text-stone-600">
                  No mission rules confirmed yet — confirm them on the Site surface.
                </li>
              ) : null}
            </ul>
          </section>
        </div>

        {/* Conflict compare */}
        <section aria-label="Conflicts" className="rounded-md border border-rust-400 bg-rust-50/50 p-4" data-testid="conflict-compare">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-rust-800">
            CONFLICTS — COMPETING VALUES, VISIBLE SIDE BY SIDE
          </h3>
          {snapshot.conflicts.length === 0 ? (
            <p className="mt-2 text-sm text-stone-700">
              No unresolved conflicts among the captured sources for this property. If sources later disagree,
              both values stay visible here with their authority and retrieval dates — Acrevia never silently
              picks a winner.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {snapshot.conflicts.map((conflict) => {
                const review = snapshot.expertReviews.find((entry) => entry.id === `phl:review:${conflict.conflictId}`);
                return (
                  <li key={conflict.conflictId} className="rounded border border-rust-300 bg-white p-3">
                    <p className="text-sm font-medium text-stone-900">{conflict.semanticRuleKey}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {conflict.members.map((member) => (
                        <div key={member.candidateId} className="rounded border border-stone-200 p-2">
                          <p className="text-sm font-semibold text-stone-900">{member.valueSummary}</p>
                          <p className="mt-0.5 text-xs text-stone-600">
                            {member.sourceRef} · {member.authority.replace(/_/g, " ").toLowerCase()} · retrieved{" "}
                            {member.retrievedAt.slice(0, 10)}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-stone-700">
                      <span className="font-semibold">Compiler resolution: {conflict.resolution}</span>
                      {conflict.resolution === "blocked"
                                        ? " — Acrevia refused to choose; nothing executable until expert review."
                                        : ""}{" "}
                      {conflict.explanation}
                    </p>
                    {review ? (
                      <p className="mt-1 text-xs text-rust-800">
                        Expert review <span className="font-mono">{review.id}</span> ({review.severity}) tracks
                        this conflict.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Expert queue */}
        <section aria-label="Expert review queue" className="rounded-md border border-stone-300 bg-white p-4" data-testid="expert-queue">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
            EXPERT QUEUE — WHAT ACREVIA CANNOT RESOLVE
          </h3>
          <p className="mt-1 text-xs text-stone-600">
            Graph expert-review items (professional judgment) and unresolved deterministic checks (computation)
            are kept distinct on purpose.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-stone-700">PROFESSIONAL JUDGMENT — GRAPH EXPERT REVIEWS</p>
              <ul className="mt-2 space-y-2">
                {snapshot.expertReviews.map((review) => (
                  <li key={review.id} className="rounded border border-stone-200 p-2" data-testid="expert-review-item">
                    <p className="text-sm text-stone-900">{review.question}</p>
                    <p className="mt-0.5 text-xs text-stone-600">Why it matters: {review.whyItMatters}</p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      category {review.category} · severity {review.severity} · status {review.reviewStatus}
                      {review.affectedNodeIds.length > 0
                        ? ` · affects ${review.affectedNodeIds.length} node(s)`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-700">UNRESOLVED COMPUTATION — SCENARIO CHECKS</p>
              <ul className="mt-2 space-y-2">
                {dedupeQuestions(snapshot.computationQuestions).map((question) => (
                  <li key={question.key} className="rounded border border-stone-200 p-2" data-testid="computation-question">
                    <p className="text-sm text-stone-900">
                      {question.label} — {STATUS_LABEL[question.status] ?? question.status}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-600">{question.explanation}</p>
                  </li>
                ))}
                {snapshot.computationQuestions.length === 0 ? (
                  <li className="text-sm text-stone-600">Every recorded check was deterministically evaluated.</li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>

        <p className="pb-2 text-xs text-stone-500">
          Proof is a projection of the Development Graph rebuilt from your accepted property on each request —
          the server stores nothing. Statuses distinguish source confirmation, deterministic computation
          (MACHINE CHECKED is a label, not an evidence state), modeler assumptions, conflicts, staleness, and
          professional-judgment questions.
        </p>
      </div>
    </section>
  );
}

function dedupeQuestions(
  questions: ProofSnapshot["computationQuestions"],
): Array<{ key: string; label: string; status: string; explanation: string }> {
  const seen = new Map<string, { key: string; label: string; status: string; explanation: string }>();
  for (const question of questions) {
    const key = `${question.constraintId}:${question.status}`;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        label: question.label,
        status: question.status,
        explanation: question.explanation,
      });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Proof chain (center column)
// ---------------------------------------------------------------------------

function ProofChain({
  snapshot,
  scenarioId,
  focusParam,
  onSelect,
}: {
  snapshot: ProofSnapshot;
  scenarioId: string;
  focusParam: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const scenario = snapshot.scenarios.find((entry) => entry.id === scenarioId);
  const certificate = scenario
    ? snapshot.certificates.find((entry) => entry.id === scenario.certificateId)
    : undefined;
  if (!scenario || !certificate) return null;
  const results = snapshot.results.filter((row) => row.scenarioId === scenarioId);
  const lawResults = results.filter((row) => row.source === "law");
  const missionResults = results.filter((row) => row.source === "mission");
  const assumptionResults = results.filter((row) => row.source === "assumption");

  return (
    <div className="space-y-3" data-testid="proof-chain">
      {/* Certificate — top of the chain */}
      <button
        type="button"
        data-node-id={certificate.id}
        data-focused={focusParam === certificate.id ? "true" : undefined}
        onClick={() => onSelect(certificate.id)}
        className={`flex w-full items-center justify-between gap-3 rounded border px-4 py-3 text-left ${
          certificate.freshness === "CURRENT" ? "border-olive-500 bg-olive-50" : "border-red-700 bg-red-50"
        } ${focusParam === certificate.id ? "outline outline-2 outline-olive-600" : ""}`}
      >
        <span>
          <span className="block text-xs font-semibold tracking-[0.14em] text-stone-600">
            SCENARIO CERTIFICATE
          </span>
          <span className="mt-0.5 block text-sm text-stone-900">
            What facts made this scenario true — {certificate.dependencyCount} pinned dependencies
          </span>
        </span>
        <span
          className={`shrink-0 rounded px-2 py-1 font-mono text-[11px] font-semibold ${
            certificate.freshness === "CURRENT" ? "bg-olive-600 text-white" : "bg-red-700 text-white"
          }`}
        >
          {certificate.freshness}
        </span>
      </button>

      {/* Scenario metrics */}
      <div className="rounded border border-stone-300 bg-white px-4 py-3">
        <button
          type="button"
          data-node-id={scenario.id}
          data-focused={focusParam === scenario.id ? "true" : undefined}
          className={`w-full rounded text-left ${focusParam === scenario.id ? "outline outline-2 outline-olive-600" : ""}`}
          onClick={() => onSelect(scenario.id)}
        >
          <span className="block text-xs font-semibold tracking-[0.14em] text-stone-500">
            SCENARIO — {scenario.label}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {scenario.metrics.map((metric) => (
              <span key={metric.metricId} className="text-sm text-stone-900">
                <strong className="text-base font-semibold">{quantityText(metric.value)}</strong>{" "}
                <span className="text-stone-500">{metric.label.toLowerCase()}</span>
              </span>
            ))}
          </span>
        </button>
      </div>

      {/* Results: the constraint → law spine */}
      <div className="rounded border border-stone-300 bg-white">
        <p className="border-b border-stone-100 px-4 py-2 text-xs font-semibold tracking-[0.14em] text-stone-500">
          CONSTRAINT RESULTS — CLICK ONE TO TRACE ITS LAW AND SOURCES
        </p>
        <ul className="divide-y divide-stone-100">
          {[...lawResults, ...missionResults, ...assumptionResults].map((result) => (
            <li key={result.id}>
              <button
                type="button"
                data-node-id={result.id}
                data-constraint-id={result.constraintId}
                data-focused={focusParam === result.id || focusParam === result.constraintId ? "true" : undefined}
                onClick={() => onSelect(result.id)}
                className={`flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-stone-50 ${
                  focusParam === result.constraintId ? "outline outline-2 outline-olive-600" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-stone-900">
                    {resultLabel(snapshot, result)}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-600">
                    {result.actual
                      ? `${quantityText(result.actual)} against a limit of ${quantityText(result.limit)}`
                      : result.explanation.slice(0, 120)}
                  </span>
                  {result.source === "mission" ? (
                    <span className="mt-0.5 block text-[11px] font-medium text-olive-800">
                      USER-DECLARED MISSION RULE — not a legal requirement
                    </span>
                  ) : result.source === "assumption" ? (
                    <span className="mt-0.5 block text-[11px] font-medium text-amber-800">
                      ASSUMPTION-DERIVED — not legal fact
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide ${
                      STATUS_CHIP[result.status] ?? STATUS_CHIP.UNKNOWN
                    }`}
                  >
                    {STATUS_LABEL[result.status] ?? result.status}
                  </span>
                  {result.machineCheckable ? (
                    <span
                      className="rounded border border-stone-900 bg-stone-900 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-white"
                      data-testid="machine-checked"
                    >
                      MACHINE CHECKED
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector (right rail)
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-1 text-xs">
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-800">{children}</span>
    </div>
  );
}

function Inspector({ snapshot, nodeId }: { snapshot: ProofSnapshot; nodeId: string }) {
  const source = snapshot.sources.find((row) => row.id === nodeId);
  if (source) {
    return (
      <div data-testid="inspector-source">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">SOURCE CONFIRMED</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{source.title}</p>
        <div className="mt-2">
          <Row label="Publisher">{source.publisher}</Row>
          <Row label="Authority">{source.authority.replace(/_/g, " ").toLowerCase()}</Row>
          <Row label="Retrieved">{source.retrievedAt.slice(0, 10)}</Row>
          <Row label="Version">
            v{source.version} <span className="font-mono text-[11px]">({source.logicalSourceKey})</span>
          </Row>
          {source.rawContentHash ? <Row label="Content hash">{source.rawContentHash.slice(0, 16)}…</Row> : null}
          {source.rawEvidenceRef ? <Row label="Raw evidence">{source.rawEvidenceRef}</Row> : null}
          {source.effectiveDate ? <Row label="Effective">{source.effectiveDate.slice(0, 10)}</Row> : null}
        </div>
        {source.supersededBy ? (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            SUPERSEDED by {source.supersededBy} — stale source, never current executable truth.
          </p>
        ) : null}
      </div>
    );
  }

  const claim = snapshot.claims.find((row) => row.id === nodeId);
  if (claim) {
    return (
      <div data-testid="inspector-claim">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">
          {claim.strand === "law" ? "LAW CLAIM" : "APPLIES HERE CLAIM"}
        </p>
        <p className="mt-1 text-sm font-medium text-stone-900">{claim.valueSummary}</p>
        <div className="mt-2">
          <Row label="Predicate">{claim.predicate}</Row>
          <Row label="Strand">
            {claim.strand === "law"
              ? "LAW — what the legal text says"
              : "APPLIES HERE — why it applies to this parcel"}
          </Row>
          {claim.evidenceState ? (
            <Row label="Evidence">
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                  claim.evidenceState === "VERIFIED" || claim.evidenceState === "SOURCE_CONFIRMED"
                    ? "bg-olive-100 text-olive-800"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {claim.evidenceState.replace(/_/g, " ")}
              </span>
            </Row>
          ) : null}
          <Row label="Origin">{claim.originKind.replace(/_/g, " ").toLowerCase()}</Row>
        </div>
        {claim.verbatimQuote ? (
          <blockquote className="mt-2 border-l-2 border-stone-300 pl-2 text-xs text-stone-700">
            “{claim.verbatimQuote}”
          </blockquote>
        ) : null}
        {claim.sourceIds.length > 0 ? (
          <p className="mt-2 text-xs">
            {claim.sourceIds.map((id) => (
              <button
                key={id}
                type="button"
                className="mr-2 font-mono text-[11px] text-stone-700 underline"
                onClick={() => {
                  /* parent-level navigation handled by rendering id below */
                }}
              >
                {id}
              </button>
            ))}
          </p>
        ) : null}
      </div>
    );
  }

  const regulation = snapshot.regulations.find((row) => row.id === nodeId);
  if (regulation) {
    return (
      <div data-testid="inspector-regulation">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">REGULATION</p>
        <p className="mt-1 font-mono text-xs text-stone-800">{regulation.id}</p>
        <div className="mt-2">
          <Row label="Locator">{regulation.codeSection}</Row>
          <Row label="Applicability">
            {Object.entries(regulation.applicability)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => `${key}: ${String(value)}`)
              .join(" · ") || "jurisdiction-wide"}
          </Row>
          <Row label="Currentness">{regulation.currentness}</Row>
        </div>
        {regulation.conflictRefs.length > 0 ? (
          <p className="mt-2 rounded border border-rust-400 bg-rust-50 p-2 text-xs text-rust-900">
            CONFLICT — {regulation.conflictRefs.join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  const constraint = snapshot.constraints.find((row) => row.id === nodeId);
  if (constraint) {
    const lawClaim = snapshot.claims.find((row) => row.id === constraint.lawClaimId);
    const lawSource = snapshot.sources.find((row) => row.id === constraint.lawSourceId);
    const appliesClaim = snapshot.claims.find((row) => row.id === constraint.appliesHereClaimId);
    const appliesSource = snapshot.sources.find((row) => row.id === constraint.appliesHereSourceId);
    return (
      <div data-testid="inspector-constraint">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">CONSTRAINT</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{constraint.valueSummary}</p>
        <p className="font-mono text-[11px] text-stone-500">{constraint.id}</p>
        <div className="mt-2">
          <Row label="Kind">{constraint.constraintKind}</Row>
          <Row label="Executable">
            {constraint.executable ? "yes — passed the solver gate" : "no"}
          </Row>
          {!constraint.executable ? (
            <ul className="mt-1 list-disc pl-4 text-xs text-stone-600">
              {constraint.executabilityReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          <div className="rounded border border-stone-200 p-2" data-testid="law-strand">
            <p className="text-[11px] font-semibold tracking-wide text-stone-600">
              LAW — WHAT THE RULE SAYS
            </p>
            {lawClaim ? (
              <>
                <p className="mt-1 text-xs text-stone-800">{lawClaim.valueSummary}</p>
                {lawClaim.verbatimQuote ? (
                  <blockquote className="mt-1 border-l-2 border-stone-300 pl-2 text-[11px] text-stone-600">
                    “{lawClaim.verbatimQuote}”
                  </blockquote>
                ) : null}
                <p className="mt-1 font-mono text-[11px] text-stone-500">{lawClaim.id}</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-stone-600">No law claim resolved.</p>
            )}
            {lawSource ? (
              <p className="mt-1 text-[11px] text-stone-600">
                {lawSource.title} · {lawSource.authority.replace(/_/g, " ").toLowerCase()} · retrieved{" "}
                {lawSource.retrievedAt.slice(0, 10)}
              </p>
            ) : null}
          </div>
          <div className="rounded border border-stone-200 p-2" data-testid="applies-here-strand">
            <p className="text-[11px] font-semibold tracking-wide text-stone-600">
              APPLIES HERE — WHY IT BINDS THIS PARCEL
            </p>
            {appliesClaim ? (
              <>
                <p className="mt-1 text-xs text-stone-800">{appliesClaim.valueSummary}</p>
                <p className="mt-1 font-mono text-[11px] text-stone-500">{appliesClaim.id}</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-stone-600">No site applicability claim (jurisdiction-wide rule).</p>
            )}
            {appliesSource ? (
              <p className="mt-1 text-[11px] text-stone-600">
                {appliesSource.title} · {appliesSource.authority.replace(/_/g, " ").toLowerCase()}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const result = snapshot.results.find((row) => row.id === nodeId);
  if (result) {
    const margin =
      result.actual && result.limit && result.actual.unit === result.limit.unit
        ? result.limit.value - result.actual.value
        : null;
    const constraint = snapshot.constraints.find((row) => row.id === result.constraintId);
    const scenario = snapshot.scenarios.find((row) => row.id === result.scenarioId);
    const certificate = scenario
      ? snapshot.certificates.find((row) => row.id === scenario.certificateId)
      : undefined;
    return (
      <div data-testid="inspector-result">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">CONSTRAINT RESULT</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{resultLabel(snapshot, result)}</p>
        <div className="mt-2">
          <Row label="Status">
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                STATUS_CHIP[result.status] ?? STATUS_CHIP.UNKNOWN
              }`}
            >
              {STATUS_LABEL[result.status] ?? result.status}
            </span>
          </Row>
          <Row label="Actual">{quantityText(result.actual)}</Row>
          <Row label="Limit">{quantityText(result.limit)}</Row>
          {margin !== null ? <Row label="Margin">{margin.toLocaleString("en-US")}</Row> : null}
          <Row label="Method">{result.method}</Row>
        </div>
        {result.machineCheckable ? (
          <p className="mt-2 flex items-center gap-1.5 rounded border border-stone-300 bg-stone-50 p-2 text-xs text-stone-700">
            <ShieldCheck size={13} aria-hidden="true" />
            MACHINE CHECKED — deterministic computation with known method and version; inputs inspectable
            below.
          </p>
        ) : (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Not machine-checkable: {STATUS_LABEL[result.status] ?? result.status} — see the explanation.
          </p>
        )}
        <p className="mt-2 text-xs text-stone-700">{result.explanation}</p>
        {constraint ? (
          <button
            type="button"
            onClick={() => {
              /* constraint chain shown in the LAW/APPLIES sections above via constraint row */
            }}
            className="mt-2 block w-full rounded border border-stone-200 p-2 text-left text-xs text-stone-700 hover:border-stone-400"
          >
            <span className="font-medium">{constraint.valueSummary}</span>
            <span className="mt-0.5 block font-mono text-[11px] text-stone-500">{constraint.id}</span>
            <span className="mt-1 block" data-testid="law-strand">
              LAW · {snapshot.sources.find((row) => row.id === constraint.lawSourceId)?.title ?? "—"}
            </span>
            <span className="block" data-testid="applies-here-strand">
              APPLIES HERE ·{" "}
              {snapshot.claims.find((row) => row.id === constraint.appliesHereClaimId)?.valueSummary ?? "—"}
            </span>
          </button>
        ) : null}
        {scenario && certificate ? (
          <p className="mt-2 text-xs text-stone-600">
            Scenario <span className="font-medium">{scenario.label}</span> depends on this result through
            certificate <span className="font-mono text-[11px]">{certificate.id}</span> ({certificate.freshness}).
          </p>
        ) : null}
      </div>
    );
  }

  const scenario = snapshot.scenarios.find((row) => row.id === nodeId);
  if (scenario) {
    const certificate = snapshot.certificates.find((row) => row.id === scenario.certificateId);
    return (
      <div data-testid="inspector-scenario">
        <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">SCENARIO</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{scenario.label}</p>
        <div className="mt-2">
          <Row label="Status">{scenario.status}</Row>
          <Row label="Solver">{scenario.solverVersion}</Row>
          {scenario.confidence ? <Row label="Confidence">{scenario.confidence.replace(/_/g, " ").toLowerCase()}</Row> : null}
        </div>
        <p className="mt-2 text-xs text-stone-700">
          Every metric above is pinned by the scenario certificate: changing any law, mission, or assumption it
          depends on produces a different certificate and marks this one stale.
        </p>
        {certificate ? (
          <button
            type="button"
            onClick={() => {
              /* certificate inspected via its own row */
            }}
            className="mt-2 block w-full rounded border border-stone-200 p-2 text-left text-xs text-stone-700 hover:border-stone-400"
          >
            Certificate <span className="font-mono text-[11px]">{certificate.id}</span> · {certificate.freshness} ·{" "}
            {certificate.dependencyCount} dependencies
          </button>
        ) : null}
      </div>
    );
  }

  const certificate = snapshot.certificates.find((row) => row.id === nodeId);
  if (certificate) {
    return <CertificateInspector certificate={certificate} snapshot={snapshot} />;
  }

  const assumption = snapshot.assumptions.find((row) => row.id === nodeId);
  if (assumption) {
    return (
      <div data-testid="inspector-assumption">
        <p className="text-xs font-semibold tracking-[0.14em] text-amber-800">ASSUMPTION</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{assumption.valueSummary}</p>
        <div className="mt-2">
          <Row label="Statement">{assumption.statement}</Row>
          <Row label="Origin">MODELER_DECLARED — a planning input, not a sourced fact</Row>
          <Row label="Active">{assumption.active ? "yes" : "no"}</Row>
          {assumption.reviewTrigger ? <Row label="Review at">{assumption.reviewTrigger}</Row> : null}
        </div>
        <p className="mt-2 text-xs text-stone-700">{assumption.rationale}</p>
        {assumption.usedByScenarioIds.length > 0 ? (
          <p className="mt-2 text-xs text-stone-600">
            Used by: {assumption.usedByScenarioIds.map((id) => id.split(":")[2] ?? id).join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  const mission = snapshot.missions.find((row) => row.id === nodeId);
  if (mission) {
    return (
      <div data-testid="inspector-mission">
        <p className="text-xs font-semibold tracking-[0.14em] text-olive-800">MISSION RULE</p>
        <p className="mt-1 text-sm font-medium text-stone-900">{mission.normalizedSummary}</p>
        <div className="mt-2">
          <Row label="Declared">“{mission.intentText}”</Row>
          <Row label="Origin">USER_DECLARED · CONFIRMED</Row>
          <Row label="Strength">{mission.hardOrSoft}</Row>
          {mission.structureId ? <Row label="Structure">{mission.structureId}</Row> : null}
        </div>
        <p className="mt-2 text-xs text-stone-600">
          Mission rules are the congregation&apos;s own commitments. They are never presented as sourced
          external facts.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="inspector-unknown">
      <p className="text-sm text-red-800">
        <span className="font-mono text-xs">{nodeId}</span> is not part of this current project — Acrevia will
        not display another project&apos;s data.
      </p>
    </div>
  );
}

function CertificateInspector({
  certificate,
  snapshot,
}: {
  certificate: ProofSnapshot["certificates"][number];
  snapshot: ProofSnapshot;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const byKind = certificate.dependencies.reduce<Record<string, number>>((counts, dependency) => {
    counts[dependency.nodeKind] = (counts[dependency.nodeKind] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <div data-testid="inspector-certificate">
      <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">SCENARIO CERTIFICATE</p>
      <p className="mt-1 text-sm font-medium text-stone-900">
        What facts made this scenario true
      </p>
      <div className="mt-2">
        <Row label="Certificate">
          <span className="font-mono text-[11px]">{certificate.id}</span>
        </Row>
        <Row label="Scenario">
          {snapshot.scenarios.find((row) => row.id === certificate.scenarioId)?.label ?? certificate.scenarioId}
        </Row>
        <Row label="Solver">{certificate.solverVersion}</Row>
        <Row label="Version">v{certificate.certificateVersion}</Row>
        <Row label="Freshness">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
              certificate.freshness === "CURRENT" ? "bg-olive-100 text-olive-800" : "bg-red-100 text-red-800"
            }`}
          >
            {certificate.freshness}
          </span>
        </Row>
        <Row label="Dependencies">{certificate.dependencyCount}</Row>
      </div>
      {certificate.freshnessReasons.length > 0 ? (
        <ul className="mt-2 list-disc rounded border border-red-300 bg-red-50 p-2 pl-6 text-xs text-red-800">
          {certificate.freshnessReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-stone-600">
        Pinned dependency kinds:{" "}
        {Object.entries(byKind)
          .sort()
          .map(([kind, count]) => `${count} ${kind}`)
          .join(" · ")}
      </p>
      <button
        type="button"
        onClick={() => setShowTechnical((value) => !value)}
        className="mt-2 text-xs text-stone-600 underline"
        aria-expanded={showTechnical}
      >
        {showTechnical ? "Hide" : "Show"} technical details (revision · semantic hash · node ids)
      </button>
      {showTechnical ? (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-stone-200 p-2">
          {certificate.dependencies.map((dependency) => (
            <li key={dependency.nodeId} className="font-mono text-[11px] text-stone-600">
              {dependency.nodeId} · {dependency.nodeKind} · r{dependency.revision} ·{" "}
              {dependency.semanticHash.slice(0, 10)}…
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 font-mono text-[11px] text-stone-400">hash {certificate.certificateHash.slice(0, 24)}…</p>
    </div>
  );
}
