"use client";

import { useCallback, useMemo, useState } from "react";
import { SiteMap } from "./site-map";
import type { ResolutionSession } from "../../application/resolution/state";

/**
 * Property resolution experience (issue #4): the canvas is the hero. The user
 * types an address; the site resolves progressively — address candidate →
 * parcel geometry → structures → jurisdiction/evidence — with ambiguity,
 * capture modes (LIVE/CACHED/FIXTURE), and confirmation flows visible and in
 * plain language. The provisional session lives in this component (client
 * state); only an explicit confirmation commits canonical graph truth.
 */

type Phase =
  | "idle"
  | "searching"
  | "candidates"
  | "parcel-candidates"
  | "awaiting-property"
  | "ready"
  | "committed"
  | "failed";

type ApiResult = { envelope: { session: ResolutionSession; signature: string }; rollup: string };

const MODE_LABEL: Record<string, string> = {
  LIVE: "Live",
  CACHED: "Cached",
  FIXTURE: "Fixture evidence",
};

export function SiteResolution({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [envelope, setEnvelope] = useState<ApiResult["envelope"] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedParcels, setSelectedParcels] = useState<Set<string>>(new Set());
  const [commitSummary, setCommitSummary] = useState<string | null>(null);

  const [sessionId] = useState(() => `session-${Date.now()}`);
  // Derived: current session from the server-signed envelope.
  const session = envelope?.session ?? null;

  const call = useCallback(
    async (body: Record<string, unknown>): Promise<ApiResult | null> => {
      setError(null);
      try {
        const response = await fetch("/api/gis/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "resolution failed");
          setPhase("failed");
          return null;
        }
        return payload as ApiResult;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "network error");
        setPhase("failed");
        return null;
      }
    },
    [],
  );

  const resolve = useCallback(async () => {
    if (!query.trim()) return;
    setPhase("searching");
    setCommitSummary(null);
    const result = await call({ action: "resolve", sessionId, query: query.trim() });
    if (!result) return;
    setEnvelope(result.envelope);
    const s = result.envelope.session;
    if (s.addressStage === "CONFIRMATION_REQUIRED") setPhase("candidates");
    else if (s.addressStage === "FAILED") setPhase("failed");
    else if (s.parcelStage === "CONFIRMATION_REQUIRED") setPhase("parcel-candidates");
    else if (s.parcelStage === "RESOLVED") {
      setPhase("awaiting-property");
      const primary = s.parcelCandidates[0];
      if (primary) {
        setSelectedParcels(new Set([primary.brtId ?? primary.parcelId]));
      }
    } else if (s.parcelStage === "PARCEL_NONE") setPhase("failed");
    else setPhase("candidates");
  }, [call, query, sessionId]);

  const selectCandidate = useCallback(
    async (index: number) => {
      if (!envelope) return;
      setPhase("searching");
      const result = await call({ action: "select", envelope, candidateIndex: index });
      if (!result) return;
      setEnvelope(result.envelope);
      const s = result.envelope.session;
      if (s.parcelStage === "CONFIRMATION_REQUIRED") setPhase("parcel-candidates");
      else if (s.parcelStage === "RESOLVED") {
        setPhase("awaiting-property");
        const primary = s.parcelCandidates[0];
        if (primary) setSelectedParcels(new Set([primary.brtId ?? primary.parcelId]));
      } else if (s.parcelStage === "PARCEL_NONE") setPhase("failed");
    },
    [call, envelope],
  );

  const confirmParcels = useCallback(async () => {
    if (!envelope || selectedParcels.size === 0) return;
    setPhase("searching");
    const result = await call({
      action: "confirm",
      envelope,
      parcelIds: [...selectedParcels],
    });
    if (!result) return;
    setEnvelope(result.envelope);
    setPhase("awaiting-property");
  }, [call, selectedParcels, envelope]);

  const acceptAndCommit = useCallback(async () => {
    if (!envelope) return;
    setPhase("searching");
    let currentEnvelope = envelope;
    // If parcels aren't user-confirmed yet, confirm the primary parcel first
    // (this also resolves per-parcel zoning/structures/context).
    if (!currentEnvelope.session.userConfirmedProperty) {
      const primary = currentEnvelope.session.parcelCandidates[0];
      if (!primary) {
        setError("No parcel to confirm");
        setPhase("failed");
        return;
      }
      const confirmed = await call({
        action: "confirm",
        envelope: currentEnvelope,
        parcelIds: [primary.brtId ?? primary.parcelId],
      });
      if (!confirmed) return;
      currentEnvelope = confirmed.envelope;
      setEnvelope(currentEnvelope);
    }
    // Now commit the confirmed session.
    try {
      const response = await fetch("/api/gis/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelope: currentEnvelope,
          projectId: `gis:${currentEnvelope.session.confirmedParcelIds[0]}`,
          propertyId: `gis:property:${currentEnvelope.session.confirmedParcelIds[0]}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "commit failed");
        setPhase("failed");
        return;
      }
      setCommitSummary(
        `Accepted as Development Graph project — ${payload.nodeCount} nodes, ${payload.eventCount} audited events, revision ${payload.revision}. Every fact traces to its source.`,
      );
      setPhase("committed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "commit failed");
      setPhase("failed");
    }
  }, [call, envelope]);

  const toggleParcel = useCallback((id: string) => {
    setSelectedParcels((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const mapLayers = useMemo(() => {
    if (!session) return {};
    const hint = session.selectedAddress ?? session.addressCandidates[0];
    return {
      hintPoint: hint ? { lon: hint.point[0], lat: hint.point[1] } : null,
      parcels: session.parcelCandidates.map((candidate) => ({
        id: candidate.brtId ?? candidate.parcelId,
        geometry: candidate.geometry,
        selected: selectedParcels.has(candidate.brtId ?? candidate.parcelId),
      })),
      structures: (session?.parcelContexts ?? []).flatMap((ctx) =>
        ctx.structures.map((structure) => ({
          id: structure.structureId,
          geometry: structure.footprint,
        })),
      ),
    };
  }, [selectedParcels, session]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Address input — the entry point; the canvas stays the hero below. */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void resolve();
        }}
      >
        <label htmlFor="site-address" className="text-xs font-semibold tracking-[0.14em] text-stone-600">
          CHURCH ADDRESS
        </label>
        <input
          id="site-address"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="7200 Roosevelt Blvd, Philadelphia, PA"
          className="min-w-64 flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-stone-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={phase === "searching" || !query.trim()}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-ivory disabled:opacity-40"
        >
          {phase === "searching" ? "Resolving…" : "Resolve property"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-md border border-rust-500 bg-rust-50 px-3 py-2 text-sm text-rust-900">
          {error}{" "}
          <button type="button" onClick={() => void resolve()} className="underline">
            Try again
          </button>
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* THE MAP */}
        <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-stone-300 bg-[#efece5]">
          <SiteMap layers={mapLayers} />
          {phase === "searching" ? (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-stone-900/85 px-4 py-1.5 text-xs font-medium text-ivory">
              Searching public records…
            </div>
          ) : null}
          {envelope?.session?.selectedAddress && phase !== "idle" ? (
            <div className="pointer-events-none absolute bottom-4 left-4 rounded-md bg-white/95 px-3 py-2 text-xs text-stone-800 shadow">
              <p className="font-medium">{envelope.session.selectedAddress.matchedAddress}</p>
              <p className="text-stone-500">
                Geocode hint — {envelope.session.selectedAddress.geocodeType}. Parcel from the city&apos;s
                official registry.
              </p>
            </div>
          ) : null}
        </div>

        {/* Resolution rail — status, candidates, evidence */}
        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1" aria-label="Resolution status and evidence">
          {phase === "idle" ? (
            <p className="text-sm text-stone-600">
              Enter a church address. Acrevia resolves the property against official public records —
              the address registry, the city parcel service, building footprints, and zoning layers —
              and shows exactly where every fact came from.
            </p>
          ) : null}

          {phase === "candidates" && session ? (
            <section className="rounded-md border border-amber-400 bg-amber-50 p-3">
              <h3 className="text-sm font-semibold text-amber-900">Which address is right?</h3>
              <ul className="mt-2 space-y-1">
                {session.addressCandidates.map((candidate, index) => (
                  <li key={`${candidate.matchedAddress}-${index}`}>
                    <button
                      type="button"
                      onClick={() => void selectCandidate(index)}
                      className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-left text-sm text-stone-800 hover:border-amber-500"
                    >
                      {candidate.matchedAddress}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {phase === "parcel-candidates" && session ? (
            <section className="rounded-md border border-amber-400 bg-amber-50 p-3">
              <h3 className="text-sm font-semibold text-amber-900">
                We found {session.parcelCandidates.length} nearby parcels — select yours
              </h3>
              <ul className="mt-2 space-y-1.5">
                {session.parcelCandidates.map((candidate) => {
                  const id = candidate.brtId ?? candidate.parcelId;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => toggleParcel(id)}
                        aria-pressed={selectedParcels.has(id)}
                        className={`w-full rounded border px-2 py-1.5 text-left text-sm ${
                          selectedParcels.has(id)
                            ? "border-olive-600 bg-olive-50 text-stone-900"
                            : "border-amber-300 bg-white text-stone-800"
                        }`}
                      >
                        <span className="font-medium">{candidate.address ?? id}</span>
                        <span className="block text-xs text-stone-500">
                          {candidate.ownerName ?? "owner unknown"} ·{" "}
                          {candidate.matchReasons
                            .map((reason) =>
                              reason === "ADDRESS_REGISTRY_MATCH"
                                ? "registry address match"
                                : reason === "CONTAINS_GEOCODE_POINT"
                                  ? "contains geocode point"
                                  : "nearest",
                            )
                            .join(", ")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => void confirmParcels()}
                disabled={selectedParcels.size === 0}
                className="mt-3 rounded bg-stone-900 px-3 py-1.5 text-sm text-ivory disabled:opacity-40"
              >
                Confirm {selectedParcels.size || ""} parcel{selectedParcels.size === 1 ? "" : "s"}
              </button>
            </section>
          ) : null}

          {phase === "awaiting-property" && session ? (
            <section className="space-y-3">
              <div className="rounded-md border border-olive-500 bg-olive-50 p-3 text-sm">
                <h3 className="font-semibold text-stone-900">
                  {session.parcelCandidates.length > 1
                    ? "Confirm this property"
                    : session.parcelContexts.length > 0
                      ? "One strong match — confirm to continue"
                      : "Resolving…"}
                </h3>
                <dl className="mt-2 space-y-1 text-xs text-stone-700">
                  {session.parcelContexts.map((ctx) => (
                    <div key={ctx.parcelId} className="flex justify-between gap-2">
                      <dt>Zoning ({ctx.parcelId.slice(-4)})</dt>
                      <dd className="font-medium">
                        {ctx.zoningBase?.districtLong ?? ctx.zoningBase?.district ?? "—"}
                        {ctx.zoningOverlays && ctx.zoningOverlays.overlays.length > 0
                          ? ` +${ctx.zoningOverlays.overlays.length} overlays`
                          : ""}
                      </dd>
                    </div>
                  ))}
                  {session.parcelContexts.flatMap((ctx) => ctx.structures).map((structure) => (
                    <div key={structure.structureId} className="flex justify-between gap-2">
                      <dt>Structure</dt>
                      <dd className="font-medium">
                        {structure.buildingName ?? `BIN ${structure.structureId}`}
                        {structure.approxHeightFt ? ` · ~${structure.approxHeightFt} ft` : ""}
                      </dd>
                    </div>
                  ))}
                  {session.parcelContexts.some((ctx) => ctx.flood?.zone) ? (
                    <div className="flex justify-between gap-2">
                      <dt>Flood</dt>
                      <dd className="font-medium">FEMA zone {session.parcelContexts[0]?.flood?.zone}</dd>
                    </div>
                  ) : null}
                  {session.parcelContexts.some((ctx) => ctx.rco && ctx.rco.names.length > 0) ? (
                    <div className="flex justify-between gap-2">
                      <dt>Community orgs</dt>
                      <dd className="font-medium">{session.parcelContexts[0]?.rco?.names.length ?? 0} registered</dd>
                    </div>
                  ) : null}
                </dl>
                <button
                  type="button"
                  onClick={() => void acceptAndCommit()}
                  className="mt-3 rounded bg-olive-700 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Accept this property
                </button>
              </div>
            </section>
          ) : null}

          {phase === "committed" && commitSummary ? (
            <section className="rounded-md border border-olive-600 bg-olive-50 p-3 text-sm text-stone-800">
              <h3 className="font-semibold">Property accepted</h3>
              <p className="mt-0.5 font-medium">
                {envelope?.session?.parcelCandidates.find((c) =>
                  (c.brtId ?? c.parcelId) === envelope?.session?.confirmedParcelIds[0],
                )?.ownerName ?? envelope?.session?.selectedAddress?.matchedAddress}
              </p>
              {envelope?.session?.parcelContexts.length ?? 0 > 0 ? (
                <p className="mt-0.5 text-xs text-stone-600">
                  {envelope?.session?.parcelContexts.map((ctx) =>
                    ctx.zoningBase?.districtLong ?? ctx.zoningBase?.district ?? "—",
                  ).join(", ")}
                  {envelope?.session?.parcelContexts.some((ctx) => ctx.zoningOverlays && ctx.zoningOverlays.overlays.length > 0)
                    ? " + overlays"
                    : ""}
                  {envelope?.session?.parcelContexts.flatMap((ctx) => ctx.structures).length ?? 0 > 0
                    ? ` · ${envelope?.session?.parcelContexts.flatMap((ctx) => ctx.structures).length} structure${envelope?.session?.parcelContexts.flatMap((ctx) => ctx.structures).length === 1 ? "" : "s"}`
                    : ""}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-stone-700">{commitSummary}</p>
            </section>
          ) : null}

          {/* Evidence rail — every capture, its mode, its source */}
          {session && session.captures.length > 0 ? (
            <section aria-label="Evidence" className="rounded-md border border-stone-300 bg-white p-3">
              <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">EVIDENCE</h3>
              <ul className="mt-2 space-y-2">
                {dedupeCaptures(session).map((capture) => (
                  <li key={`${capture.providerId}-${capture.rawContentHash.slice(0, 10)}`} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-stone-800">{capture.provider}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          capture.mode === "LIVE"
                            ? "bg-olive-100 text-olive-800"
                            : capture.mode === "CACHED"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-stone-200 text-stone-700"
                        }`}
                      >
                        {MODE_LABEL[capture.mode]}
                      </span>
                    </div>
                    <p className="text-stone-500">
                      retrieved {new Date(capture.retrievedAt).toLocaleString()} ·{" "}
                      {capture.rawContentHash.slice(0, 8)}…
                    </p>
                    {capture.note ? <p className="text-stone-400">{capture.note}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function dedupeCaptures(session: ResolutionSession) {
  const seen = new Set<string>();
  const result = [];
  for (const capture of session.captures) {
    const key = `${capture.providerId}-${capture.rawContentHash.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(capture);
  }
  return result;
}
