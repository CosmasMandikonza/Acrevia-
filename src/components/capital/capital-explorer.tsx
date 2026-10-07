"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionCommand } from "../../application/mission/rebuild";
import {
  readMissionLogFor,
  readStoredAcceptedPair,
} from "../../lib/accepted-property";
import {
  CAPITAL_ASSUMPTIONS,
  OWNERSHIP_PATHWAYS,
  PATHWAY_PRESETS,
  normalizeAssumptions,
  type CapitalNumericKey,
  type OwnershipPathway,
} from "../../application/capital/schema";

/**
 * CAPITAL (issue #12) — one surface over ONE deterministic engine.
 *
 * This component never authors truth: every cost, funding, operating, and
 * sensitivity number arrives from POST /api/capital/evaluate, which verifies
 * the accepted pair, rebuilds the trusted project, re-runs the deterministic
 * solver, and evaluates the CURRENT recorded scenario. Edits here are
 * assumption overrides sent to the same route — the server normalizes,
 * recomputes, and fingerprints them; the fingerprint changes iff the inputs
 * changed. Nothing is persisted.
 *
 * Layout: TOP scenario + certificate identity · MAIN cost stack vs identified
 * capital · RIGHT ownership pathway + editable PRELIMINARY assumptions ·
 * BOTTOM funding gap + sensitivity + EXPERT REQUIRED + Council projection.
 */

// ---------------------------------------------------------------------------
// Response types (mirrors /api/capital/evaluate)
// ---------------------------------------------------------------------------

type CostStack = {
  hardCost: number;
  softCost: number;
  siteInfrastructure: number;
  contingency: number;
  financingCarry: number;
  land: number;
  totalDevelopmentCost: number;
};

type OperatingSketch = {
  homes: number;
  affordableHomes: number;
  marketHomes: number;
  grossPotentialRevenue: number;
  effectiveGrossRevenue: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  noiPerHome: number;
  noiYieldOnCostPct: number;
};

type FundingPlan = {
  sources: Array<{ key: string; label: string; amount: number }>;
  identifiedCapital: number;
  fundingGap: number;
  gapPctOfCost: number;
};

type SensitivityRow = {
  variantId: string;
  label: string;
  change: string;
  totalDevelopmentCost: number;
  deltaTotalCost: number;
  fundingGap: number;
  deltaFundingGap: number;
  netOperatingIncome: number;
  deltaNetOperatingIncome: number;
};

type ExpertItem = { id: string; title: string; detail: string };

type EvaluatedResponse = {
  status: "EVALUATED";
  fingerprint: string;
  engineVersion: string;
  scenario: {
    scenarioId: string;
    certificateId: string;
    scenarioLabel: string;
    homes: number;
    floors: number;
    footprintSqFt: number;
    parkingStalls: number;
    grossResidentialSqFt: number;
    freshness: string;
    solverVersion: string;
  };
  pathway: {
    id: OwnershipPathway;
    label: string;
    tagline: string;
    ownershipNote: string;
  };
  assumptions: Record<string, number> & { opexMode: "pct" | "per-home" };
  cost: CostStack;
  operating: OperatingSketch;
  funding: FundingPlan;
  sensitivity: SensitivityRow[];
  expertRequired: ExpertItem[];
  councilProjection: string[];
  scenarios: Array<{
    scenarioId: string;
    certificateId: string;
    label: string;
    homes: number;
    freshness: string;
  }>;
};

type CapitalResponse =
  | EvaluatedResponse
  | {
      status: "stale-scenario" | "stale-certificate";
      reason: string;
      scenarios: EvaluatedResponse["scenarios"];
    }
  | {
      status:
        "needs-evidence" | "unsupported-district" | "multi-parcel-unsupported";
      reason?: string;
    }
  | { error: string; name?: string };

// ---------------------------------------------------------------------------
// Formatting + palette
// ---------------------------------------------------------------------------

