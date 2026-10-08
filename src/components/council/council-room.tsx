"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Users, AlertTriangle } from "lucide-react";
import type { MissionCommand } from "../../application/mission/rebuild";
import {
  readMissionLogFor,
  readStoredAcceptedPair,
} from "../../lib/accepted-property";
import type {
  AudienceView,
  CouncilAudience,
  CouncilPackage,
} from "../../application/council/package";
import { COUNCIL_AUDIENCES } from "../../application/council/package";
import type { OwnershipPathway } from "../../application/capital/schema";
import type { SpatialSceneModel } from "../../spatial/scene-model";
import { buildPlanSvg } from "./plan-svg";
import { buildCouncilDeckHtml, councilDeckFilename } from "./deck";

/**
 * COUNCIL (issue #13) — the stakeholder decision room.
 *
 * One surface over ONE trusted package: POST /api/council/package assembles
 * the current verified project state (same pipeline as Proof/Capital) and
 * projects it for five audiences. Switching audiences NEVER refetches — the
 * package ships all five views over one fact table, so the room can visibly
 * prove "same project, different audience, same truth". The one-click export
 * writes a self-contained 16:9 deck from the same package bytes the room is
 * rendering (plus the Forge scene's plan + saved views).
 *
 * Layout: TOP property + scenario + CURRENT · MAIN narrative + conceptual
 * spatial frame · RIGHT audience switch + shared facts · MIDDLE mission +
 * capital · BOTTOM assumptions/conflicts/expert queue + next decision.
 */

type CouncilResponse =
  | { status: "ASSEMBLED"; package: CouncilPackage }
  | {
      status: "stale-scenario" | "stale-certificate";
      reason: string;
      scenarios: CouncilPackage["scenarios"];
    }
  | {
      status:
        "needs-evidence" | "unsupported-district" | "multi-parcel-unsupported";
      reason?: string;
    }
  | { error: string; name?: string };

type ForgeSceneResponse =
  | { status: "SOLVED" | "NO_VERIFIED_SOLUTION"; scene: SpatialSceneModel }
  | { status: "REFUSED"; reason: string; message: string }
  | { error: string; name?: string };

const PATHWAYS: Array<{ id: OwnershipPathway; label: string }> = [
  { id: "church-led", label: "Church-led" },
  { id: "ground-lease", label: "Ground lease" },
  { id: "joint-development", label: "Joint development" },
];

