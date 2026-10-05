"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  Map,
  Layers,
  Landmark,
  Users,
  BookOpen,
  ArrowUpRight,
  MapPin,
  ArrowLeft,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";
import { Copilot } from "./copilot";
import nextDynamic from "next/dynamic";
import { surfaces, getSurface } from "@/lib/surfaces";
import { validateAddress } from "@/lib/address";
import {
  normalizeAddressQuery,
  onAccepted,
  verifyStoredSession,
  type AcceptedPropertyRecord,
} from "@/lib/accepted-property";
const icons = {
  portfolio: Building2,
  site: Map,
  scenarios: Layers,
  capital: Landmark,
  council: Users,
  evidence: BookOpen,
};
const SiteResolution = nextDynamic(
  () => import("@/components/site/site-resolution").then((m) => m.SiteResolution),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-stone-500">Preparing the spatial canvas…</p>
    ),
  },
);

export function Workspace() {
  const params = useSearchParams();
  const rawAddress = params.get("address") ?? "";
  const addressError = rawAddress ? validateAddress(rawAddress) : null;
  const address = addressError ? "" : rawAddress.trim();
  const surface = getSurface(params.get("view"));
  const [accepted, setAccepted] = useState<AcceptedPropertyRecord | null>(null);

  // The accepted record renders only after the stored { envelope, receipt }
  // pair passes server verification (POST /api/gis/verify) — sessionStorage is
  // never displayed as trusted on its own. Fresh commits propagate through the
  // in-memory accepted registry (module scope, unreachable from page scripts);
  // no DOM custom event can inject accepted state.
  useEffect(() => {
    let cancelled = false;
    void verifyStoredSession().then((result) => {
      if (cancelled) return;
      // Address binding: the accepted record renders only when the current
      // workspace address matches the VERIFIED session query — a valid
      // accepted session for one address never displays under another.
      if (
        result.status === "valid" &&
        address &&
        normalizeAddressQuery(result.query) === normalizeAddressQuery(address)
      ) {
        setAccepted(result.record);
      } else {
        setAccepted(null);
      }
    });
    const unsubscribe = onAccepted((record) => setAccepted(record));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [address]);

  function href(view: string) {
    const query = new URLSearchParams();
    if (address) query.set("address", address);
    query.set("view", view);
    return `/workspace?${query.toString()}`;
  }
  return (
    <div className="workspace">
      <header className="workspace-header">
        <Brand />
        <div className="project-identity">
          <span className="project-label">PROPERTY WORKSPACE</span>
          <strong>{address || "Your next chapter"}</strong>
        </div>
        <span className="preview-label">Foundation preview</span>
        <Copilot />
      </header>
      <div className="workspace-body">
        <nav className="workspace-nav" aria-label="Workspace">
          <span className="nav-caption">WORKSPACE</span>
          {surfaces.map((item) => {
            const Icon = icons[item.id];
            return (
              <Link
                key={item.id}
                href={href(item.id)}
                className={
                  surface.id === item.id ? "nav-item active" : "nav-item"
                }
                aria-current={surface.id === item.id ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          <div className="nav-footer">
            <p>
              Land.
              <br />
              Mission.
              <br />
              <em>Possibility.</em>
            </p>
            <Link href="/" className="text-link">
              <ArrowLeft size={14} aria-hidden="true" />
              Change address
            </Link>
          </div>
        </nav>
        <main id="main" className="workspace-main">
          <div className="workspace-toolbar">
            <div>
              <span className="eyebrow">{surface.eyebrow}</span>
              <h1>{surface.label}</h1>
            </div>
            <span className="toolbar-status">
              <span className="status-dot" />
              {accepted
                ? `Property accepted — Development Graph revision ${accepted.revision}`
                : surface.id === "site" && !addressError
                  ? address
                    ? "Ready to resolve from public records"
                    : "Enter a church address to begin"
                  : "Awaiting project data"}
            </span>
          </div>
          {surface.id === "site" && !addressError ? (
            <section className="spatial-canvas spatial-canvas-live" aria-label="Site resolution canvas">
              <SiteResolution initialQuery={address} />
            </section>
          ) : surface.id === "evidence" && accepted ? (
            <EvidenceLedger record={accepted} />
          ) : (
          <section
            className="spatial-canvas"
            aria-label={`${surface.label} canvas placeholder`}
          >
            <div className="canvas-corner top-left" />
            <div className="canvas-corner bottom-right" />
            <span className="canvas-reference">
              ACREVIA / {surface.label.toUpperCase()}
            </span>
            <span className="north-marker" aria-hidden="true">
              ↑<small>N</small>
            </span>
            <StatePanel
              key={surface.id}
              state={addressError ? "error" : "empty"}
              title={
                addressError
                  ? "This address needs another look."
                  : surface.title
              }
              className="canvas-state"
              action={
                <Button asChild variant="outline">
                  <Link href="/">
                    {address
                      ? "Choose another address"
                      : "Enter a church address"}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </Button>
              }
            >
              <p>{addressError || surface.description}</p>
              {address && (
                <p className="entered-address">
                  <MapPin size={16} aria-hidden="true" />
                  <span>
                    {address}
                    <small>Address entered · not resolved or verified</small>
                  </span>
                </p>
              )}
            </StatePanel>
            <div className="canvas-footnote">
              <span>Spatial canvas placeholder</span>
              <span>No property geometry loaded</span>
            </div>
          </section>
          )}
          <div className="evidence-strip" aria-label="Project evidence status">
            <BookOpen size={16} aria-hidden="true" />
            <strong>Evidence</strong>
            {accepted ? (
              <span>
                {accepted.captures.length} captures behind the accepted property
              </span>
            ) : surface.id === "site" && !addressError ? (
              <span>Public records resolve on the Site surface</span>
            ) : (
              <span>No sources checked</span>
            )}
            <span className="evidence-note">
              {accepted
                ? accepted.captures
                    .map((capture) => capture.mode)
                    .filter((mode, index, all) => all.indexOf(mode) === index)
                    .join(" · ")
                : surface.id === "site" && !addressError
                  ? "Census · Philadelphia parcels · L&I zoning · building footprints"
                  : "No feasibility conclusions available"}
            </span>
            <Link href={href("evidence")}>
              Inspect evidence
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}

const MODE_BADGE_LABEL: Record<string, string> = {
  LIVE: "Live",
  CACHED: "Cached",
  FIXTURE: "Fixture evidence",
};

function EvidenceLedger({ record }: { record: AcceptedPropertyRecord }) {
  return (
    <section
      className="spatial-canvas spatial-canvas-live overflow-y-auto"
      aria-label="Evidence ledger"
    >
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="rounded-md border border-olive-500 bg-olive-50 p-4">
          <h2 className="text-sm font-semibold text-stone-900">
            Accepted property — every fact traces to a source
          </h2>
          <p className="mt-1 text-sm text-stone-800">
            {record.ownerName ?? record.matchedAddress ?? record.query}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-stone-700 sm:grid-cols-3">
            <div>
              <dt className="text-stone-500">Development Graph</dt>
              <dd className="font-medium">
                {record.nodeCount} nodes · revision {record.revision}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Audited events</dt>
              <dd className="font-medium">{record.eventCount}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Accepted</dt>
              <dd className="font-medium">{new Date(record.acceptedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Zoning</dt>
              <dd className="font-medium">{record.zoningSummary || "—"}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Structures</dt>
              <dd className="font-medium">{record.structureCount}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Captures</dt>
              <dd className="font-medium">{record.captures.length}</dd>
            </div>
          </dl>
        </div>

        <section aria-label="Captures" className="rounded-md border border-stone-300 bg-white p-4">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-stone-500">CAPTURES</h3>
          <ul className="mt-3 space-y-2">
            {record.captures.map((capture) => (
              <li
                key={`${capture.provider}-${capture.hashPrefix}`}
                className="flex items-start justify-between gap-3 border-b border-stone-100 pb-2 text-sm last:border-b-0"
              >
                <div>
                  <p className="font-medium text-stone-800">{capture.provider}</p>
                  <p className="text-xs text-stone-500">
                    retrieved {new Date(capture.retrievedAt).toLocaleString()} ·{" "}
                    {capture.hashPrefix}…
                  </p>
                  {capture.note ? (
                    <p className="text-xs text-stone-400">{capture.note}</p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    capture.mode === "LIVE"
                      ? "bg-olive-100 text-olive-800"
                      : capture.mode === "CACHED"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-stone-200 text-stone-700"
                  }`}
                >
                  {MODE_BADGE_LABEL[capture.mode] ?? capture.mode}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-stone-500">
          From the property accepted in this browser session. The server stays stateless — the
          signed resolution envelope and its captures persist client-side, and each capture hash
          pins the exact bytes the provider returned.
        </p>
      </div>
    </section>
  );
}
