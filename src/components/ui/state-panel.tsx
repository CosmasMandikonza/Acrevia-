import {
  CircleDashed,
  AlertTriangle,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export type ViewState = "empty" | "loading" | "error" | "stale";
const icons = {
  empty: CircleDashed,
  loading: LoaderCircle,
  error: AlertTriangle,
  stale: Clock3,
};
export function StatePanel({
  state,
  title,
  children,
  action,
  className,
}: {
  state: ViewState;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = icons[state];
  return (
    <section
      className={cn("state-panel", `state-${state}`, className)}
      role={state === "error" ? "alert" : "status"}
      aria-busy={state === "loading"}
    >
      <Icon
        className={state === "loading" ? "state-icon spin" : "state-icon"}
        aria-hidden="true"
      />
      <h2>{title}</h2>
      <div className="state-description">{children}</div>
      {action}
    </section>
  );
}
