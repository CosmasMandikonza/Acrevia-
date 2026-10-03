import { Suspense } from "react";
import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/workspace";
import { StatePanel } from "@/components/ui/state-panel";
export const metadata: Metadata = { title: "Property workspace" };
export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <main id="main" className="full-state">
          <StatePanel state="loading" title="Opening your workspace…">
            Preparing your view.
          </StatePanel>
        </main>
      }
    >
      <Workspace />
    </Suspense>
  );
}
