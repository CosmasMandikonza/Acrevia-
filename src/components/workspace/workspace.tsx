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
import { EvidenceLedger } from "../evidence/evidence-ledger";
const icons = {
  portfolio: Building2,
  site: Map,
  scenarios: Layers,
  capital: Landmark,
  council: Users,
  evidence: BookOpen,
};
const SiteResolution = nextDynamic(
  () =>
    import("@/components/site/site-resolution").then((m) => m.SiteResolution),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-stone-500">Preparing the spatial canvas…</p>
    ),
  },
);
const ScenarioSolver = nextDynamic(
  () =>
    import("@/components/site/scenario-solver").then((m) => m.ScenarioSolver),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-stone-500">Preparing the scenario solver…</p>
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
  // Bumped once per APPLIED Copilot mission confirmation. Feeding it into the
  // keys of the state-derived surfaces remounts exactly those views so they
  // re-read the mission command log and rebuild current state immediately —
  // a React-owned refresh, never a DOM custom event, never a second store.
  const [projectStateEpoch, setProjectStateEpoch] = useState(0);

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
    // Fresh in-page acceptances are address-scoped too: a record for another
    // address (e.g. resolved by editing the Site field) must not render under
    // this workspace's URL/header. The URL itself is synchronized to the
    // verified session query on successful resolve, so the normal path keeps
    // input, URL, header, and accepted property bound to the same site.
    const unsubscribe = onAccepted((record) => {
      if (
        address &&
        normalizeAddressQuery(record.query) === normalizeAddressQuery(address)
      ) {
        setAccepted(record);
      } else {
        setAccepted(null);
      }
    });
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
        <Copilot
          accepted={accepted}
          onProjectStateChanged={() =>
            setProjectStateEpoch((epoch) => epoch + 1)
          }
        />
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
            <section
              className="spatial-canvas spatial-canvas-live"
              aria-label="Site resolution canvas"
            >
              <SiteResolution initialQuery={address} autoResolve={!!address} />
            </section>
          ) : surface.id === "evidence" && accepted ? (
            <EvidenceLedger
              key={`${params.get("focus") ?? ""}|${params.get("scenario") ?? ""}|${params.get("certificate") ?? ""}|${projectStateEpoch}`}
              record={accepted}
            />
          ) : surface.id === "scenarios" && accepted ? (
            <section
              className="spatial-canvas spatial-canvas-live overflow-y-auto"
              aria-label="Scenario solver"
            >
              <ScenarioSolver key={projectStateEpoch} />
            </section>
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

// The Evidence surface lives in src/components/evidence/evidence-ledger.tsx
// (issue #11): a trusted Proof projection over the Development Graph with the
// compiled-law inspection, certificates, assumptions, conflicts, and the
// expert queue. This shell stays a thin host.