export function CouncilRoom() {
  const [audience, setAudience] = useState<CouncilAudience>("pastoral");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [pathway, setPathway] = useState<OwnershipPathway>("church-led");
  const [pkg, setPkg] = useState<CouncilPackage | null>(null);
  const [stale, setStale] = useState<{
    reason: string;
    scenarios: CouncilPackage["scenarios"];
  } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scene, setScene] = useState<SpatialSceneModel | null>(null);
  const [exported, setExported] = useState(false);
  const inFlight = useRef(0);

  const run = useCallback(
    async (
      options: { scenarioId?: string | null; pathway?: OwnershipPathway } = {},
    ) => {
      const pair = readStoredAcceptedPair();
      if (!pair) return;
      const useScenarioId =
        "scenarioId" in options ? options.scenarioId : scenarioId;
      const usePathway = options.pathway ?? pathway;
      const commands = readMissionLogFor<MissionCommand>(pair);
      const seq = ++inFlight.current;
      setBusy(true);
      try {
        const response = await fetch("/api/council/package", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands,
            pathway: usePathway,
            ...(useScenarioId ? { scenarioId: useScenarioId } : {}),
          }),
        });
        const payload = (await response.json()) as CouncilResponse;
        if (seq !== inFlight.current) return;
        if ("error" in payload) {
          setError(payload.error);
          setPkg(null);
          setStale(null);
        } else if (payload.status === "ASSEMBLED") {
          setPkg(payload.package);
          setScenarioId(payload.package.selected.scenarioId);
          setStale(null);
          setError(null);
          setBlocked(null);
        } else if (
          payload.status === "stale-scenario" ||
          payload.status === "stale-certificate"
        ) {
          setStale({ reason: payload.reason, scenarios: payload.scenarios });
          setPkg(null);
        } else {
          setBlocked(payload.reason ?? payload.status);
          setPkg(null);
        }
      } catch {
        if (seq === inFlight.current) {
          setError("The council package could not be assembled.");
        }
      } finally {
        if (seq === inFlight.current) setBusy(false);
      }
    },
    [pathway, scenarioId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void run(), 0);
    return () => clearTimeout(timer);
    // Recomputed only via user actions after mount, like the Capital surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Forge scene (plan + saved views) comes from its own trusted route;
  // it does not change with scenario selection — every scenario is in it.
  useEffect(() => {
    let cancelled = false;
    const pair = readStoredAcceptedPair();
    if (!pair) return;
    const commands = readMissionLogFor<MissionCommand>(pair);
    void (async () => {
      try {
        const response = await fetch("/api/forge/scene", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            envelope: pair.envelope,
            receipt: pair.receipt,
            commands,
          }),
        });
        const payload = (await response.json()) as ForgeSceneResponse;
        if (cancelled) return;
        if ("scene" in payload && payload.scene) setScene(payload.scene);
      } catch {
        // The plan frame is supplementary; the package stands without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function exportDeck() {
    if (!pkg) return;
    const html = buildCouncilDeckHtml(pkg, scene, audience);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = councilDeckFilename(pkg, audience);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setExported(true);
    setTimeout(() => setExported(false), 4000);
  }

  if (error) {
    return (
      <div className="p-6" data-testid="council-room">
        <div
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <strong>Council package failed.</strong> {error}
        </div>
      </div>
    );
  }
  if (blocked) {
    return (
      <div className="p-6" data-testid="council-room">
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          <strong>No decision package yet.</strong> {blocked}
        </div>
      </div>
    );
  }
  if (stale) {
    return (
      <div className="p-6" data-testid="council-room">
        <div
          className="rounded-md border-2 border-red-700 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
          data-testid="council-stale"
        >
          <p className="font-semibold">
            This decision package can no longer be presented.
          </p>
          <p className="mt-1">{stale.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {stale.scenarios.map((scenario) => (
              <button
                key={scenario.scenarioId}
                type="button"
                data-testid={`council-scenario-chip-${scenario.scenarioId}`}
                className="rounded border border-red-700 bg-white px-2 py-1 text-xs font-semibold text-red-900 hover:bg-red-100"
                onClick={() => {
                  setStale(null);
                  setScenarioId(scenario.scenarioId);
                  void run({ scenarioId: scenario.scenarioId });
                }}
              >
                Present {scenario.label} ({scenario.homes} homes) instead
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!pkg) {
    return (
      <div className="p-6 text-sm text-stone-500" data-testid="council-room">
        {busy
          ? "Assembling the decision package…"
          : "Preparing the council room…"}
      </div>
    );
  }

  const view: AudienceView = pkg.audienceViews[audience];
  const plan = scene ? buildPlanSvg(scene, pkg.selected.scenarioId) : null;
  const audit = view.detail === "audit";
  const plain = view.detail === "plain";
  const fact = (key: string) => pkg.facts[key]?.value ?? "—";

  return (
    <div className="p-5 pb-10" data-testid="council-room">
      {/* TOP — property, selected scenario, CURRENT status, export */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-4"
        data-testid="council-top"
      >
        <div>
          <span className="eyebrow">Stakeholder decision room</span>
          <h2
            className="mt-1 text-2xl font-semibold text-stone-900"
            style={{ fontFamily: "var(--font-editorial)" }}
          >
            {pkg.project.matchedAddress}
          </h2>
          <p className="mt-1 font-mono text-[11px] text-stone-500">
            {pkg.project.projectId} · {pkg.project.district}
            {pkg.project.overlay ? ` · ${pkg.project.overlay}` : ""} ·{" "}
            {pkg.project.parcelNodeId}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {pkg.scenarios.map((scenario) => (
              <button
                key={scenario.scenarioId}
                type="button"
                data-testid={`council-scenario-chip-${scenario.scenarioId}`}
                className={`rounded border px-2 py-1 text-xs font-semibold ${
                  scenario.scenarioId === pkg.selected.scenarioId
                    ? "border-olive-700 bg-olive-700 text-white"
                    : "border-stone-300 bg-white text-stone-700 hover:border-olive-600"
                }`}
                onClick={() => {
                  setScenarioId(scenario.scenarioId);
                  void run({ scenarioId: scenario.scenarioId });
                }}
              >
                {scenario.label} · {scenario.homes} homes
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {PATHWAYS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`council-pathway-${option.id}`}
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                  pathway === option.id
                    ? "border-stone-800 bg-stone-800 text-white"
                    : "border-stone-300 bg-white text-stone-600 hover:border-stone-500"
                }`}
                onClick={() => {
                  setPathway(option.id);
                  void run({ pathway: option.id });
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              data-testid="council-export"
              onClick={exportDeck}
              className="ml-2 inline-flex items-center gap-1.5 rounded border border-olive-700 bg-olive-700 px-3 py-1 text-xs font-semibold text-white hover:bg-olive-800"
            >
              <Download size={13} aria-hidden="true" />
              {exported ? "Exported — council-ready" : "Export 16:9 package"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_23rem]">
        {/* MAIN — the narrative + the conceptual spatial frame */}
        <div>
          <section data-testid="council-narrative" aria-live="polite">
            <span className="eyebrow">{view.label}</span>
            <h3
              className="mt-2 text-3xl font-semibold leading-tight text-stone-900"
              style={{ fontFamily: "var(--font-editorial)" }}
              data-testid="council-narrative-headline"
            >
              {view.headline}
            </h3>
            <p className="mt-1 text-xs text-stone-500">{view.essence}</p>
            <div className="mt-3 max-w-3xl space-y-2 text-sm leading-relaxed text-stone-700">
              {view.lead.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
            <div
              className="mt-4 border-l-4 border-olive-700 bg-olive-50 px-4 py-3 text-sm font-semibold text-olive-900"
              data-testid="council-cta"
            >
              {view.cta}
            </div>
          </section>

          <section className="mt-6" data-testid="council-spatial">
            <div className="flex items-baseline justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Conceptual spatial basis
              </h4>
              <span className="font-mono text-[10px] text-stone-400">
                CONCEPTUAL · NOT ARCHITECTURAL DESIGN
              </span>
            </div>
            <div
              className="mt-2 rounded-md border border-stone-300 bg-white p-3"
              data-testid="council-plan"
            >
              {plan ? (
                <div
                  className="council-plan-frame [&>svg]:h-auto [&>svg]:w-full"
                  // Server-derived geometry and labels only — no user free text.
                  dangerouslySetInnerHTML={{ __html: plan }}
                />
              ) : (
                <p className="p-4 text-sm text-stone-500">
                  The spatial scene is not available for this state. Every
                  number in this package stands on its own — the site plan does
                  not.
                </p>
              )}
            </div>
            {scene && (
              <div
                className="mt-2 flex flex-wrap gap-2"
                data-testid="council-saved-views"
              >
                {scene.cameras.map((camera) => (
                  <span
                    key={camera.id}
                    title={camera.note}
                    className="rounded border border-stone-300 bg-white px-2 py-1 font-mono text-[10px] text-stone-600"
                  >
                    SAVED VIEW · {camera.label}
                  </span>
                ))}
                <span className="px-2 py-1 font-mono text-[10px] text-stone-400">
                  FROM FORGE · SAME CONSTRAINTS
                </span>
              </div>
            )}
          </section>

          {/* MIDDLE — mission, shared facts, capital */}
          <section className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div data-testid="council-mission">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Mission commitments ({pkg.mission.commitments.length})
              </h4>
              <ul className="mt-2 divide-y divide-stone-100">
                {pkg.mission.commitments.length === 0 && (
                  <li className="py-2 text-sm text-stone-500">
                    None confirmed — scenarios are computed without
                    congregational priorities.
                  </li>
                )}
                {pkg.mission.commitments.map((commitment) => (
                  <li key={commitment.id} className="py-2">
                    <p className="text-sm font-semibold text-stone-800">
                      {commitment.normalizedSummary}
                    </p>
                    <p className="text-xs text-stone-500">
                      “{commitment.intentText}” · {commitment.hardOrSoft}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div data-testid="council-capital">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Preliminary capital
              </h4>
              {pkg.capital ? (
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between border-b border-stone-100 py-1">
                    <span className="text-stone-500">Pathway</span>
                    <span className="font-semibold text-stone-800">
                      {pkg.capital.pathway.label}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-stone-100 py-1">
                    <span className="text-stone-500">
                      Total development cost
                    </span>
                    <span className="font-semibold text-stone-800">
                      {pkg.capital.totalDevelopmentCost}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-stone-100 py-1">
                    <span className="text-stone-500">Identified capital</span>
                    <span className="font-semibold text-stone-800">
                      {pkg.capital.identifiedCapital}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-stone-100 py-1">
                    <span className="text-stone-500">Funding gap</span>
                    <span
                      className={`font-semibold ${
                        pkg.capital.fundingGap === "$0"
                          ? "text-olive-800"
                          : "text-amber-700"
                      }`}
                    >
                      {pkg.capital.fundingGap} ({pkg.capital.gapPctOfCost}%)
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-stone-100 py-1">
                    <span className="text-stone-500">Affordable homes</span>
                    <span className="font-semibold text-stone-800">
                      {fact("affordable-homes")}
                    </span>
                  </div>
                  <p className="pt-2 font-mono text-[10px] text-stone-400">
                    CAPITAL FINGERPRINT {pkg.capital.fingerprint.slice(0, 16)} ·{" "}
                    {pkg.capital.engineVersion}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-stone-500">
                  Not evaluated for this scenario. No cost or funding figures
                  should be quoted — run the Capital surface first.
                </p>
              )}
            </div>
          </section>

          {/* BOTTOM — evidence, assumptions, expert queue, next decision */}
          <section className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div data-testid="council-assumptions">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Assumptions ({pkg.evidence.assumptions.length}) — not law
              </h4>
              <ul className="mt-2 divide-y divide-stone-100">
                {(plain
                  ? pkg.evidence.assumptions.slice(0, 3)
                  : pkg.evidence.assumptions
                ).map((assumption, index) => (
                  <li key={index} className="py-2">
                    <p className="text-sm text-stone-800">
                      {assumption.statement} —{" "}
                      <span className="font-semibold">
                        {assumption.valueSummary}
                      </span>
                    </p>
                    {!plain && (
                      <p className="text-xs text-stone-500">
                        {assumption.rationale}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div data-testid="council-expert">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                {view.questionsTitle} ({pkg.evidence.expertReviews.length})
              </h4>
              <ul className="mt-2 divide-y divide-stone-100">
                {pkg.evidence.expertReviews.map((review, index) => (
                  <li key={index} className="py-2">
                    <p className="text-sm text-stone-800">{review.question}</p>
                    <p className="text-xs text-stone-500">
                      {review.category} · {review.severity} ·{" "}
                      {review.reviewStatus}
                    </p>
                  </li>
                ))}
                {pkg.evidence.computationQuestions.map((question, index) => (
                  <li key={`q-${index}`} className="py-2">
                    <p className="text-sm text-stone-800">{question.label}</p>
                    <p className="text-xs text-stone-500">
                      {question.status} — {question.explanation}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {(audit || pkg.evidence.conflicts.length > 0) && (
            <section className="mt-6" data-testid="council-conflicts">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Conflicts ({pkg.evidence.conflicts.length})
              </h4>
              <ul className="mt-2 divide-y divide-stone-100">
                {pkg.evidence.conflicts.map((conflict, index) => (
                  <li key={index} className="py-2">
                    <p className="text-sm text-stone-800">
                      {conflict.semanticRuleKey} — {conflict.resolution}
                    </p>
                    <p className="text-xs text-stone-500">
                      {conflict.explanation}
                    </p>
                  </li>
                ))}
                {pkg.evidence.conflicts.length === 0 && (
                  <li className="py-2 text-sm text-stone-500">
                    No unresolved conflicts among the captured sources.
                  </li>
                )}
              </ul>
            </section>
          )}

          <section
            className="mt-6 rounded-md border border-olive-700 bg-olive-50 p-4"
            data-testid="council-next-decision"
          >
            <span className="eyebrow text-olive-800">Next decision</span>
            <p
              className="mt-1 text-xl font-semibold text-stone-900"
              style={{ fontFamily: "var(--font-editorial)" }}
            >
              {pkg.nextDecision.headline}
            </p>
            <p className="mt-1 text-sm text-stone-600">
              {pkg.nextDecision.rationale}
            </p>
            {pkg.nextDecision.blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pkg.nextDecision.blockers.map((blocker, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-sm text-amber-900"
                  >
                    <AlertTriangle
                      size={14}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    {blocker}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(audit || !plain) && (
            <section className="mt-6" data-testid="council-sources">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                Sources ({pkg.evidence.sources.length})
              </h4>
              <table className="mt-2 w-full text-left text-xs">
                <tbody className="divide-y divide-stone-100">
                  {pkg.evidence.sources.map((source, index) => (
                    <tr key={index}>
                      <td className="py-1.5 pr-3 text-stone-800">
                        {source.title}
                      </td>
                      <td className="py-1.5 pr-3 text-stone-500">
                        {source.publisher}
                      </td>
                      <td className="py-1.5 text-right font-mono text-[10px] text-stone-400">
                        {source.authority} · {source.retrievedAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {audit && (
            <section
              className="mt-6 rounded-md border border-stone-300 bg-stone-50 p-4 font-mono text-[11px] leading-relaxed text-stone-600"
              data-testid="council-certificate"
            >
              <p>CERTIFICATE {pkg.certificate.id}</p>
              <p>
                HASH {pkg.certificate.certificateHash} · v
                {pkg.certificate.version} · {pkg.certificate.dependencyCount}{" "}
                PINNED DEPENDENCIES
              </p>
              <p>
                SOLVER {pkg.selected.solverVersion} · CONFIDENCE{" "}
                {pkg.selected.confidence} · SCENARIO {pkg.selected.scenarioId}
              </p>
              {pkg.certificate.freshnessReasons.length > 0 && (
                <p>FRESHNESS {pkg.certificate.freshnessReasons.join(" | ")}</p>
              )}
            </section>
          )}

          <p className="mt-6 border-t border-stone-200 pt-3 text-xs leading-relaxed text-stone-500">
            {pkg.boundaryNotice}
          </p>
        </div>

        {/* RIGHT — audience switcher + the SAME-TRUTH strip + emphasis */}
        <aside>
          <div
            className="rounded-md border border-stone-300 bg-white p-3"
            data-testid="council-audiences"
            role="radiogroup"
            aria-label="Audience"
          >
            <span className="eyebrow">Audience</span>
            <div className="mt-2 flex flex-col gap-1">
              {COUNCIL_AUDIENCES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={audience === id}
                  data-testid={`council-audience-${id}`}
                  className={`flex items-center justify-between rounded px-3 py-2 text-left text-xs font-semibold tracking-wide ${
                    audience === id
                      ? "bg-olive-700 text-white"
                      : "bg-white text-stone-700 hover:bg-stone-100"
                  }`}
                  onClick={() => setAudience(id)}
                >
                  {pkg.audienceViews[id].label}
                  <Users size={13} aria-hidden="true" className="opacity-60" />
                </button>
              ))}
            </div>
          </div>

          <div
            className="mt-4 rounded-md border border-stone-300 bg-stone-50 p-3"
            data-testid="council-same-truth"
          >
            <span className="eyebrow">Same truth, every audience</span>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-stone-600">
              FINGERPRINT {pkg.packageFingerprint.slice(0, 32)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">
              Switching audiences changes framing, emphasis, and depth — never a
              number. Every value below comes from the same certified scenario.
            </p>
            <p className="mt-2 flex items-center gap-2 font-mono text-[11px] font-semibold text-olive-800">
              <span className="inline-block h-2 w-2 rounded-full bg-olive-700" />
              CERTIFICATE {pkg.certificate.freshness}
            </p>
          </div>

          <div className="mt-4 rounded-md border border-stone-300 bg-white p-3">
            <span className="eyebrow">Emphasis for {view.label}</span>
            <ul className="mt-2 divide-y divide-stone-100">
              {view.emphasis.map((item) => (
                <li key={item.factKey} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-stone-500">
                      {pkg.facts[item.factKey]?.label ?? item.factKey}
                    </span>
                    <span
                      className="text-sm font-semibold text-stone-900"
                      data-testid={`council-fact-${item.factKey}`}
                    >
                      {fact(item.factKey)}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500">{item.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
