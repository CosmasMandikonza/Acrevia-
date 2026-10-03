import Link from "next/link";
import { StatePanel } from "@/components/ui/state-panel";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main" className="full-state">
      <StatePanel
        state="empty"
        title="This page is outside the plan."
        action={
          <Button asChild>
            <Link href="/">Return to Acrevia</Link>
          </Button>
        }
      >
        The page you requested does not exist.
      </StatePanel>
    </main>
  );
}
