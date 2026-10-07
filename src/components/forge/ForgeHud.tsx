"use client";

/**
 * Forge HUD (issue #9) — thin paper chrome around a full-bleed canvas.
 * Identity + certificate status, moments, scenario cards with honest
 * placement statuses, saved cameras, selection card with the Proof
 * deep-link contract, mission panel (typed command flow), derivation
 * drawer, and the STALE — RECOMPUTING banner. Every consequential string
 * arrives from the SpatialSceneModel or the route response; the HUD never
 * invents a number.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SpatialSceneModel } from "@/spatial/scene-model";
import { MOMENTS, type Moment, type Selection } from "./forge-shared";
import styles from "./forge.module.css";

const MOMENT_LABELS: Record<Moment, string> = {
  existing: "Existing",
  legal: "Legal",
  mission: "Mission",
  scenario: "Scenario",
};

export interface ForgeMissionView {
  constraints: Array<{ id: string; type: string; detail: string }>;
  minParking: number | null;
}

export function buildProofHref(args: {
  focus: string;
  scenario?: string | null;
  certificate?: string | null;
  address?: string;
}): string {
  const params = new URLSearchParams();
  params.set("view", "evidence");
  params.set("focus", args.focus);
  if (args.scenario) params.set("scenario", args.scenario);
  if (args.certificate) params.set("certificate", args.certificate);
  if (args.address) params.set("address", args.address);
  return `/workspace?${params.toString()}`;
}

interface HudProps {
  model: SpatialSceneModel;
  address: string | null;
  moment: Moment;
  onMoment: (m: Moment) => void;
  scenarioId: string;
  onScenario: (id: string) => void;
  cameraId: string;
  onCamera: (id: string) => void;
  selection: Selection | null;
  onClearSelection: () => void;
  stale: boolean;
  buildMs?: number;
  webgl: boolean;
  compare: boolean;
  onCompare: (on: boolean) => void;
  mission: ForgeMissionView | null;
  onMissionParking: (value: number) => Promise<void>;
  missionBusy: boolean;
  onGoal: (homes: number) => void;
  onFrontier: () => void;
  goalActive: boolean;
  /** Plan-fallback mode: 3D-only controls (moments/cameras/goal) are not rendered. */
  planOnly?: boolean;
}

