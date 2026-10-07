"use client";

/**
 * Deterministic SVG plan fallback (issue #9). When WebGL cannot initialize,
 * the SAME SpatialSceneModel renders as a top-down plan — parcel, sanctuary,
 * envelopes, scenario massing, parking fields, statuses — including a
 * side-by-side before/after comparison. A renderer, not a data copy: the
 * accepted-property truth survives without GPU or network.
 */

import { useMemo } from "react";
import type { SpatialSceneModel } from "@/spatial/scene-model";
import { MOMENTS, type Moment } from "./forge-shared";
import styles from "./forge.module.css";

export function ForgeFallbackPlan({
  model,
  moment,
  onMoment,
  scenarioId,
  onScenario,
  compare,
  stale,
}: {
  model: SpatialSceneModel;
  moment: Moment;
  onMoment: (m: Moment) => void;
  scenarioId: string;
  onScenario: (id: string) => void;
  compare: boolean;
  stale: boolean;
}) {
  const scenarios = model.scenarios;
  const scenario = scenarios.find((s) => s.scenarioId === scenarioId) ?? scenarios[0];

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
    return { x0: minX - pad, y0: -(maxY + pad), w: w + pad * 2, h: h + pad * 2 };
  }, [model]);

  const toPath = (ring: { x: number; y: number }[]): string =>
    ring.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${(-p.y).toFixed(1)}`).join(" ") + " Z";

  const planFor = (m: Moment) => {
    const s = m === "scenario" ? scenario : undefined;
    return (
      <>
        <path d={toPath(model.parcel.polygon.exterior)} fill="#efecdf" stroke="#6a6a5c" strokeWidth={3} />
        {model.structures.map((st) => (
          <path
            key={st.id}
            d={toPath(st.polygon.exterior)}
            fill={st.protectedByMission ? "#e9e6d2" : "#e5e3d3"}
            stroke={st.protectedByMission ? "#45583b" : "#57544a"}
            strokeWidth={st.protectedByMission ? 3 : 2}
            strokeDasharray={st.protectedByMission ? "8 4" : undefined}
          />
        ))}
        {model.legalEnvelope && m !== "existing" && (
          <path
            d={model.legalEnvelope.polygons.map((p) => toPath(p.exterior)).join(" ")}
            fill="rgba(84,116,156,0.14)"
            stroke="#37587f"
            strokeWidth={2.5}
            strokeDasharray={m === "legal" ? undefined : "10 6"}
          />
        )}
        {model.missionEnvelope && (m === "mission" || m === "scenario") && (
          <path
            d={model.missionEnvelope.polygons.map((p) => toPath(p.exterior)).join(" ")}
            fill="rgba(90,112,72,0.2)"
            stroke="#2f4027"
            strokeWidth={2.5}
          />
        )}
        {m === "mission" &&
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
        {s && s.parking?.fields.map((field) => (
          <path
            key={field.id}
            d={toPath(field.polygon.exterior)}
            fill="#dcd7c4"
            stroke="#8a6420"
            strokeWidth={2}
            strokeDasharray="8 5"
          />
        ))}
        {s &&
          s.volumes.map((v) => (
            <path
              key={v.id}
              d={toPath(v.polygon.exterior)}
              fill={v.status === "VALID" ? "#f5f3e8" : "rgba(164,84,63,0.25)"}
              stroke={v.status === "VALID" ? "#3a3a30" : "#7c2f22"}
              strokeWidth={2.5}
              strokeDasharray={v.status === "VALID" ? undefined : "10 6"}
            />
          ))}
        {s && s.parking?.status !== "PLACED" && s.parking && (
          <text
            x={view.x0 + 16}
            y={view.y0 + view.h - 14}
            fontSize={13}
            fill="#8a6420"
            fontWeight={600}
          >
            {`${s.parking.obligation.label} — layout UNRESOLVED (${s.parking.obligation.areaSqFt.toLocaleString("en-US")} sq ft land)`}
          </text>
        )}
      </>
    );
  };

  return (
    <div className={`${styles.app} ${styles.appFallback}`} data-testid="forge-fallback" data-moment={moment}>
      <div className={styles.fallbackBar}>
        <strong>PLAN VIEW — DETERMINISTIC FALLBACK</strong>
        <span>WebGL unavailable; the same derived geometry renders without GPU or network.</span>
        {stale && <strong style={{ color: "#f3c1ae" }}>STALE — RECOMPUTING</strong>}
        <span className={styles.fallbackBar} style={{ gap: 4, background: "transparent", padding: 0 }}>
          {MOMENTS.map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`moment-${m}`}
              className={`${styles.moment} ${moment === m ? styles.momentActive : ""}`}
              style={{ color: moment === m ? "#fbfaf4" : "#d8d4c4" }}
              onClick={() => onMoment(m)}
            >
              {m}
            </button>
          ))}
        </span>
        {moment === "scenario" && !compare && (
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {scenarios.map((s) => (
              <button
                key={s.scenarioId}
                type="button"
                data-testid={`scenario-${s.scenarioId}`}
                className={`${styles.moment} ${scenarioId === s.scenarioId ? styles.momentActive : ""}`}
                style={{ color: scenarioId === s.scenarioId ? "#fbfaf4" : "#d8d4c4" }}
                onClick={() => onScenario(s.scenarioId)}
              >
                {s.label}
              </button>
            ))}
          </span>
        )}
      </div>
      {compare ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <svg
            viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`}
            className={styles.fallbackSvg}
            role="img"
            aria-label="Existing conditions plan"
          >
            <rect x={view.x0} y={view.y0} width={view.w} height={view.h} fill="#e9e7db" />
            {planFor("existing")}
            <text x={view.x0 + 16} y={view.y0 + 24} fontSize={15} fontWeight={700} fill="#55523f">
              EXISTING
            </text>
          </svg>
          <svg
            viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`}
            className={styles.fallbackSvg}
            role="img"
            aria-label="Selected scenario plan"
          >
            <rect x={view.x0} y={view.y0} width={view.w} height={view.h} fill="#e9e7db" />
            {planFor("scenario")}
            <text x={view.x0 + 16} y={view.y0 + 24} fontSize={15} fontWeight={700} fill="#55523f">
              {(scenario?.label ?? "SCENARIO").toUpperCase()}
            </text>
          </svg>
        </div>
      ) : (
        <svg
          viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`}
          className={styles.fallbackSvg}
          role="img"
          aria-label="Derived plan of the accepted church parcel"
        >
          <rect x={view.x0} y={view.y0} width={view.w} height={view.h} fill="#e9e7db" />
          {planFor(moment)}
        </svg>
      )}
      <div className={styles.fallbackNotes}>
        <strong>{model.title}</strong> — {model.subtitle}. Law-informed planning envelope (assumption-derived){" "}
        {model.legalEnvelope
          ? `${model.legalEnvelope.areaSqFt.toFixed(0)} sq ft × ${model.legalEnvelope.heightFt} ft`
          : "—"}
        ; mission{" "}
        {model.missionEnvelope
          ? `${model.missionEnvelope.areaSqFt.toFixed(0)} sq ft × ${model.missionEnvelope.heightFt} ft`
          : "—"}
        .
      </div>
    </div>
  );
}
