"use client";

/**
 * Forge spike HUD — DOM overlays around a full-bleed canvas. The spatial
 * model stays the hero: chrome is limited to identity, moment/camera
 * controls, a per-moment legend, the derivation drawer, and a selection
 * card. Solid paper panels, design-token colors, no glassmorphism.
 */

import { useEffect, useState } from "react";
import type { SpatialSceneModel } from "../scene-model";
import { MOMENTS, type Moment, type Selection } from "./ForgeSpikeView";

const MOMENT_LABELS: Record<Moment, string> = {
  existing: "Existing",
  legal: "Legal",
  mission: "Mission",
  scenario: "Scenario",
};

interface HudProps {
  model: SpatialSceneModel;
  moment: Moment;
  setMoment: (m: Moment) => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  cameraId: string;
  setCameraId: (id: string) => void;
  selection: Selection | null;
  clearSelection: () => void;
  webgl: boolean;
  buildMs?: number;
}

export function ForgeHud({
  model,
  moment,
  setMoment,
  scenarioId,
  setScenarioId,
  cameraId,
  setCameraId,
  selection,
  clearSelection,
  webgl,
  buildMs,
}: HudProps) {
  const [showDerivation, setShowDerivation] = useState(false);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (!webgl) return;
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
  }, [webgl]);

  return (
    <>
      {/* Identity */}
      <header className="forge-hud forge-hud-top-left">
        <p className="forge-eyebrow">Acrevia Forge · spatial spike</p>
        <h1 className="forge-title">{model.title}</h1>
        <p className="forge-subtitle">{model.subtitle}</p>
        <p className="forge-disclaimer">
          Preliminary massing — not architectural design. Scenarios are
          HYPOTHETICAL SPIKE FIXTURES (synthetic test inputs — not canonical
          mission state, not pitch evidence).
        </p>
      </header>

      {/* Instrumentation */}
      <div className="forge-hud forge-hud-top-right">
        <div className="forge-chip-row">
          {fps !== null && (
            <span className="forge-chip forge-chip-quiet" data-testid="forge-fps">
              {fps} fps
            </span>
          )}
          {buildMs !== undefined && (
            <span className="forge-chip forge-chip-quiet" data-testid="forge-build-ms">
              scene {buildMs} ms
            </span>
          )}
          <button
            type="button"
            className="forge-chip forge-chip-button"
            aria-expanded={showDerivation}
            onClick={() => setShowDerivation((v) => !v)}
          >
            Derivation
          </button>
        </div>
      </div>

      {/* Derivation drawer */}
      {showDerivation && (
        <aside className="forge-hud forge-derivation" data-testid="forge-derivation">
          <h2>How this scene was derived</h2>
          <ol>
            {model.derivationNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ol>
          <p className="forge-derivation-frame">
            Frame: local feet, origin at parcel centroid ({model.frame.origin.lat.toFixed(6)},{" "}
            {model.frame.origin.lon.toFixed(6)}). Every volume recomputes from Development Graph state.
          </p>
        </aside>
      )}

      {/* Legend */}
      <div className="forge-hud forge-legend">
        <Legend moment={moment} model={model} />
      </div>

      {/* Moments */}
      <nav
        className="forge-hud forge-moments"
        aria-label="Scene moments"
        data-testid="forge-moments"
      >
        {MOMENTS.map((m, i) => (
          <button
            key={m}
            type="button"
            className={`forge-moment ${moment === m ? "is-active" : ""}`}
            data-testid={`moment-${m}`}
            aria-pressed={moment === m}
            onClick={() => setMoment(m)}
          >
            <span className="forge-moment-key">{i + 1}</span>
            {MOMENT_LABELS[m]}
          </button>
        ))}
      </nav>

      {/* Scenario picker (scenario moment only) */}
      {moment === "scenario" && (
        <div className="forge-hud forge-scenarios" data-testid="forge-scenarios" role="radiogroup" aria-label="Scenario">
          {model.scenarios.map((s) => {
            const refused = s.status !== "COMPUTED";
            return (
              <button
                key={s.scenarioId}
                type="button"
                role="radio"
                aria-checked={scenarioId === s.scenarioId}
                data-testid={`scenario-${s.scenarioId}`}
                className={`forge-scenario ${scenarioId === s.scenarioId ? "is-active" : ""} ${
                  refused ? "is-refused" : ""
                }`}
                onClick={() => setScenarioId(s.scenarioId)}
              >
                <span className="forge-scenario-dot" aria-hidden="true" />
                <span className="forge-scenario-text">
                  <span className="forge-scenario-label">{s.label}</span>
                  <span className="forge-scenario-status">
                    {s.status === "COMPUTED"
                      ? s.metrics
                          .filter((m) => m.value)
                          .slice(0, 3)
                          .map((m) => `${m.value}`)
                          .join(" · ")
                      : `REFUSED — not buildable`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Cameras */}
      <nav className="forge-hud forge-cameras" aria-label="Saved views" data-testid="forge-cameras">
        {model.cameras.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`forge-camera ${cameraId === c.id ? "is-active" : ""}`}
            data-testid={`camera-${c.id}`}
            aria-pressed={cameraId === c.id}
            title={c.note}
            onClick={() => setCameraId(c.id)}
          >
            {c.label}
          </button>
        ))}
        <span className="forge-camera-hint">drag to orbit · scroll to zoom</span>
      </nav>

      {/* Selection card */}
      {selection && (
        <aside className="forge-hud forge-selection" data-testid="forge-selection">
          <button type="button" className="forge-selection-close" onClick={clearSelection} aria-label="Close">
            ×
          </button>
          <h2>{selection.title}</h2>
          {selection.status && (
            <p
              className={`forge-status ${
                selection.status.includes("NOT BUILDABLE")
                  ? "forge-status-conflict"
                  : selection.status.includes("REMOVED") || selection.status.includes("RESERVED")
                    ? "forge-status-caution"
                    : selection.status.includes("PROTECTED")
                      ? "forge-status-mission"
                      : ""
              }`}
            >
              {selection.status}
            </p>
          )}
          <p>{selection.detail}</p>
          {selection.provenance.length > 0 && (
            <ul className="forge-provenance">
              {selection.provenance.map((p, i) => (
                <li key={i}>
                  <span className="forge-provenance-kind">{p.nodeKind}</span>{" "}
                  <code>{p.nodeId}</code>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  );
}

function Legend({ moment, model }: { moment: Moment; model: SpatialSceneModel }) {
  const items: { color: string; label: string; dashed?: boolean; hollow?: boolean }[] =
    moment === "existing"
      ? [
          { color: "var(--color-wall)", label: "Existing structure" },
          { color: "#6a6a5c", label: "Parcel boundary" },
        ]
      : moment === "legal"
        ? [
            { color: "#54749c", label: "Planning envelope (assumption-derived)" },
            { color: "#54749c", label: `Height max ${model.heightPlaneFt ?? "—"} ft (sourced law)`, hollow: true },
            { color: "var(--color-wall)", label: "Existing structure" },
          ]
        : moment === "mission"
          ? [
              { color: "#5a7048", label: "Mission planning envelope" },
              { color: "#c99a4a", label: "Removed by mission", dashed: true },
              { color: "#45583b", label: "Protected sanctuary", dashed: true },
              ...(model.parking ? [{ color: "#8a6420", label: "Parking reservation" }] : []),
            ]
          : [
              { color: "#f5f3e8", label: "Fixture mass (hypothetical)" },
              { color: "#a4543f", label: "Refused mass (not buildable)", dashed: true },
              { color: "#5a7048", label: "Mission planning envelope", hollow: true },
              ...(model.parking ? [{ color: "#8a6420", label: "Parking reservation" }] : []),
            ];
  return (
    <ul className="forge-legend-list" data-testid="forge-legend">
      {items.map((item, i) => (
        <li key={i}>
          <span
            className="forge-swatch"
            aria-hidden="true"
            style={{
              background: item.hollow ? "transparent" : item.color,
              border: item.dashed
                ? `1.5px dashed ${item.color}`
                : `1.5px solid ${item.hollow ? item.color : "transparent"}`,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
