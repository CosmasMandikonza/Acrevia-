"use client";

/**
 * Deterministic SVG plan fallback (ADR 0008 stage requirement).
 *
 * When WebGL cannot initialize (venue browser, locked-down laptop), the
 * SAME SpatialSceneModel renders as a top-down plan: parcel, sanctuary,
 * envelopes, parking, scenario masses, statuses. This is a renderer, not a
 * data copy — the canonical demo truth survives without GPU or network.
 */

import { useMemo } from "react";
import type { Moment } from "./ForgeSpikeView";
import type { SpatialSceneModel } from "../scene-model";

interface FallbackProps {
  model: SpatialSceneModel;
  moment: Moment;
  setMoment: (m: Moment) => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
}

export function ForgeSpikeFallback({ model, moment, setMoment, scenarioId, setScenarioId }: FallbackProps) {
  const view = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of model.parcel.polygon.exterior) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const pad = Math.max(w, h) * 0.08 + 20;
    // Paths render with plan y negated (SVG y grows south), so the viewBox
    // lives in the flipped frame.
    return { x0: minX - pad, y0: -(maxY + pad), w: w + pad * 2, h: h + pad * 2 };
  }, [model]);

  const toPath = (ring: { x: number; y: number }[]): string =>
    ring.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${(-p.y).toFixed(1)}`).join(" ") + " Z";

  const scenarios = model.scenarios;
  const scenario = scenarios.find((s) => s.scenarioId === scenarioId) ?? scenarios[0];

  return (
    <div className="forge-spike-root forge-fallback" data-testid="forge-fallback" data-moment={moment}>
      <div className="forge-fallback-bar">
        <strong>Plan view (deterministic fallback)</strong> — WebGL unavailable; the same derived
        geometry renders without GPU or network.
        <span className="forge-fallback-moments">
          {(["existing", "legal", "mission", "scenario"] as Moment[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`moment-${m}`}
              className={`forge-moment ${moment === m ? "is-active" : ""}`}
              onClick={() => setMoment(m)}
            >
              {m}
            </button>
          ))}
        </span>
        {moment === "scenario" && (
          <span className="forge-fallback-moments">
            {scenarios.map((s) => (
              <button
                key={s.scenarioId}
                type="button"
                data-testid={`scenario-${s.scenarioId}`}
                className={`forge-moment ${scenarioId === s.scenarioId ? "is-active" : ""}`}
                onClick={() => setScenarioId(s.scenarioId)}
              >
                {s.label}
              </button>
            ))}
          </span>
        )}
      </div>
      <svg
        viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`}
        className="forge-fallback-svg"
        role="img"
        aria-label="Derived plan of the Calvary Memorial Church parcel"
      >
        <rect x={view.x0} y={view.y0} width={view.w} height={view.h} fill="#e9e7db" />
        {model.parcel.polygon && (
          <path d={toPath(model.parcel.polygon.exterior)} fill="#efecdf" stroke="#6a6a5c" strokeWidth={3} />
        )}
        {model.structures.map((st) => (
          <path key={st.id} d={toPath(st.polygon.exterior)} fill="#e5e3d3" stroke="#57544a" strokeWidth={2} />
        ))}
        {model.legalEnvelope && moment !== "existing" && (
          <path
            d={model.legalEnvelope.polygons.map((p) => toPath(p.exterior)).join(" ")}
            fill="rgba(84,116,156,0.14)"
            stroke="#37587f"
            strokeWidth={2.5}
            strokeDasharray={moment === "legal" ? undefined : "10 6"}
          />
        )}
        {model.missionEnvelope && (moment === "mission" || moment === "scenario") && (
          <path
            d={model.missionEnvelope.polygons.map((p) => toPath(p.exterior)).join(" ")}
            fill="rgba(90,112,72,0.2)"
            stroke="#2f4027"
            strokeWidth={2.5}
          />
        )}
        {model.parking && (moment === "mission" || moment === "scenario") && (
          <path
            d={toPath(model.parking.polygon.exterior)}
            fill="#dcd7c4"
            stroke="#8a6420"
            strokeWidth={2}
            strokeDasharray="8 5"
          />
        )}
        {moment === "mission" &&
          model.missionEnvelope?.clips.map((clip) => (
            <path
              key={clip.id}
              d={toPath(clip.polygon.exterior)}
              fill="rgba(201,154,74,0.22)"
              stroke="#8a6420"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          ))}
        {moment === "scenario" &&
          scenario?.volumes.map((v) => (
            <path
              key={v.id}
              d={toPath(v.polygon.exterior)}
              fill={v.status === "VALID" ? "#f5f3e8" : "rgba(164,84,63,0.25)"}
              stroke={v.status === "VALID" ? "#3a3a30" : "#7c2f22"}
              strokeWidth={2.5}
              strokeDasharray={v.status === "VALID" ? undefined : "10 6"}
            />
          ))}
      </svg>
      <div className="forge-fallback-notes">
        <strong>{model.title}</strong> — {model.subtitle}. Planning envelope (assumption-derived){" "}
        {model.legalEnvelope ? `${model.legalEnvelope.areaSqFt.toFixed(0)} sq ft × ${model.legalEnvelope.heightFt} ft` : "—"};
        mission{" "}
        {model.missionEnvelope
          ? `${model.missionEnvelope.areaSqFt.toFixed(0)} sq ft × ${model.missionEnvelope.heightFt} ft`
          : "—"}
        .
      </div>
    </div>
  );
}