const usd = (value: number): string =>
  `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;

const costLines = (cost: CostStack) => [
  {
    key: "hardCost",
    label: "Hard cost",
    amount: cost.hardCost,
    bar: "bg-olive-700",
  },
  {
    key: "softCost",
    label: "Soft cost",
    amount: cost.softCost,
    bar: "bg-olive-500",
  },
  {
    key: "contingency",
    label: "Contingency",
    amount: cost.contingency,
    bar: "bg-olive-300",
  },
  {
    key: "siteInfrastructure",
    label: "Site & infrastructure",
    amount: cost.siteInfrastructure,
    bar: "bg-stone-500",
  },
  {
    key: "financingCarry",
    label: "Financing carry",
    amount: cost.financingCarry,
    bar: "bg-stone-400",
  },
  { key: "land", label: "Land", amount: cost.land, bar: "bg-amber-600" },
];

const fundingColors: Record<string, string> = {
  churchContribution: "bg-olive-700",
  partnerContribution: "bg-olive-500",
  debtProceeds: "bg-stone-500",
  grantsSubsidy: "bg-amber-600",
  otherFunding: "bg-stone-400",
};

const n = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value.toLocaleString("en-US");

const signed = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${usd(value)}`;

export function CapitalExplorer() {
  const [pathway, setPathway] = useState<OwnershipPathway>("church-led");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<EvaluatedResponse | null>(null);
  const [stale, setStale] = useState<{
    reason: string;
    scenarios: EvaluatedResponse["scenarios"];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(0);

  const run = useCallback(
    async (
      options: {
        pathway?: OwnershipPathway;
        scenarioId?: string | null;
        drafts?: Record<string, string>;
      } = {},
    ) => {
      const pair = readStoredAcceptedPair();
      if (!pair) return;
      const usePathway = options.pathway ?? pathway;
      const useScenarioId =
        "scenarioId" in options ? options.scenarioId : scenarioId;
      const useDrafts = options.drafts ?? drafts;
      const commands = readMissionLogFor<MissionCommand>(pair);

      // Parse drafts into bounded numeric overrides; unparseable entries are
      // simply not sent (server-side normalization stays the only authority).
      const overrides: Record<string, number | string> = {};
      for (const spec of CAPITAL_ASSUMPTIONS) {
        const raw = useDrafts[spec.key];
        if (raw === undefined || raw.trim() === "") continue;
        const value = Number.parseFloat(raw);
        if (Number.isFinite(value)) overrides[spec.key] = value;
      }
      const mode = useDrafts.opexMode;
      if (mode === "pct" || mode === "per-home") overrides.opexMode = mode;

      const seq = ++inFlight.current;
      setBusy(true);
      try {
        const response = await fetch("/api/capital/evaluate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands,
            pathway: usePathway,
            ...(useScenarioId ? { scenarioId: useScenarioId } : {}),
            assumptions: overrides,
          }),
        });
        const payload = (await response.json()) as CapitalResponse;
        if (seq !== inFlight.current) return;
        if (!response.ok && "error" in payload) {
          setError(payload.error);
          setResult(null);
          setStale(null);
        } else if (
          "status" in payload &&
          (payload.status === "stale-scenario" ||
            payload.status === "stale-certificate")
        ) {
          setError(null);
          setResult(null);
          setStale({
            reason: payload.reason,
            scenarios: payload.scenarios ?? [],
          });
        } else if ("status" in payload && payload.status === "EVALUATED") {
          setError(null);
          setStale(null);
          setResult(payload);
          if (payload.scenario.scenarioId)
            setScenarioId(payload.scenario.scenarioId);
        } else if ("status" in payload) {
          setError(
            payload.reason ??
              `Capital is unavailable for this property (${payload.status}).`,
          );
          setResult(null);
          setStale(null);
        }
      } catch {
        if (seq === inFlight.current) {
          setError(
            "The capital engine could not be reached. Nothing was computed.",
          );
          setResult(null);
        }
      } finally {
        if (seq === inFlight.current) setBusy(false);
      }
    },
    [pathway, scenarioId, drafts],
  );

  useEffect(() => {
    const timer = setTimeout(() => void run(), 0);
    return () => clearTimeout(timer);
    // First evaluation only — explicit user actions drive every recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choosePathway(next: OwnershipPathway) {
    if (next === pathway) return;
    setPathway(next);
    setDrafts({}); // switching a pathway restores ITS preset assumptions
    void run({ pathway: next, drafts: {} });
  }

  function chooseScenario(next: string) {
    if (next === scenarioId) return;
    setScenarioId(next);
    void run({ scenarioId: next });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      </div>
    );
  }

  if (stale) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-4"
          data-testid="capital-stale"
        >
          <h2 className="text-sm font-semibold text-stone-900">
            This capital result is STALE
          </h2>
          <p className="mt-1 text-sm text-stone-800">{stale.reason}</p>
        </div>
        {stale.scenarios.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stale.scenarios.map((scenario) => (
              <button
                key={scenario.scenarioId}
                type="button"
                onClick={() => {
                  setStale(null);
                  chooseScenario(scenario.scenarioId);
                }}
                className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:border-olive-500"
              >
                {scenario.label} · {scenario.homes} homes
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-stone-500">
          {busy
            ? "Evaluating preliminary capital…"
            : "Preparing the capital engine…"}
        </p>
      </div>
    );
  }

  const preset = normalizeAssumptions(pathway);
  // Raw draft strings while editing; the server-normalized value otherwise.
  // Unparseable/empty drafts display as typed and are simply not sent.
  const display = (key: CapitalNumericKey): string => {
    const raw = drafts[key];
    if (raw !== undefined) return raw;
    const fromResult = result.assumptions[key];
    return String(typeof fromResult === "number" ? fromResult : preset[key]);
  };
  const hasEdits = Object.values(drafts).some(
    (raw) => raw !== undefined && raw.trim() !== "",
  );
  const activeOpexMode =
    drafts.opexMode === "pct" || drafts.opexMode === "per-home"
      ? drafts.opexMode
      : result.assumptions.opexMode;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      {/* TOP — scenario + certificate identity */}
      <section
        aria-label="Capital basis"
        className="rounded-md border border-stone-300 bg-white p-4"
        data-testid="capital-basis"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
              THE CURRENT SCENARIO DRIVES CAPITAL — NOTHING ELSE
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.scenarios.map((scenario) => (
                <button
                  key={scenario.scenarioId}
                  type="button"
                  onClick={() => chooseScenario(scenario.scenarioId)}
                  aria-pressed={
                    scenario.scenarioId === result.scenario.scenarioId
                  }
                  className={
                    scenario.scenarioId === result.scenario.scenarioId
                      ? "rounded border border-olive-600 bg-olive-50 px-3 py-1.5 text-xs font-semibold text-olive-900"
                      : "rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-olive-400"
                  }
                >
                  {scenario.label} · {scenario.homes} homes
                </button>
              ))}
            </div>
          </div>
          <div className="text-right">
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900"
              data-testid="capital-preliminary"
            >
              PRELIMINARY — NOT UNDERWRITING
            </span>
            <p
              className="mt-2 font-mono text-[11px] text-stone-600"
              data-testid="capital-fingerprint"
              title={result.fingerprint}
            >
              capital fp {result.fingerprint.slice(0, 16)}…
            </p>
            <p
              className="mt-1 font-mono text-[11px] text-stone-500"
              title={result.scenario.certificateId}
            >
              ScenarioCertificate {result.scenario.certificateId.slice(0, 24)}…
              ·{" "}
              <span className="font-semibold text-olive-800">
                {result.scenario.freshness}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-stone-500">
              {result.scenario.homes} homes · {n(result.scenario.footprintSqFt)}{" "}
              sq ft footprint × {result.scenario.floors} floors ={" "}
              {n(result.scenario.grossResidentialSqFt)} sq ft gross ·{" "}
              {result.scenario.solverVersion}
            </p>
          </div>
        </div>
      </section>

      {/* MAIN — cost stack vs identified capital + ownership/assumptions */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <section
          aria-label="Development cost versus identified capital"
          className="rounded-md border border-stone-300 bg-white p-4"
        >
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
            COST STACK VS IDENTIFIED CAPITAL
          </h3>
          <StackBar
            lines={costLines(result.cost)}
            total={result.cost.totalDevelopmentCost}
          />
          <ul className="mt-2 space-y-1">
            {costLines(result.cost).map((line) => (
              <li
                key={line.key}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-2 text-stone-700">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm ${line.bar}`}
                    aria-hidden="true"
                  />
                  {line.label}
                </span>
                <span className="font-medium text-stone-900">
                  {usd(line.amount)}
                </span>
              </li>
            ))}
            <li className="mt-1 flex items-baseline justify-between gap-2 border-t border-stone-200 pt-1 text-sm">
              <span className="font-semibold text-stone-900">
                Total development cost
              </span>
              <span
                className="font-semibold text-stone-900"
                data-testid="capital-total-cost"
              >
                {usd(result.cost.totalDevelopmentCost)}
              </span>
            </li>
          </ul>

          <h4 className="mt-4 text-xs font-semibold tracking-[0.14em] text-stone-500">
            IDENTIFIED CAPITAL
          </h4>
          <StackBar
            lines={result.funding.sources.map((source) => ({
              key: source.key,
              label: source.label,
              amount: source.amount,
              bar: fundingColors[source.key] ?? "bg-stone-400",
            }))}
            total={result.cost.totalDevelopmentCost}
          />
          <ul className="mt-2 space-y-1">
            {result.funding.sources.map((source) => (
              <li
                key={source.key}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-2 text-stone-700">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm ${fundingColors[source.key] ?? "bg-stone-400"}`}
                    aria-hidden="true"
                  />
                  {source.label}
                </span>
                <span className="font-medium text-stone-900">
                  {usd(source.amount)}
                </span>
              </li>
            ))}
            <li className="mt-1 flex items-baseline justify-between gap-2 border-t border-stone-200 pt-1 text-sm">
              <span className="font-semibold text-stone-900">
                Identified capital
              </span>
              <span className="font-semibold text-stone-900">
                {usd(result.funding.identifiedCapital)}
              </span>
            </li>
          </ul>
        </section>

        {/* RIGHT — ownership pathway + editable assumptions */}
        <section
          aria-label="Ownership and assumptions"
          className="rounded-md border border-stone-300 bg-white p-4"
        >
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
            OWNERSHIP PATHWAY
          </h3>
          <div
            className="mt-2 grid grid-cols-3 gap-1"
            role="group"
            aria-label="Ownership pathway"
          >
            {OWNERSHIP_PATHWAYS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => choosePathway(id)}
                aria-pressed={id === pathway}
                data-testid={`pathway-${id}`}
                className={
                  id === pathway
                    ? "rounded border border-olive-600 bg-olive-50 px-2 py-1.5 text-[11px] font-semibold text-olive-900"
                    : "rounded border border-stone-300 bg-white px-2 py-1.5 text-[11px] font-medium text-stone-700 hover:border-olive-400"
                }
              >
                {PATHWAY_PRESETS[id].label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-700">
            {PATHWAY_PRESETS[pathway].ownershipNote}
          </p>
          <p className="mt-1 text-[11px] text-stone-500">
            Switching a pathway restores its preset assumptions — one engine,
            different explicit starting points.
          </p>

          <h4 className="mt-4 text-xs font-semibold tracking-[0.14em] text-stone-500">
            ASSUMPTIONS — EDITABLE, PRELIMINARY
          </h4>
          <div className="mt-2 grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
            {CAPITAL_ASSUMPTIONS.filter((spec) =>
              spec.key === "operatingExpensePct"
                ? activeOpexMode === "pct"
                : spec.key === "annualOperatingExpensePerHome"
                  ? activeOpexMode === "per-home"
                  : true,
            ).map((spec) => (
              <label
                key={spec.key}
                className="block text-xs"
                title={spec.rationale}
              >
                <span className="text-stone-700">
                  {spec.label}{" "}
                  <span className="text-stone-400">({spec.unit})</span>
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  aria-label={spec.label}
                  data-testid={`assumption-${spec.key}`}
                  value={display(spec.key)}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [spec.key]: event.target.value,
                    }))
                  }
                  className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm text-stone-900"
                />
              </label>
            ))}
          </div>
          <fieldset className="mt-2 text-xs">
            <legend className="text-stone-700">Operating expense basis</legend>
            <div className="mt-1 flex gap-3">
              {(["pct", "per-home"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-1 text-stone-700"
                >
                  <input
                    type="radio"
                    name="opex-mode"
                    checked={activeOpexMode === mode}
                    onChange={() =>
                      setDrafts((current) => ({ ...current, opexMode: mode }))
                    }
                  />
                  {mode === "pct"
                    ? "% of effective revenue"
                    : "USD per home per year"}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="rounded bg-olive-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              data-testid="capital-recalculate"
            >
              {busy ? "Recomputing…" : "Recalculate (deterministic)"}
            </button>
            {hasEdits ? (
              <span className="text-[11px] text-amber-800">
                Unapplied edits — recalculate to re-derive every number.
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setDrafts({});
                void run({ drafts: {} });
              }}
              className="text-xs text-stone-500 underline"
            >
              Reset to preset
            </button>
          </div>
        </section>
      </div>

      {/* OPERATING SKETCH */}
      <section
        aria-label="Preliminary operating sketch"
        className="rounded-md border border-stone-300 bg-white p-4"
      >
        <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
          PRELIMINARY OPERATING SKETCH — STABILIZED YEAR
        </h3>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Homes (affordable / market)"
            value={`${result.operating.homes} (${result.operating.affordableHomes} / ${result.operating.marketHomes})`}
          />
          <Fact
            label="Gross potential revenue"
            value={usd(result.operating.grossPotentialRevenue)}
          />
          <Fact
            label="Effective revenue (at occupancy)"
            value={usd(result.operating.effectiveGrossRevenue)}
          />
          <Fact
            label="Operating expenses"
            value={usd(result.operating.operatingExpenses)}
          />
          <Fact
            label="Net operating income"
            value={usd(result.operating.netOperatingIncome)}
          />
          <Fact label="NOI per home" value={usd(result.operating.noiPerHome)} />
          <Fact
            label="NOI yield on cost"
            value={`${result.operating.noiYieldOnCostPct}%`}
          />
          <Fact
            label="Affordability basis"
            value={`${result.assumptions.affordabilityTargetPct}% of homes at ${result.assumptions.affordableRevenueFactor}× market rent`}
          />
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          Affordability here is a target knob, not a program claim: raising the
          target lowers blended revenue unless the affordable revenue factor
          changes. Income bands and obligations are policy work.
        </p>
      </section>

      {/* BOTTOM — gap + sensitivity + expert + council */}
      <section
        aria-label="Funding gap"
        className={`rounded-md border p-4 ${result.funding.fundingGap > 0 ? "border-red-300 bg-red-50" : "border-olive-300 bg-olive-50"}`}
        data-testid="capital-gap"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-600">
            {result.funding.fundingGap > 0
              ? "FUNDING GAP — NO IDENTIFIED SOURCE"
              : "FUNDING POSITION"}
          </h3>
          <p className="text-2xl font-semibold text-stone-900">
            {result.funding.fundingGap > 0
              ? `${usd(result.funding.fundingGap)} short`
              : result.funding.fundingGap < 0
                ? `${usd(result.funding.fundingGap)} surplus`
                : "exactly balanced"}
          </p>
        </div>
        <p className="mt-1 text-xs text-stone-700">
          {usd(result.cost.totalDevelopmentCost)} preliminary cost −{" "}
          {usd(result.funding.identifiedCapital)} identified
          {result.funding.fundingGap > 0
            ? ` · ${result.funding.gapPctOfCost}% of cost`
            : ""}{" "}
          · every source is an unattributed assumption until professionally
          sourced.
        </p>
      </section>

      <section
        aria-label="Sensitivity"
        className="rounded-md border border-stone-300 bg-white p-4"
        data-testid="capital-sensitivity"
      >
        <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
          SENSITIVITY — ONE ASSUMPTION MOVED AT A TIME, SAME ENGINE
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-1 pr-3 font-medium">Variant</th>
                <th className="py-1 pr-3 font-medium">Change</th>
                <th className="py-1 pr-3 text-right font-medium">Total cost</th>
                <th className="py-1 pr-3 text-right font-medium">Δ cost</th>
                <th className="py-1 pr-3 text-right font-medium">
                  Funding gap
                </th>
                <th className="py-1 pr-3 text-right font-medium">Δ gap</th>
                <th className="py-1 pr-3 text-right font-medium">NOI</th>
                <th className="py-1 text-right font-medium">Δ NOI</th>
              </tr>
            </thead>
            <tbody>
              {result.sensitivity.map((row) => (
                <tr
                  key={row.variantId}
                  className="border-b border-stone-100 last:border-b-0"
                >
                  <td className="py-1 pr-3 font-medium text-stone-900">
                    {row.label}
                  </td>
                  <td className="py-1 pr-3 text-stone-500">{row.change}</td>
                  <td className="py-1 pr-3 text-right text-stone-900">
                    {usd(row.totalDevelopmentCost)}
                  </td>
                  <td
                    className={`py-1 pr-3 text-right ${row.deltaTotalCost !== 0 ? "text-red-800" : "text-stone-400"}`}
                  >
                    {row.variantId === "base"
                      ? "—"
                      : signed(row.deltaTotalCost)}
                  </td>
                  <td className="py-1 pr-3 text-right text-stone-900">
                    {usd(row.fundingGap)}
                  </td>
                  <td
                    className={`py-1 pr-3 text-right ${row.deltaFundingGap !== 0 ? "text-red-800" : "text-stone-400"}`}
                  >
                    {row.variantId === "base"
                      ? "—"
                      : signed(row.deltaFundingGap)}
                  </td>
                  <td className="py-1 pr-3 text-right text-stone-900">
                    {usd(row.netOperatingIncome)}
                  </td>
                  <td
                    className={`py-1 text-right ${row.deltaNetOperatingIncome !== 0 ? "text-red-800" : "text-stone-400"}`}
                  >
                    {row.variantId === "base"
                      ? "—"
                      : signed(row.deltaNetOperatingIncome)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          Deterministic comparisons, not simulations: each row re-evaluates the
          identical engine with exactly one assumption moved. No distributions,
          no Monte Carlo.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Expert required"
          className="rounded-md border border-amber-300 bg-amber-50 p-4"
          data-testid="capital-expert-required"
        >
          <h3 className="text-xs font-semibold tracking-[0.14em] text-amber-900">
            EXPERT REQUIRED
          </h3>
          <ul className="mt-2 space-y-2">
            {result.expertRequired.map((item) => (
              <li
                key={item.id}
                className="rounded border border-amber-200 bg-white p-2.5"
              >
                <p className="text-xs font-semibold text-stone-900">
                  {item.title}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-700">
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Council projection"
          className="rounded-md border border-stone-300 bg-white p-4"
          data-testid="capital-council"
        >
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">
            FOR COUNCIL — READS FROM THE SAME NUMBERS
          </h3>
          <ul className="mt-2 space-y-2">
            {result.councilProjection.map((sentence, index) => (
              <li
                key={index}
                className="text-xs leading-relaxed text-stone-800"
              >
                {sentence}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-stone-500">
            Council materials re-derive from the same deterministic fingerprint
            — when the scenario or an assumption changes, this projection
            changes with it. Nothing here is advice.
          </p>
        </section>
      </div>

      <p className="text-center text-[11px] text-stone-500">
        {result.engineVersion} · stateless: every figure above was recomputed
        this request from the verified accepted pair · assumptions are the only
        inputs Acrevia does not verify — that boundary is the product.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-2 border-b border-stone-100 py-1">
      <span className="text-stone-500">{label}</span>
      <span className="font-medium text-stone-900">{value}</span>
    </p>
  );
}

/** Pure CSS proportional bar: each line's width is its share of `total`. */
function StackBar({
  lines,
  total,
}: {
  lines: Array<{ key: string; label: string; amount: number; bar: string }>;
  total: number;
}) {
  const base = Math.max(
    total,
    lines.reduce((sum, line) => sum + line.amount, 0),
    1,
  );
  return (
    <div
      className="mt-2 flex h-4 w-full overflow-hidden rounded-sm border border-stone-200 bg-stone-100"
      role="img"
      aria-label="proportional stack"
    >
      {lines.map((line) =>
        line.amount > 0 ? (
          <div
            key={line.key}
            className={line.bar}
            style={{ width: `${Math.max((line.amount / base) * 100, 0.75)}%` }}
            title={`${line.label}: ${usd(line.amount)}`}
          />
        ) : null,
      )}
    </div>
  );
}
