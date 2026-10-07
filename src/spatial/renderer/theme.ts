/**
 * Visual vocabulary for the Forge spike renderer (ADR 0008).
 *
 * Extends the app's design tokens (globals.css) into 3D semantics:
 * law = cool slate blue, mission = the product's olive accent, caution =
 * amber, conflict = rust. Neutral warm-stone ground and massing keep the
 * scene architectural, not game-like: no bloom, no neon, no HDR downloads.
 */

export const palette = {
  // Environment
  sky: "#edefe8",
  ground: "#e6e3d7",
  groundParcel: "#efecdf",
  street: "#d9d5c8",
  // Existing conditions
  structureWall: "#e5e3d3",
  structureEdge: "#57544a",
  protectedRing: "#45583b",
  // Legal (law)
  legalFill: "#54749c",
  legalEdge: "#37587f",
  // Mission
  missionFill: "#5a7048",
  missionEdge: "#2f4027",
  // Removed by mission (caution amber)
  clipFill: "#c99a4a",
  clipEdge: "#8a6420",
  // Scenario
  scenarioFill: "#f5f3e8",
  scenarioEdge: "#3a3a30",
  conflictFill: "#a4543f",
  conflictEdge: "#7c2f22",
  // Lines
  parcelLine: "#6a6a5c",
  parkingSurface: "#dcd7c4",
  parkingLine: "#fbfaf3",
} as const;

export const opacity = {
  envelope: 0.17,
  envelopeDim: 0.06,
  clip: 0.2,
  heightPlane: 0.09,
  conflict: 0.24,
  solid: 1,
} as const;
