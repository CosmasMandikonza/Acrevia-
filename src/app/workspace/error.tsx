"use client";
import { StatePanel } from "@/components/ui/state-panel";
import { Button } from "@/components/ui/button";
export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="full-state">
      <StatePanel
        state="error"
        title="The workspace could not open."
        action={<Button onClick={reset}>Try again</Button>}
      >
        Please try again. No analysis has been performed.
      </StatePanel>
    </main>
  );
}
