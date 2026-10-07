import type { Metadata } from "next";
import ForgeClient from "./ForgeClient";

export const metadata: Metadata = {
  title: "Forge — Acrevia",
};

export const dynamic = "force-dynamic";

/**
 * /forge (issue #9) — the interactive 3D legal + mission development twin.
 * Fully client-orchestrated: every fact arrives from POST /api/forge/scene
 * over the accepted-property trust model; the page itself renders nothing
 * from unverified state (and nothing at all on the server beyond the
 * loading shell — WebGL and sessionStorage are client-only concerns).
 */
export default function ForgePage() {
  return <ForgeClient />;
}
