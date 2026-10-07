"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionCommand } from "../../application/mission/rebuild";
import { readMissionLogFor, readStoredAcceptedPair } from "../../lib/accepted-property";

/**
 * SCENARIOS (issue #7) — LAW says what may happen. MISSION says what the
 * church refuses to sacrifice. This surface shows the intersection, computed
 * by the deterministic solver over the accepted property + confirmed mission
 * rules. It NEVER authors truth: every number arrives from
 * POST /api/solver/solve, which verifies the accepted pair, replays the
 * mission command log, records each scenario with a ScenarioCertificate, and
 * solves server-side.
 *
 * Language discipline: scenarios are "supported within modeled scope" — area
 * arithmetic does not prove physical placement until real polygons are
 * placed (#9). The top of the model is a MODELED UPPER BOUND, not a promise.
 * When a target exceeds that bound this surface says NO VERIFIED SOLUTION —
 * visually unmistakable — with the mechanically proven binding constraints
 * and the nearest supported alternatives beneath it.
 */

type SolverResultRow = {
  key: string;
  label: string;
  source: "law" | "mission" | "assumption";
  status: string;
  actual: number | null;
  actualUnit: string | null;
  limit: number | null;
  limitUnit: string | null;
  explanation: string;
};

type Ceilings = {
  legalDensity: number | null;
  massing: number;
  physicalSiteAreaBudget: number;
  overall: number;
};

type ScenarioCertificate = {
  scenarioId: string;
  certificateId: string;
  freshness: string;
};

type SolvedResponse = {
  status: "SOLVED";
  targetHomes: number | null;
  ceilings: Ceilings & { note?: string };
  modeledUpperBoundHomes: number;
  enumeration?: {
    homesUpperBound: number;
    parkingStallsMin: number;
    parkingStallsMax: number;
    floorsCap: number;
    pointsConsidered: number;
  };
  geometry: {
    parcelAreaSqFt: number;
    preservedStructureAreaSqFt: number;
    occupiedAreaCeilingPct: number;
    heightCeilingFt: number;
    floorsCap: number;
    parkingStallsRequired: number;
    parkingLandAreaSqFt: number;
    warnings: string[];
  };
  scenarios: Array<{
    label: string | null;
    homes: number;
    parkingStalls: number;
    parkingMargin: number;
    footprintSqFt: number;
    floors: number;
    confidence: string;
    professionalQuestions: string[];
    certificate: ScenarioCertificate | null;
    results: SolverResultRow[];
  }>;
  assumptions: Array<{
    id: string;
    statement?: string;
    rationale?: string;
    value?: string;
  }>;
  handoff: {
    legalEnvelopeVerified: boolean;
    regions: Array<{ role: string; geometryStatus: string; areaSqFt: number | null }>;
    unresolved: string[];
  };
};

type NoSolutionResponse = {
  status: "NO_VERIFIED_SOLUTION";
  targetHomes: number;
  modeledUpperBoundHomes: number;
  ceilings: Ceilings & { note?: string };
  explanation: string;
  counterfactuals: string[];
  binding: Array<{
    constraintKey: string;
    humanLabel: string;
    source: string;
    currentLimit: number;
    relaxedLimit: number;
    capacityBefore: number;
    capacityAfter: number;
    capacityDeltaHomes: number;
    unit: string;
    explanation: string;
    missionLocked: boolean;
  }>;
  nearestAlternatives: Array<{
    homes: number;
    parkingStalls: number;
    parkingMargin: number;
    footprintSqFt: number;
    floors: number;
  }>;
};

type RefusedResponse = {
  status: "REFUSED" | "needs-evidence" | "unsupported-district" | "multi-parcel-unsupported";
  reason?: string;
  message?: string;
};

type SolverResponse = SolvedResponse | NoSolutionResponse | RefusedResponse | { error: string };

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  SATISFIED: { label: "SATISFIED", className: "bg-olive-100 text-olive-800" },
  VIOLATED: { label: "VIOLATED", className: "bg-red-100 text-red-800" },
  UNKNOWN: { label: "UNKNOWN", className: "bg-stone-200 text-stone-700" },
  NOT_EVALUATED: { label: "NOT EVALUATED", className: "bg-amber-100 text-amber-800" },
  EXPERT_REQUIRED: { label: "EXPERT REQUIRED", className: "bg-amber-100 text-amber-900" },
};

const CONFIDENCE_NOTE: Record<string, string> = {
  SUPPORTED_WITHIN_MODED_SCOPE: "Supported within modeled scope — area arithmetic, not yet a placement proof",
  ASSUMPTION_SENSITIVE: "Assumption-sensitive — changes with the stated assumptions",
  EXPERT_REVIEW_REQUIRED: "Expert review required before relying on this",
  NO_VERIFIED_SOLUTION: "No verified solution",
};

