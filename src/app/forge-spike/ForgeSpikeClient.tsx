"use client";

import nextDynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type ForgeSpikeViewType from "@/spatial/renderer/ForgeSpikeView";

const ForgeSpikeView = nextDynamic(
  () => import("@/spatial/renderer/ForgeSpikeView"),
  {
    ssr: false,
    loading: () => (
      <main className="forge-page forge-loading" data-testid="forge-loading">
        <p>Building the scene from Development Graph state…</p>
      </main>
    ),
  },
);

export default function ForgeSpikeClient({
  model,
  buildMs,
  forceFallback,
}: {
  model: ComponentProps<typeof ForgeSpikeViewType>["model"];
  buildMs: number;
  forceFallback: boolean;
}) {
  return (
    <main className="forge-page">
      <ForgeSpikeView model={model} buildMs={buildMs} forceFallback={forceFallback} />
    </main>
  );
}