export function ForgeHud(props: HudProps) {
  const { model } = props;
  const [showDerivation, setShowDerivation] = useState(false);
  const [goalText, setGoalText] = useState("");
  const goalInputRef = useRef<HTMLInputElement | null>(null);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!props.webgl || props.planOnly) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.webgl, props.planOnly]);

  const selected =
    model.scenarios.find((s) => s.scenarioId === props.scenarioId) ?? model.scenarios[0];

  return (
    <>
      {/* Identity */}
      <header className={`${styles.panel} ${styles.identity}`} data-testid="forge-identity">
        <p className={styles.eyebrow}>Acrevia Forge · development twin</p>
        <h1 className={styles.title}>{model.title}</h1>
        <p className={styles.subtitle}>{model.subtitle}</p>
        {selected?.certificateId ? (
          <p className={styles.certificateLine} data-testid="forge-certificate">
            ScenarioCertificate <span className={styles.mono}>{selected.certificateId}</span> ·{" "}
            <span
              className={
                selected.freshness === "CURRENT" ? styles.freshCurrent : styles.freshStale
              }
            >
              {selected.freshness ?? "UNKNOWN"}
            </span>
            {" · "}
            <Link
              href={buildProofHref({
                focus: selected.certificateId,
                scenario: selected.scenarioId,
                certificate: selected.certificateId,
                address: props.address ?? undefined,
              })}
              data-testid="certificate-inspect-link"
              className={styles.link}
            >
              Inspect proof ↗
            </Link>
          </p>
        ) : null}
        {model.modeled ? (
          <p className={styles.certificateLine}>
            Modeled upper bound{" "}
            <strong>{model.modeled.upperBoundHomes} homes</strong> · {model.modeled.solverVersion}
          </p>
        ) : null}
        <p className={styles.disclaimer}>
          Preliminary conceptual massing — not architectural design. Placement geometry is
          ASSUMPTION_DERIVED; the envelope polygon is a planning assumption, not verified legal
          compliance.
        </p>
      </header>

      {/* Instrumentation */}
      <div className={`${styles.panel} ${styles.instrumentation}`}>
        {fps !== null && (
          <span className={styles.chip} data-testid="forge-fps">
            {fps} fps
          </span>
        )}
        {props.buildMs !== undefined && (
          <span className={styles.chip} data-testid="forge-build-ms">
            scene {props.buildMs} ms
          </span>
        )}
        {(props.moment === "scenario" || props.compare) && (
          <button
            type="button"
            className={styles.chipButton}
            data-testid="forge-compare-toggle"
            aria-pressed={props.compare}
            onClick={() => props.onCompare(!props.compare)}
          >
            {props.compare ? "Exit before / after" : "Before / after"}
          </button>
        )}
        <button
          type="button"
          className={styles.chipButton}
          aria-expanded={showDerivation}
          onClick={() => setShowDerivation((v) => !v)}
        >
          Derivation
        </button>
      </div>

      {/* Stale banner */}
      {props.stale && (
        <div className={styles.staleBanner} data-testid="forge-stale-banner" role="status">
          <span className={styles.pulse} aria-hidden="true" />
          <strong>STALE — RECOMPUTING</strong>
          <span>
            Mission state changed. Law ∩ Mission is being re-solved; this geometry is no longer
            current.
          </span>
        </div>
      )}

      {/* Derivation drawer */}
      {showDerivation && (
        <aside className={`${styles.panel} ${styles.derivation}`} data-testid="forge-derivation">
          <h2>How this scene was derived</h2>
          <ol>
            {model.derivationNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ol>
          <p className={styles.derivationFrame}>
            Frame: local feet, origin at parcel centroid ({model.frame.origin.lat.toFixed(6)},{" "}
            {model.frame.origin.lon.toFixed(6)}). Every volume recomputes from accepted property →
            law → mission → solver state. {model.modeled?.note}
          </p>
        </aside>
      )}

      {/* Legend */}
      <div className={`${styles.panel} ${styles.legend}`}>
        <Legend moment={props.moment} model={model} hasParking={Boolean(selected?.parking?.fields.length)} />
      </div>

      {/* Mission panel */}
      {props.mission && props.mission.constraints.length > 0 && (
        <MissionPanel mission={props.mission} onParking={props.onMissionParking} busy={props.missionBusy} />
      )}

      {/* Moments + compare */}
      {!props.planOnly && (
      <nav
        className={`${styles.panel} ${styles.moments}`}
        aria-label="Scene moments"
        data-testid="forge-moments"
      >
        {MOMENTS.map((m, i) => (
          <button
            key={m}
            type="button"
            className={`${styles.moment} ${props.moment === m ? styles.momentActive : ""}`}
            data-testid={`moment-${m}`}
            aria-pressed={props.moment === m}
            onClick={() => props.onMoment(m)}
          >
            <span className={styles.momentKey}>{i + 1}</span>
            {MOMENT_LABELS[m]}
          </button>
        ))}
      </nav>
      )}

      {/* Test a housing goal — same deterministic solver, honest refusal */}
      {props.moment === "scenario" && !props.planOnly && (
        <div
          className={`${styles.panel} ${styles.mission}`}
          style={{ bottom: 336, width: 248 }}
          data-testid="forge-goal"
        >
          <div className={styles.missionBody} style={{ borderTop: "none", paddingTop: 10 }}>
            <label htmlFor="forge-goal-input" className={styles.eyebrow}>
              TEST A HOUSING GOAL
            </label>
            <div className={styles.missionEditRow}>
              <input
                id="forge-goal-input"
                ref={goalInputRef}
                className={styles.missionInput}
                inputMode="numeric"
                defaultValue=""
                onChange={(event) => setGoalText(event.target.value)}
              />
              <span style={{ fontSize: 11.5, color: "#55523f" }}>homes</span>
              <button
                type="button"
                className={styles.chipButton}
                disabled={props.stale}
                onClick={() => {
                  const parsed = Number(goalText);
                  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return;
                  props.onGoal(parsed);
                }}
              >
                Prove it
              </button>
            </div>
            {props.goalActive && (
              <button
                type="button"
                className={styles.chipButton}
                style={{ marginTop: 8 }}
                onClick={props.onFrontier}
              >
                Back to the frontier
              </button>
            )}
          </div>
        </div>
      )}

      {/* Scenario picker */}
      {props.moment === "scenario" && !props.compare && !props.planOnly && (
        <div
          className={`${styles.panel} ${styles.scenarios}`}
          data-testid="forge-scenarios"
          role="radiogroup"
          aria-label="Scenario"
        >
          {model.scenarios.map((s) => {
            const refused = s.status !== "COMPUTED";
            const placementClass =
              s.placement?.status === "PLACED"
                ? styles.scenarioPlaced
                : s.placement?.status === "PARTIAL"
                  ? styles.scenarioPartial
                  : styles.scenarioUnresolved;
            return (
              <button
                key={s.scenarioId}
                type="button"
                role="radio"
                aria-checked={props.scenarioId === s.scenarioId}
                data-testid={`scenario-${s.scenarioId}`}
                className={`${styles.scenario} ${
                  props.scenarioId === s.scenarioId ? styles.scenarioActive : ""
                }`}
                onClick={() => props.onScenario(s.scenarioId)}
              >
                <span className={styles.scenarioLabel}>
                  {refused ? <span className={styles.scenarioRefused}>REFUSED</span> : null}
                  {s.label}
                </span>
                <span className={styles.scenarioMetrics}>
                  {s.point
                    ? `${s.point.homes} homes · ${s.point.floors} floors · ${s.point.parkingStalls} stalls`
                    : s.metrics.map((m) => m.value).filter(Boolean).join(" · ")}
                </span>
                <span className={`${styles.scenarioStatus} ${placementClass}`}>
                  {refused
                    ? "NO VERIFIED SOLUTION"
                    : s.placement?.status === "PLACED"
                      ? "SITE PLAN PLACED (assumption-derived)"
                      : s.placement?.status === "PARTIAL"
                        ? "PARTIAL — PARKING NOT PROVEN"
                        : "PLACEMENT NOT PROVEN"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Refusal panel (NO VERIFIED SOLUTION treatment) */}
      {selected && selected.status !== "COMPUTED" && props.moment === "scenario" && !props.planOnly && (
        <aside
          className={`${styles.panel} ${styles.selection}`}
          style={{ borderColor: "#a4543f", background: "#fdf1ec" }}
          data-testid="forge-refusal"
        >
          <h2 className={styles.title} style={{ fontSize: 15 }}>
            NO VERIFIED SOLUTION — {selected.point?.homes ?? model.refusal?.requestedTarget} homes
          </h2>
          <p className={styles.selectionStatus} style={{ color: "#7c2f22" }}>
            MODELED UPPER BOUND {model.refusal?.upperBoundHomes ?? model.modeled?.upperBoundHomes}{" "}
            HOMES
          </p>
          <p className={styles.selectionDetail}>{model.refusal?.explanation ?? selected.placement?.summary}</p>
          {model.refusal && model.refusal.binding.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 16 }}>
              {model.refusal.binding.map((b) => (
                <li key={b.label} style={{ fontSize: 11, lineHeight: 1.5, color: "#5a2c20" }}>
                  <strong>{b.label}</strong> — {b.detail}
                </li>
              ))}
            </ul>
          )}
          {model.refusal && model.refusal.nearestHomes.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#7c2f22" }}>Nearest supported:</span>
              {model.refusal.nearestHomes.map((homes) => (
                <button
                  key={homes}
                  type="button"
                  className={styles.chipButton}
                  onClick={() => props.onGoal(homes)}
                >
                  {homes} homes
                </button>
              ))}
            </div>
          )}
          {props.goalActive && (
            <button
              type="button"
              className={styles.chipButton}
              style={{ marginTop: 8 }}
              onClick={props.onFrontier}
            >
              Back to the frontier
            </button>
          )}
        </aside>
      )}

      {/* Cameras */}
      {!props.planOnly && (
      <nav className={`${styles.panel} ${styles.cameras}`} aria-label="Saved views" data-testid="forge-cameras">
        {model.cameras.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.camera} ${props.cameraId === c.id ? styles.cameraActive : ""}`}
            data-testid={`camera-${c.id.replace(/^camera:/, "")}`}
            aria-pressed={props.cameraId === c.id}
            title={c.note}
            onClick={() => props.onCamera(c.id)}
          >
            {c.label}
          </button>
        ))}
        <span className={styles.cameraHint}>drag to orbit · scroll to zoom</span>
      </nav>
      )}

      {/* Selection card */}
      {props.selection && (
        <aside className={`${styles.panel} ${styles.selection}`} data-testid="forge-selection">
          <button
            type="button"
            className={styles.selectionClose}
            onClick={props.onClearSelection}
            aria-label="Close"
          >
            ×
          </button>
          <h2>{props.selection.title}</h2>
          {props.selection.status && (
            <p
              className={styles.selectionStatus}
              style={{
                color: props.selection.status.includes("NOT BUILDABLE")
                  ? "#a4543f"
                  : props.selection.status.includes("REMOVED") ||
                      props.selection.status.includes("RESERVED") ||
                      props.selection.status.includes("PLANNING LAYOUT")
                    ? "#8a6420"
                    : props.selection.status.includes("PROTECTED")
                      ? "#3f5c2f"
                      : "#55523f",
              }}
            >
              {props.selection.status}
            </p>
          )}
          <p className={styles.selectionDetail}>{props.selection.detail}</p>
          {props.selection.provenance.length > 0 && (
            <ul className={styles.provenanceList}>
              {props.selection.provenance.map((p, i) => (
                <li key={i}>
                  <span className={styles.provenanceKind}>{p.nodeKind}</span>
                  <code className={styles.mono}>{p.nodeId}</code>
                </li>
              ))}
            </ul>
          )}
          <Link
            className={styles.inspectLink}
            data-testid="inspect-proof-link"
            href={buildProofHref({
              focus:
                props.selection.provenance[0]?.nodeId ??
                props.selection.id,
              scenario: selected?.scenarioId,
              certificate: selected?.certificateId,
              address: props.address ?? undefined,
            })}
          >
            Inspect proof ↗
          </Link>
        </aside>
      )}
    </>
  );
}

function Legend({
  moment,
  model,
  hasParking,
}: {
  moment: Moment;
  model: SpatialSceneModel;
  hasParking: boolean;
}) {
  const items: { color: string; label: string; dashed?: boolean; hollow?: boolean }[] =
    moment === "existing"
      ? [
          { color: "#e5e3d3", label: "Existing structure" },
          { color: "#6a6a5c", label: "Parcel boundary" },
        ]
      : moment === "legal"
        ? [
            { color: "#54749c", label: "Planning envelope (assumption-derived)" },
            { color: "#54749c", label: `Height max ${model.heightPlaneFt ?? "—"} ft (sourced law)`, hollow: true },
            { color: "#e5e3d3", label: "Existing structure" },
          ]
        : moment === "mission"
          ? [
              { color: "#5a7048", label: "Mission planning envelope" },
              { color: "#c99a4a", label: "Removed by mission", dashed: true },
              { color: "#45583b", label: "Protected sanctuary", dashed: true },
            ]
          : [
              { color: "#f5f3e8", label: "Scenario mass (assumption-derived)" },
              { color: "#a4543f", label: "Refused mass (not buildable)", dashed: true },
              { color: "#5a7048", label: "Mission planning envelope", hollow: true },
              ...(hasParking ? [{ color: "#8a6420", label: "Parking field (planning layout)" }] : []),
            ];
  return (
    <ul className={styles.legendList} data-testid="forge-legend">
      {items.map((item, i) => (
        <li key={i}>
          <span
            className={styles.swatch}
            aria-hidden="true"
            style={{
              background: item.hollow ? "transparent" : item.color,
              border: item.dashed
                ? `1.5px dashed ${item.color}`
                : `1.5px solid ${item.hollow ? item.color : "rgba(0,0,0,0.12)"}`,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function MissionPanel({
  mission,
  onParking,
  busy,
}: {
  mission: ForgeMissionView;
  onParking: (value: number) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = useMemo(() => mission.minParking ?? null, [mission.minParking]);

  return (
    <section className={`${styles.panel} ${styles.mission}`} data-testid="forge-mission" aria-label="Mission rules">
      <button
        type="button"
        className={styles.missionSummary}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Mission — {mission.constraints.length} confirmed rule
        {mission.constraints.length === 1 ? "" : "s"}
        {current !== null ? ` · Sunday parking ≥ ${current}` : ""}
      </button>
      {open && (
        <div className={styles.missionBody}>
          {mission.constraints.map((rule) => (
            <p key={rule.id} className={styles.missionRule}>
              {rule.detail}
            </p>
          ))}
          <div className={styles.missionEditRow}>
            <label htmlFor="forge-parking">
              Sunday parking — at least
            </label>
            {/* Uncontrolled + keyed by the confirmed value: a server-side
                change re-seeds the input without effect-driven setState. */}
            <input
              key={current ?? "none"}
              ref={inputRef}
              id="forge-parking"
              className={styles.missionInput}
              inputMode="numeric"
              defaultValue={current ?? 110}
              onChange={() => setError(null)}
            />
            <span style={{ fontSize: 11.5, color: "#55523f" }}>spaces</span>
            <button
              type="button"
              className={styles.missionConfirm}
              disabled={busy}
              data-testid="forge-parking-confirm"
              onClick={async () => {
                const raw = inputRef.current?.value ?? "";
                const parsed = Number(raw);
                if (raw.trim() === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
                  setError("Sunday parking must be a whole number of spaces, at least 1.");
                  return;
                }
                if (current !== null && parsed === current) {
                  setError("That is already the confirmed value.");
                  return;
                }
                setError(null);
                await onParking(parsed);
              }}
            >
              {busy ? "Confirming…" : "Confirm change"}
            </button>
          </div>
          {error && (
            <p className={styles.missionError} role="alert">
              {error}
            </p>
          )}
          <p className={styles.missionNote}>
            Editing a mission rule is a typed, confirmed command — the solver re-runs LAW ∩ MISSION,
            the certificate is re-issued, and the scene recomputes. Locked rules are never relaxed
            silently.
          </p>
        </div>
      )}
    </section>
  );
}
