"use client";

/**
 * Forge application shell (issue #9).
 *
 * The client NEVER authors truth: it holds the accepted { envelope,
 * receipt } pair (server-signed), the mission command log (user intent,
 * replayed and re-validated server-side), and a scene fetched from
 * POST /api/forge/scene which reconstructs law ∩ mission → solver →
 * placement server-side. Mission edits go through /api/mission/state
 * FIRST (typed command boundary); only after the server accepts them does
 * Forge refetch the scene. Between the edit and the replacement scene the
 * old geometry is visibly STALE — RECOMPUTING, never silently current.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import nextDynamic from "next/dynamic";
import type { SpatialSceneModel } from "@/spatial/scene-model";
import type { Moment, Selection } from "@/components/forge/forge-shared";
import { MOMENTS } from "@/components/forge/forge-shared";
import { ForgeHud, type ForgeMissionView } from "@/components/forge/ForgeHud";
import { ForgeFallbackPlan } from "@/components/forge/ForgeFallbackPlan";
import type { MissionCommand } from "@/application/mission/rebuild";
import {
  readMissionLogFor,
  readStoredAcceptedPair,
  writeMissionLogFor,
} from "@/lib/accepted-property";
import styles from "@/components/forge/forge.module.css";

const ForgeCanvas = nextDynamic(() => import("@/components/forge/ForgeCanvas"), {
  ssr: false,
});

type SceneResponse =
  | {
      status: "SOLVED" | "NO_VERIFIED_SOLUTION";
      scene: SpatialSceneModel;
      fingerprint: string;
      mission: ForgeMissionView;
      targetHomes: number | null;
      buildMs: number;
    }
  | { status: "needs-evidence" | "unsupported-district" | "multi-parcel-unsupported"; reason: string }
  | { status: "REFUSED"; reason?: string; message?: string }
  | { error: string };

function probeWebgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function ForgeApp() {
  const [webglOk] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : probeWebgl(),
  );
  const [forceFallback] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("fallback") === "1",
  );
  const [result, setResult] = useState<SceneResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevCertificate, setPrevCertificate] = useState<string | null>(null);

  const [moment, setMoment] = useState<Moment>("existing");
  const [scenarioId, setScenarioId] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("scenario") ?? "")
      : "",
  );
  const [cameraId, setCameraId] = useState("camera:aerial");
  const [cameraNonce, setCameraNonce] = useState(0);
  const [cameraSettled, setCameraSettled] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rendered, setRendered] = useState(false);
  const [compare, setCompare] = useState(false);
  const [compareFraction, setCompareFraction] = useState(0.5);
  const [missionBusy, setMissionBusy] = useState(false);
  const [goal, setGoal] = useState<number | null>(null);
  const inFlight = useRef(0);

  const fetchScene = useCallback(async (targetHomes?: number | null) => {
    const pair = readStoredAcceptedPair();
    if (!pair) {
      setResult(null);
      return;
    }
    const commands = readMissionLogFor<MissionCommand>(pair);
    const seq = ++inFlight.current;
    setBusy(true);
    try {
      const response = await fetch("/api/forge/scene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: pair.envelope,
          receipt: pair.receipt,
          commands,
          ...(targetHomes !== undefined && targetHomes !== null ? { targetHomes } : {}),
        }),
      });
      const payload = (await response.json()) as SceneResponse;
      if (seq !== inFlight.current) return;
      if (!response.ok && "error" in payload) {
        setError(payload.error);
        setResult(null);
        setStale(false);
      } else if ("scene" in payload) {
        setError(null);
        setResult((current) => {
          const currentCert =
            current && "scene" in current
              ? current.scene.scenarios[0]?.certificateId ?? null
              : null;
          const nextCert = payload.scene.scenarios[0]?.certificateId ?? null;
          if (currentCert && nextCert && currentCert !== nextCert) {
            setPrevCertificate(currentCert);
          }
          return payload;
        });
        setStale(false);
      } else {
        setError(null);
        setResult(payload);
        setStale(false);
      }
    } catch {
      if (seq === inFlight.current) {
        setError("The Forge scene could not be derived. Nothing was rendered.");
        setStale(false);
      }
    } finally {
      if (seq === inFlight.current) setBusy(false);
    }
  }, []);

  // Mount: fetch the first scene (URL params and WebGL were read lazily).
  // Deferred one tick so the synchronous part of fetchScene() (setBusy)
  // never executes inside the effect body.
  useEffect(() => {
    const timer = setTimeout(() => void fetchScene(), 0);
    return () => clearTimeout(timer);
  }, [fetchScene]);

  const onMissionParking = useCallback(
    async (value: number) => {
      const pair = readStoredAcceptedPair();
      if (!pair) return;
      // STALE appears immediately: the displayed geometry is about to be
      // superseded by a re-solve.
      setStale(true);
      setMissionBusy(true);
      try {
        const commands = readMissionLogFor<MissionCommand>(pair);
        const next: MissionCommand[] = [
          ...commands,
          {
            kind: "confirm",
            input: {
              id: "mission:min-sunday-parking",
              kind: "mission-constraint",
              intentText: `Keep at least ${value} Sunday parking spaces.`,
              normalized: { type: "min-parking", spaces: { value, unit: "spaces" } },
              origin: { kind: "USER_DECLARED", actorId: "church-leader", declaredAt: new Date().toISOString() },
              confirmationState: "CONFIRMED",
              hardOrSoft: "hard",
            },
          },
        ];
        const response = await fetch("/api/mission/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope: pair.envelope, receipt: pair.receipt, commands: next }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          setError(payload.error ?? "the mission command was rejected by the typed boundary");
          setStale(false);
          return;
        }
        // The server accepted the typed command — only now is it log truth.
        writeMissionLogFor(pair, next);
        setError(null);
        await fetchScene(goal);
      } finally {
        setMissionBusy(false);
      }
    },
    [fetchScene, goal],
  );

  const onGoal = useCallback(
    (homes: number) => {
      setGoal(homes);
      setMoment("scenario");
      setStale(true);
      void fetchScene(homes).finally(() => setStale(false));
    },
    [fetchScene],
  );

  const onFrontier = useCallback(() => {
    setGoal(null);
    setStale(true);
    void fetchScene(null).finally(() => setStale(false));
  }, [fetchScene]);

  // Compare divider drag (pointer events, deterministic initial 0.5).
  const dividerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!compare) return;
    const onMove = (event: PointerEvent) => {
      const root = dividerRef.current?.parentElement;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const fraction = Math.min(0.92, Math.max(0.08, (event.clientX - rect.left) / rect.width));
      setCompareFraction(fraction);
    };
    const onDown = (event: PointerEvent) => {
      const el = dividerRef.current;
      if (!el) return;
      if (event.target === el || el.contains(event.target as Node)) {
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // capture is best-effort; window-level move still tracks
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [compare]);

  const pair = typeof window === "undefined" ? null : readStoredAcceptedPair();

  if (!pair && !result) {
    return (
      <main className={styles.app} data-testid="forge-empty">
        <div className={styles.empty}>
          <div className={styles.emptyCard}>
            <p className={styles.eyebrow}>Acrevia Forge · development twin</p>
            <h1>No accepted property in this session</h1>
            <p>
              Forge renders the accepted property&apos;s law and mission as a 3D development twin.
              Resolve a church address, accept the property, confirm the mission — then return
              here. Nothing is ever rendered from unaccepted input.
            </p>
            <Link className={styles.link} href="/">
              Enter a church address ↗
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.app}>
        <div className={styles.empty}>
          <div className={styles.emptyCard}>
            <p className={styles.eyebrow}>Forge could not derive this scene</p>
            <h1>Nothing was rendered</h1>
            <p>{error}</p>
            <button type="button" className={styles.link} onClick={() => void fetchScene(goal)}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!result) {
    return (
      <main className={styles.app} data-testid="forge-loading">
        <div className={styles.empty}>
          <div className={styles.emptyCard}>
            <p className={styles.eyebrow}>Acrevia Forge</p>
            <h1>Deriving the development twin…</h1>
            <p>
              Verifying the accepted property, replaying the mission command log, solving
              LAW ∩ MISSION, and placing the scenarios.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!("scene" in result)) {
    const blocked = result as { status?: string; reason?: string; message?: string };
    return (
      <main className={styles.app}>
        <div className={styles.empty}>
          <div className={styles.emptyCard}>
            <p className={styles.eyebrow}>Forge</p>
            <h1>
              {blocked.status === "REFUSED"
                ? "The solver refused to search"
                : "No verified law to execute"}
            </h1>
            <p>{blocked.reason ?? blocked.message}</p>
            <p style={{ fontSize: 11.5 }}>
              Acrevia never returns a partial or pretended scene. When it cannot compute within
              proven bounds, it says so.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const scene = result.scene;
  const useFallback = forceFallback || webglOk === false;
  // Derived selection: a stale id (fresh scene, changed ids) falls back to
  // the first scenario without an effect-driven setState.
  const scenarioIds = scene.scenarios.map((s) => s.scenarioId);
  const effectiveScenarioId = scenarioIds.includes(scenarioId)
    ? scenarioId
    : (scenarioIds[0] ?? "");

  return (
    <main
      className={styles.app}
      data-testid="forge-root"
      data-moment={moment}
      data-scenario={effectiveScenarioId}
      data-camera-active={cameraId}
      data-camera-settled={cameraSettled ? "1" : "0"}
      data-rendered={rendered || useFallback ? "1" : "0"}
      data-stale={stale ? "1" : "0"}
      data-fingerprint={result.fingerprint}
    >
      {useFallback ? (
        <ForgeFallbackPlan
          model={scene}
          moment={moment}
          onMoment={setMoment}
          scenarioId={effectiveScenarioId}
          onScenario={setScenarioId}
          compare={compare}
          stale={stale}
        />
      ) : (
        <div className={styles.canvas}>
          <ForgeCanvas
            model={scene}
            stale={stale}
            controller={{
              moment: compare ? "scenario" : moment,
              scenarioId: effectiveScenarioId,
              cameraId,
              cameraNonce,
              onCameraSettled: (id) => {
                setCameraSettled(true);
                setCameraId(id);
              },
              onUserInteract: () => {
                setCameraId((current) => (current === "free" ? current : "free"));
              },
              onSelect: setSelection,
              onFirstFrame: () => setRendered(true),
              compare: { enabled: compare, fraction: compareFraction },
            }}
          />
        </div>
      )}

      {compare && !useFallback && (
        <>
          <div
            ref={dividerRef}
            className={styles.compareDivider}
            style={{ left: `${compareFraction * 100}%` }}
            data-testid="forge-compare-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to reveal existing versus scenario"
          />
          <div className={styles.compareLabels}>
            <span className={styles.compareLabel}>EXISTING</span>
            <span className={styles.compareLabel}>
              {(scene.scenarios.find((s) => s.scenarioId === effectiveScenarioId)?.label ?? "SCENARIO").toUpperCase()}
            </span>
          </div>
        </>
      )}

      <ForgeHud
        model={scene}
        address={null}
        moment={moment}
        onMoment={(m) => {
          setMoment(m);
          if (m !== "scenario") setCompare(false);
        }}
        scenarioId={effectiveScenarioId}
        onScenario={setScenarioId}
        cameraId={cameraId}
        onCamera={(id) => {
          setCameraSettled(false);
          setCameraId(id);
          setCameraNonce((n) => n + 1);
        }}
        selection={selection}
        onClearSelection={() => setSelection(null)}
        stale={stale || busy}
        buildMs={result.buildMs}
        webgl={!useFallback}
        compare={compare}
        onCompare={setCompare}
        mission={result.mission}
        onMissionParking={onMissionParking}
        missionBusy={missionBusy}
        onGoal={onGoal}
        onFrontier={onFrontier}
        goalActive={goal !== null}
        planOnly={useFallback}
      />

      {prevCertificate && (
        <aside
          className={`${styles.panel} ${styles.identity}`}
          style={{ top: "auto", bottom: 148, right: 16, left: "auto", maxWidth: 320 }}
          data-testid="forge-superseded"
        >
          <p className={styles.eyebrow}>Recomputed</p>
          <p style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
            Previous certificate <code className={styles.mono}>{prevCertificate}</code> was
            superseded by the current solve. It remains inspectable in the graph&apos;s certificate
            history — &ldquo;true as of these exact inputs&rdquo;.
          </p>
        </aside>
      )}
    </main>
  );
}

// MOMENTS is re-exported for consumers that want the canonical order.
export { MOMENTS };
