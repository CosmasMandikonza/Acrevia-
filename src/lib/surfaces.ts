export const surfaces = [
  {
    id: "portfolio",
    label: "Portfolio",
    eyebrow: "THE BIGGER PICTURE",
    title: "Every property starts a possibility.",
    description:
      "Your properties will come together here. No properties have been added and portfolio screening is not connected.",
  },
  {
    id: "site",
    label: "Site",
    eyebrow: "YOUR LAND, IN CONTEXT",
    title: "A place to understand your land.",
    description:
      "Your parcel, existing buildings, and ministry spaces will appear here once property lookup is connected.",
  },
  {
    id: "scenarios",
    label: "Scenarios",
    eyebrow: "ROOM FOR POSSIBILITY",
    title: "Different futures. Shared foundations.",
    description:
      "There are no computed scenarios yet. Future alternatives will be derived from property, legal, and mission constraints.",
  },
  {
    id: "capital",
    label: "Capital",
    eyebrow: "THE PATH TO DELIVERY",
    title: "Consider how possibility takes shape.",
    description:
      "No costs or funding pathways have been calculated. Preliminary capital exploration will follow the shared project model.",
  },
  {
    id: "council",
    label: "Council",
    eyebrow: "A SHARED UNDERSTANDING",
    title: "Bring the right questions to the table.",
    description:
      "Accept a property and compute a scenario first. The decision room will assemble the same certified facts for every audience — pastor, board, neighbor, city, and professional — with a one-click 16:9 export.",
  },
  {
    id: "evidence",
    label: "Evidence",
    eyebrow: "A CLEAR BASIS FOR EVERY STEP",
    title: "Understanding starts with evidence.",
    description:
      "No sources have been collected or checked. Regulations, assumptions, and review questions will be inspectable here.",
  },
] as const;
export type SurfaceId = (typeof surfaces)[number]["id"];
export function getSurface(value: string | null) {
  return surfaces.find((surface) => surface.id === value) ?? surfaces[1];
}
