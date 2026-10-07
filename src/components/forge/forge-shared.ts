/**
 * Forge client-shared types (issue #9). Kept free of three.js imports so
 * the SVG fallback path never pulls the WebGL stack into its bundle.
 */

export type Moment = "existing" | "legal" | "mission" | "scenario";
export const MOMENTS: Moment[] = ["existing", "legal", "mission", "scenario"];

export interface Selection {
  id: string;
  title: string;
  status: string | null;
  detail: string;
  provenance: { nodeId: string; nodeKind: string; label: string }[];
}
