"use client";

import { useEffect, useState } from "react";
import { readStoredAcceptedPair } from "../../lib/accepted-property";

/**
 * COMPILED LAW (issue #5) — the smallest useful regulatory surface, rendered
 * inside the existing Evidence ledger. The map/property stays the hero; this
 * reads as an inspection list, not a dashboard: each executable rule with its
 * value, locator, source, and evidence state; conflicts stay visible with the
 * excluded value and the reason it lost.
 */

type LawRow = {
  constraintId: string;
  value: string;
  codeSection?: string;
  evidence?: string;
  sourceRef?: string;
  sourceTitle?: string;
  verbatim?: string;
};

type ConflictRow = {
  predicate: string;
  members: Array<{
    candidateId: string;
    sourceRef: string;
    sourceTitle?: string;
    authority: string;
    retrievedAt: string;
    valueSummary: string;
  }>;
  resolution: string;
  explanation: string;
};

type CompiledLawResponse = {
  district?: string;
  law?: LawRow[];
  conflicts?: ConflictRow[];
  unknowns?: string[];
  error?: string;
};

const EVIDENCE_LABEL: Record<string, string> = {
  VERIFIED: "VERIFIED",
  SOURCE_CONFIRMED: "SOURCE CONFIRMED",
  CONFLICT: "CONFLICT",
  UNKNOWN: "UNKNOWN",
};

export function CompiledLaw() {
  const [state, setState] = useState<CompiledLawResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pair = readStoredAcceptedPair();
    if (!pair) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/regulatory/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope: pair.envelope, receipt: pair.receipt }),
        });
        const payload = (await response.json()) as CompiledLawResponse;
        if (!cancelled) {
          if (!response.ok) setError(payload.error ?? "compiled law unavailable");
          else setState(payload);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section aria-label="Compiled law" className="rounded-md border border-rust-500 bg-rust-50 px-4 py-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-rust-800">COMPILED LAW</p>
        <p className="mt-1 text-sm text-rust-900">{error}</p>
      </section>
    );
  }
  if (!state) return null;

  return (
    <section aria-label="Compiled law" className="rounded-md border border-stone-300 bg-white">
      <div className="border-b border-stone-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-stone-500">COMPILED LAW</p>
          {state.district ? (
            <span className="font-mono text-[11px] text-stone-500">district {state.district}</span>
          ) : null}
        </div>
        <p
          className="mt-1 text-base font-normal leading-snug text-stone-900"
          style={{ fontFamily: "var(--font-editorial)" }}
        >
          {state.law?.length ?? 0} executable rules
        </p>
        <p className="mt-0.5 text-sm text-stone-600">
          Verified against captured public evidence — every rule cites its source, section, and quote.
        </p>
      </div>
      <ul className="divide-y divide-stone-100">
        {(state.law ?? []).map((row) => (
          <li key={row.constraintId} className="px-4 py-2.5" data-testid="compiled-law-rule">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">{row.value}</p>
                <p className="mt-0.5 truncate text-xs text-stone-500" title={row.codeSection}>
                  {row.codeSection}
                </p>
                <p className="truncate text-xs text-stone-400" title={row.sourceTitle}>
                  Source: {row.sourceTitle ?? row.sourceRef}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wide ${
                  row.evidence === "VERIFIED"
                    ? "border-olive-600 bg-olive-50 text-olive-800"
                    : "border-stone-400 bg-stone-50 text-stone-700"
                }`}
              >
                {EVIDENCE_LABEL[row.evidence ?? ""] ?? row.evidence}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {(state.conflicts ?? []).length > 0 ? (
        <div className="border-t border-stone-200 px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-rust-700">CONFLICTS — VISIBLE, NOT CHOSEN</p>
          <ul className="mt-2 space-y-2">
            {(state.conflicts ?? []).map((conflict, index) => (
              <li
                key={index}
                className="border-l-2 border-rust-500 bg-rust-50/60 px-3 py-2"
                data-testid="compiled-law-conflict"
              >
                {conflict.members.map((member) => (
                  <p key={member.candidateId} className="text-xs text-stone-700">
                    <span className="font-medium">{member.valueSummary}</span> — {member.sourceTitle ?? member.sourceRef}{" "}
                    ({member.authority.replace(/_/g, " ").toLowerCase()}, {member.retrievedAt.slice(0, 10)})
                  </p>
                ))}
                <p className="mt-1 text-xs text-stone-600">{conflict.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(state.unknowns ?? []).length > 0 ? (
        <div className="border-t border-stone-200 px-4 py-3">
          <p className="text-xs text-stone-500">
            Unresolved: {state.unknowns?.join(", ")} — recorded as unknown, never guessed.
          </p>
        </div>
      ) : null}
    </section>
  );
}
