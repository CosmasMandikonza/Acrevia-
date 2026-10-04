"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
              Awaiting project data
            </span>
          </div>
          {surface.id === "site" && !addressError ? (
            <section className="spatial-canvas spatial-canvas-live" aria-label="Site resolution canvas">
              <SiteResolution initialQuery={address} />
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
            <span>No sources checked</span>
            <span className="evidence-note">
              No feasibility conclusions available
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
