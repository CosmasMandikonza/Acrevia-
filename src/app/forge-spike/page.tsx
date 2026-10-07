import { join } from "node:path";
import { buildSpikeScene } from "@/adapters/spatial/benchmark-bootstrap";
import ForgeSpikeClient from "./ForgeSpikeClient";

export const metadata = {
  title: "Forge spike",
};

export const dynamic = "force-dynamic";

export default async function ForgeSpikePage({
  searchParams,
}: {
  searchParams: Promise<{ fallback?: string }>;
}) {
  // All impure work (fs reads, timing) lives behind this plain function;
  // the render body only receives data.
  const { model, buildMs } = buildSpikeScene(
    join(process.cwd(), "docs", "benchmarks", "calvary-memorial-philadelphia"),
  );
  const params = await searchParams;
  return (
    <ForgeSpikeClient
      model={model}
      buildMs={buildMs}
      forceFallback={params.fallback === "1"}
    />
  );
}
