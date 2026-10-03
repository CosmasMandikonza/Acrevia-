import { StatePanel } from "@/components/ui/state-panel";
export default function Loading() {
  return (
    <main id="main" className="full-state">
      <StatePanel state="loading" title="Opening your workspace…">
        Preparing your view.
      </StatePanel>
    </main>
  );
}
