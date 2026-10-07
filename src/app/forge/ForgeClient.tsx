"use client";

import nextDynamic from "next/dynamic";

/**
 * Client-only mount for ForgeApp. The whole /forge experience reads
 * sessionStorage and probes WebGL — client-only by nature. Rendering it
 * with ssr:false avoids server/client divergence (hydration mismatch) and
 * ships only a quiet loading shell to the server response.
 */
const ForgeApp = nextDynamic(() => import("./ForgeApp"), {
  ssr: false,
  loading: () => (
    <main data-testid="forge-loading" style={{ display: "grid", placeItems: "center", height: "100dvh", background: "#edefe8" }}>
      <p style={{ fontSize: 13, color: "#55523f" }}>Deriving the development twin…</p>
    </main>
  ),
});

export default function ForgeClient() {
  return <ForgeApp />;
}