function n(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}

export function ScenarioSolver() {
  const [result, setResult] = useState<SolverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const inFlight = useRef(0);

  const run = useCallback(async (targetHomes?: number) => {
    const pair = readStoredAcceptedPair();
    if (!pair) return;
    const commands = readMissionLogFor<MissionCommand>(pair);
    const seq = ++inFlight.current;
    setBusy(true);
    try {
      const response = await fetch("/api/solver/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: pair.envelope,
          receipt: pair.receipt,
          commands,
          ...(targetHomes !== undefined ? { targetHomes } : {}),
        }),
      });
      const payload = (await response.json()) as SolverResponse;
      if (seq !== inFlight.current) return;
      if (!response.ok && "error" in payload) {
        setError(payload.error);
        setResult(null);
      } else {
        setError(null);
        setResult(payload);
      }
    } catch {
      if (seq === inFlight.current) {
        setError("The solver could not be reached. Nothing was computed.");
        setResult(null);
      }
    } finally {
      if (seq === inFlight.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Deferred one tick so the synchronous part of run() (setBusy) never
    // executes inside the effect body.
    const timer = setTimeout(() => void run(), 0);
    return () => clearTimeout(timer);
  }, [run]);

  function testGoal() {
    const parsed = Number.parseInt(target, 10);
    if (Number.isNaN(parsed) || parsed < 0 || String(parsed) !== target.trim()) return;
    void run(parsed);
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-stone-500">
          {busy ? "Computing supported scenarios…" : "Preparing the solver…"}
        </p>
      </div>
    );
  }

  if ("status" in result && (result.status === "REFUSED" || result.status === "needs-evidence" || result.status === "unsupported-district" || result.status === "multi-parcel-unsupported")) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-stone-900">
            {result.status === "REFUSED" ? "The solver refused to search" : "No verified law to execute"}
          </h2>
          <p className="mt-1 text-sm text-stone-800">{result.reason ?? result.message}</p>
          <p className="mt-2 text-xs text-stone-600">
            Acrevia never returns a partial or pretended optimum. When it cannot compute within its
            proven bounds, it says so.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {"status" in result && result.status === "NO_VERIFIED_SOLUTION" ? (
        <NoSolutionPanel response={result} />
      ) : (
        "status" in result && result.status === "SOLVED" ? (
          <SolvedPanels response={result} />
        ) : null
      )}

      <section aria-label="Test a housing goal" className="rounded-md border border-stone-300 bg-white p-4">
        <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">TEST A HOUSING GOAL</h3>
        <p className="mt-1 text-xs text-stone-600">
          Enter a number of homes. The solver proves it supported within the modeled scope — or
          returns NO VERIFIED SOLUTION with the binding constraints that close the door. It never
          rounds in the church&apos;s favor.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            aria-label="Homes to test"
            inputMode="numeric"
            pattern="[0-9]*"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") testGoal();
            }}
            placeholder="e.g. 70"
            className="w-32 rounded border border-stone-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={testGoal}
            disabled={busy || target.trim() === ""}
            className="rounded bg-olive-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Solving…" : "Prove it"}
          </button>
          {"status" in result && result.status === "SOLVED" && result.targetHomes !== null ? (
            <button
              type="button"
              onClick={() => {
                setTarget("");
                void run();
              }}
              className="text-xs text-stone-500 underline"
            >
              Back to the frontier
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CeilingsBand({ ceilings }: { ceilings: Ceilings }) {
  const rows: Array<{ label: string; value: number | null; note: string }> = [
    {
      label: "Legal density capacity",
      value: ceilings.legalDensity,
      note: "RM-1 tiered minimum lot area per unit (law)",
    },
    {
      label: "Building massing capacity",
      value: ceilings.massing,
      note: "occupied-area envelope × floors ÷ gross per unit — parking land not subtracted",
    },
    {
      label: "Physical site area-budget ceiling",
      value: ceilings.physicalSiteAreaBudget,
      note: "parcel − preserved sanctuary − required parking land, then × floors ÷ gross per unit",
    },
  ];
  const binding = ceilings.overall;
  return (
    <section aria-label="Modeled capacity ceilings" className="rounded-md border border-stone-300 bg-white p-4">
      <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
        THREE MODELED CEILINGS, COMPUTED INDEPENDENTLY
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`rounded border p-3 ${
              row.value === binding ? "border-olive-500 bg-olive-50" : "border-stone-200"
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-stone-500">{row.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-900">{n(row.value)}</p>
            <p className="text-[11px] text-stone-500">homes max</p>
            <p className="mt-1 text-[11px] text-stone-500">{row.note}</p>
            {row.value === binding ? (
              <p className="mt-1 text-[11px] font-semibold text-olive-800">BINDING — the tightest modeled truth</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-600">
        Modeled capacity upper bound: <strong>{n(ceilings.overall)} homes</strong> — the minimum of
        the independently computed ceilings, never more. Area arithmetic does not prove physical
        placement: spatial packing and unresolved setbacks can only lower the realizable result.
      </p>
    </section>
  );
}

function SolvedPanels({ response }: { response: SolvedResponse }) {
  const g = response.geometry;
  return (
    <>
      <CeilingsBand ceilings={response.ceilings} />
      <section aria-label="Supported scenarios" className="rounded-md border border-stone-300 bg-white">
        <h3 className="border-b border-stone-100 p-4 text-xs font-semibold tracking-[0.14em] text-stone-500">
          SUPPORTED SCENARIOS WITHIN MODELED SCOPE — THE PARETO FRONTIER
        </h3>
        <ul>
          {response.scenarios.map((scenario, index) => {
            const law = scenario.results.filter((r) => r.source === "law");
            const missions = scenario.results.filter((r) => r.source === "mission");
            const satisfied = scenario.results.filter((r) => r.status === "SATISFIED").length;
            const open = scenario.results.filter((r) => r.status !== "SATISFIED");
            return (
              <li key={index} className="border-b border-stone-100 p-4 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="rounded bg-stone-900 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                      {scenario.label ?? `SCENARIO ${index + 1}`}
                    </span>
                    <p className="mt-2 text-3xl font-semibold text-stone-900">
                      {scenario.homes} <span className="text-base font-normal text-stone-500">homes</span>
                    </p>
                  </div>
                  <p className="text-xs text-stone-600">
                    {scenario.floors} floors · {n(scenario.footprintSqFt)} sq ft footprint (exact
                    minimum for this program) · {scenario.parkingStalls} parking stalls (mission
                    minimum {g.parkingStallsRequired}, margin +{scenario.parkingMargin})
                  </p>
                </div>
                <p className="mt-2 text-xs text-stone-600">
                  {CONFIDENCE_NOTE[scenario.confidence] ?? scenario.confidence} · {satisfied}/
                  {scenario.results.length} checks satisfied
                </p>
                {scenario.certificate ? (
                  <p className="mt-1 text-xs text-stone-600" data-testid="scenario-certificate">
                    ScenarioCertificate{" "}
                    <span className="font-mono text-[11px]">{scenario.certificate.certificateId}</span>{" "}
                    ·{" "}
                    <span
                      className={
                        scenario.certificate.freshness === "CURRENT"
                          ? "font-semibold text-olive-800"
                          : "font-semibold text-red-800"
                      }
                    >
                      {scenario.certificate.freshness}
                    </span>
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {open.map((row) => {
                    const chip = STATUS_CHIP[row.status] ?? STATUS_CHIP.UNKNOWN;
                    return (
                      <span key={row.key} title={row.explanation} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.className}`}>
                        {row.label}: {chip.label}
                      </span>
                    );
                  })}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-stone-500">
                    Every check, with its explanation
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {law.map((row) => (
                      <ConstraintLine key={row.key} row={row} tag="LAW" />
                    ))}
                    {missions.map((row) => (
                      <ConstraintLine key={row.key} row={row} tag="MISSION" />
                    ))}
                    {scenario.results
                      .filter((r) => r.source === "assumption")
                      .map((row) => (
                        <ConstraintLine key={row.key} row={row} tag="ASSUMPTION" />
                      ))}
                  </ul>
                </details>
                {scenario.professionalQuestions.length > 0 ? (
                  <p className="mt-2 text-xs text-stone-600">
                    <strong>Ask a professional:</strong> {scenario.professionalQuestions.join(" ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-stone-100 p-4 text-xs text-stone-600">
          Protected sanctuary stays: {n(g.preservedStructureAreaSqFt)} sq ft preserved · height
          ceiling {n(g.heightCeilingFt)} ft · parcel {n(g.parcelAreaSqFt)} sq ft (computed geodesic) ·
          occupied-area allowance {g.occupiedAreaCeilingPct}% covers structures only — parking never
          counts toward it.
        </p>
      </section>
      <AssumptionsPanel assumptions={response.assumptions} />
      {g.warnings.length > 0 ? (
        <p className="text-xs text-amber-800">Solver warnings: {g.warnings.join(" · ")}</p>
      ) : null}
    </>
  );
}

function NoSolutionPanel({ response }: { response: NoSolutionResponse }) {
  return (
    <>
      <section
        aria-label="No verified solution"
        className="rounded-md border-2 border-red-700 bg-red-50 p-6"
        data-testid="no-verified-solution"
      >
        <p className="text-xs font-semibold tracking-[0.2em] text-red-800">ACREVIA SOLVER RESULT</p>
        <h2 className="mt-2 text-4xl font-bold tracking-tight text-red-900">NO VERIFIED SOLUTION</h2>
        <p className="mt-3 text-sm text-red-900">
          {n(response.targetHomes)} homes cannot be built on this parcel within the law and the
          church&apos;s confirmed mission rules. Acrevia will not soften the math or invent a
          &ldquo;best effort&rdquo; scenario. The modeled upper bound is{" "}
          <strong>{n(response.modeledUpperBoundHomes)} homes</strong> — a target above an
          optimistic bound cannot fit under the same hard inputs, which is why this refusal is safe.
        </p>
        <h3 className="mt-4 text-xs font-semibold tracking-[0.14em] text-red-900">
          WHAT CLOSES THE DOOR — MECHANICALLY PROVEN
        </h3>
        <ul className="mt-2 space-y-2">
          {response.binding.map((proof) => (
            <li key={proof.constraintKey} className="rounded border border-red-200 bg-white p-3">
              <p className="text-sm font-medium text-stone-900">
                {proof.humanLabel}
                {proof.missionLocked ? (
                  <span className="ml-2 rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    MISSION-LOCKED — never proposed for removal
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-stone-700">
                Limit {n(proof.currentLimit)} → relaxed to {n(proof.relaxedLimit)} in a re-solve
                with the same shared model unlocks{" "}
                <strong>+{n(proof.capacityDeltaHomes)} homes</strong> ({n(proof.capacityBefore)} →{" "}
                {n(proof.capacityAfter)}).
              </p>
              <p className="mt-1 text-xs text-stone-600">{proof.explanation}</p>
            </li>
          ))}
        </ul>
        {response.counterfactuals.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {response.counterfactuals.map((text) => (
              <li key={text} className="text-xs text-stone-700">
                — {text}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section aria-label="Nearest alternatives" className="rounded-md border border-stone-300 bg-white p-4">
        <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
          NEAREST SUPPORTED ALTERNATIVES BENEATH THE GOAL
        </h3>
        <ul className="mt-3 space-y-2">
          {response.nearestAlternatives.map((alt, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-stone-900">
                {alt.homes} homes · {alt.parkingStalls} stalls (margin +{alt.parkingMargin})
              </span>
              <span className="text-xs text-stone-500">
                {alt.floors} floors · {n(alt.footprintSqFt)} sq ft footprint
              </span>
            </li>
          ))}
        </ul>
      </section>
      <CeilingsBand ceilings={response.ceilings} />
    </>
  );
}

function AssumptionsPanel({ assumptions }: { assumptions: SolvedResponse["assumptions"] }) {
  if (assumptions.length === 0) return null;
  return (
    <section aria-label="Assumptions" className="rounded-md border border-stone-300 bg-white p-4">
      <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
        ASSUMPTIONS — EVERY CERTIFICATE PINS THESE
      </h3>
      <ul className="mt-3 space-y-2">
        {assumptions.map((assumption) => (
          <li key={assumption.id} className="border-b border-stone-100 pb-2 last:border-b-0 last:pb-0">
            <p className="text-sm font-medium text-stone-800">
              {assumption.statement ?? assumption.id}
              {assumption.value ? <span className="ml-2 text-stone-500">({assumption.value})</span> : null}
            </p>
            {assumption.rationale ? (
              <p className="text-xs text-stone-500">{assumption.rationale}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-500">
        Change an assumption and the modeled bound changes — that sensitivity is a feature, not an
        error.
      </p>
    </section>
  );
}

function ConstraintLine({ row, tag }: { row: SolverResultRow; tag: string }) {
  const chip = STATUS_CHIP[row.status] ?? STATUS_CHIP.UNKNOWN;
  const range =
    row.actual !== null && row.limit !== null
      ? `${n(row.actual)}${row.actualUnit ? ` ${row.actualUnit}` : ""} against a limit of ${n(row.limit)}${row.limitUnit ? ` ${row.limitUnit}` : ""}`
      : null;
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-stone-600">
        {tag}
      </span>
      <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${chip.className}`}>
        {chip.label}
      </span>
      <span className="text-stone-700">
        <strong className="font-medium">{row.label}</strong>
        {range ? ` — ${range}. ` : " — "}
        {row.explanation}
      </span>
    </li>
  );
}
