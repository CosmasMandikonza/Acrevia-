import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CouncilRoom } from "../../src/components/council/council-room";
import type { CouncilPackage } from "../../src/application/council/package";
import type { SpatialSceneModel } from "../../src/spatial/scene-model";

/**
 * Issue #13 — the ONE Council surface. Component-level contract: it renders
 * ONLY package facts from /api/council/package, switching audiences is a
 * client-side reframe of the SAME package (no refetch, no number drift),
 * and the one-click export writes a self-contained deck from the same
 * bytes the room is rendering.
 */

const PAIR = {
  envelope: {
    session: { sessionId: "council-test", confirmedParcelIds: ["778273000"] },
    signature: "envelope-sig",
  },
  receipt: {
    payload: { projectId: "gis:778273000" },
    signature: "receipt-sig",
  },
};

function makePackage(): CouncilPackage {
  const fact = (
    key: string,
    label: string,
    value: string,
    source: CouncilPackage["facts"][string]["source"] = "solver",
  ) => ({ key, label, value, source });
  const facts: CouncilPackage["facts"] = {
    address: fact(
      "address",
      "Property",
      "7200 Roosevelt Blvd, Philadelphia, PA",
      "gis",
    ),
    district: fact("district", "Base zoning", "RM-1", "law"),
    parcel: fact("parcel", "Parcel", "gis:parcel:778273000", "gis"),
    scenario: fact("scenario", "Scenario", "MISSION BALANCE"),
    homes: fact("homes", "Homes", "26"),
    parking: fact("parking", "Sunday parking", "86 spaces"),
    floors: fact("floors", "Scale", "3 stories"),
    "height-limit": fact("height-limit", "Height ceiling", "38 ft", "law"),
    footprint: fact("footprint", "Building footprint", "16,800 ft²"),
    confidence: fact(
      "confidence",
      "Solver confidence",
      "SUPPORTED_WITHIN_MODED_SCOPE",
    ),
    "mission-count": fact(
      "mission-count",
      "Mission commitments",
      "3 confirmed",
      "mission",
    ),
    "preserved-structures": fact(
      "preserved-structures",
      "Church structures preserved",
      "Sanctuary",
      "mission",
    ),
    "retain-ownership": fact(
      "retain-ownership",
      "Land ownership",
      "Congregation retains ownership",
      "mission",
    ),
    "open-questions": fact(
      "open-questions",
      "Open expert items",
      "4",
      "review",
    ),
    "capital-pathway": fact(
      "capital-pathway",
      "Capital pathway",
      "Church-led",
      "capital",
    ),
    "total-development-cost": fact(
      "total-development-cost",
      "Total development cost",
      "$19,165,142",
      "capital",
    ),
    "funding-gap": fact("funding-gap", "Funding gap", "$4,665,142", "capital"),
    "affordable-homes": fact(
      "affordable-homes",
      "Affordable homes",
      "10",
      "capital",
    ),
  };
  const view = (
    audience: CouncilPackage["audienceViews"][keyof CouncilPackage["audienceViews"]]["audience"],
    label: string,
    headline: string,
    emphasis: Array<{ factKey: string; why: string }>,
  ) => ({
    audience,
    label,
    essence: `Essence for ${label}.`,
    headline,
    lead: [`Lead for ${label} with 26 homes and 86 spaces.`],
    emphasis,
    detail:
      audience === "professional"
        ? ("audit" as const)
        : audience === "board" || audience === "council"
          ? ("standard" as const)
          : ("plain" as const),
    cta: `CTA for ${label}.`,
    questionsTitle: `Questions for ${label}`,
  });
  return {
    packageVersion: "acrevia.council.v1",
    project: {
      projectId: "gis:778273000",
      query: "7200 Roosevelt Blvd",
      matchedAddress: "7200 Roosevelt Blvd, Philadelphia, PA",
      district: "RM-1",
      overlay: null,
      parcelNodeId: "gis:parcel:778273000",
      parcelAreaSqFt: 76_418,
      revision: 7,
    },
    scenarios: [
      {
        scenarioId: "scenario:solver:mission-balance:abc",
        certificateId: "scenario:solver:mission-balance:abc:certificate",
        label: "MISSION BALANCE",
        homes: 26,
        freshness: "CURRENT",
      },
      {
        scenarioId: "scenario:solver:housing-max:def",
        certificateId: "scenario:solver:housing-max:def:certificate",
        label: "HOUSING MAX",
        homes: 41,
        freshness: "CURRENT",
      },
    ],
    selected: {
      scenarioId: "scenario:solver:mission-balance:abc",
      scenarioLabel: "MISSION BALANCE",
      homes: 26,
      parkingStalls: 86,
      parkingMargin: 0,
      footprintSqFt: 16_800,
      floors: 3,
      heightLimitFt: 38,
      confidence: "SUPPORTED_WITHIN_MODED_SCOPE",
      solverVersion: "solver/exact-integer-homes v2",
      constraintResults: [
        {
          constraint: "Max height",
          source: "law",
          status: "SATISFIED",
          actual: "38 ft",
          limit: "38 ft",
          explanation: "Within ceiling.",
        },
      ],
      satisfiedCount: 1,
      openCount: 0,
    },
    certificate: {
      id: "scenario:solver:mission-balance:abc:certificate",
      version: 1,
      freshness: "CURRENT",
      freshnessReasons: [],
      dependencyCount: 12,
      certificateHash: "c".repeat(64),
    },
    mission: {
      commitments: [
        {
          id: "mission:min-sunday-parking",
          intentText: "Keep at least 110 Sunday parking spaces.",
          normalizedSummary: "at least 110 Sunday parking spaces",
          hardOrSoft: "hard",
        },
      ],
      preservedStructureLabels: ["Sanctuary"],
      retainOwnership: true,
    },
    capital: {
      fingerprint: "f".repeat(64),
      engineVersion: "capital/preliminary-v1",
      pathway: {
        id: "church-led",
        label: "Church-led",
        tagline: "tagline",
        ownershipNote: "note",
      },
      totalDevelopmentCost: "$19,165,142",
      identifiedCapital: "$14,500,000",
      fundingGap: "$4,665,142",
      gapPctOfCost: "24.3",
      affordableHomes: 10,
      noiYieldOnCostPct: "2.3",
      projection: ["Projection sentence one."],
      expertRequired: [
        {
          id: "expert:gap-strategy",
          title: "Funding gap requires a capital strategy",
        },
      ],
    },
    evidence: {
      assumptions: [
        {
          statement: "Stall gross area",
          valueSummary: "315 ft²",
          rationale: "Standard stall.",
        },
      ],
      conflicts: [],
      expertReviews: [
        {
          question: "Utility capacity?",
          category: "utilities",
          severity: "non-blocking",
          reviewStatus: "OPEN",
        },
      ],
      computationQuestions: [],
      sources: [
        {
          title: "Philadelphia Zoning Code §14-525",
          publisher: "City of Philadelphia",
          authority: "ADOPTED_CODE",
          retrievedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
    facts,
    audienceViews: {
      pastoral: view(
        "pastoral",
        "PASTOR / MINISTRY",
        "The church stays. 26 homes become possible.",
        [
          { factKey: "mission-count", why: "Stewardship." },
          {
            factKey: "preserved-structures",
            why: "What the congregation kept.",
          },
          { factKey: "homes", why: "The possibility." },
        ],
      ),
      board: view(
        "board",
        "BOARD",
        "MISSION BALANCE: 26 homes, 86 spaces — a $4,665,142 preliminary gap.",
        [
          { factKey: "homes", why: "The yield." },
          { factKey: "total-development-cost", why: "What delivery takes." },
          { factKey: "funding-gap", why: "What is not funded." },
        ],
      ),
      neighbor: view(
        "neighbor",
        "NEIGHBOR",
        "3 stories on the block. The church stays.",
        [
          { factKey: "floors", why: "Scale." },
          { factKey: "parking", why: "Parking." },
          { factKey: "homes", why: "Neighbors." },
        ],
      ),
      council: view(
        "council",
        "CITY / COUNCIL",
        "26 homes under RM-1 — preliminary, evidence-backed.",
        [
          { factKey: "district", why: "Legal basis." },
          { factKey: "homes", why: "What is proposed." },
        ],
      ),
      professional: view(
        "professional",
        "PROFESSIONAL REVIEWER",
        "Certificate abc — CURRENT.",
        [
          { factKey: "confidence", why: "Epistemic state." },
          { factKey: "homes", why: "Computed." },
        ],
      ),
    },
    nextDecision: {
      headline:
        "Board decision: the $4,665,142 preliminary funding gap has no identified source",
      rationale: "Closing a gap is professional work.",
      blockers: [],
    },
    boundaryNotice:
      "Acrevia produces preliminary, model-derived feasibility material.",
    freshness: { status: "CURRENT", certificateFreshness: "CURRENT" },
    packageFingerprint: "a".repeat(64),
  };
}

const SCENE = {
  schemaVersion: "acrevia.spatial.scene.v1",
  parcel: {
    polygon: {
      exterior: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 300 },
        { x: 0, y: 300 },
      ],
    },
    computedAreaSqFt: 60_000,
  },
  structures: [],
  frontage: { streetLabel: null },
  cameras: [
    { id: "camera:aerial", label: "Aerial", note: "Overview from above." },
    { id: "camera:neighbor", label: "Neighbor", note: "From the sidewalk." },
  ],
  scenarios: [
    { scenarioId: "scenario:solver:mission-balance:abc", volumes: [] },
  ],
} as unknown as SpatialSceneModel;

function fetchMock(
  payloads: {
    council?: unknown;
    forge?: unknown;
  } = {},
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/forge/scene")) {
      return new Response(
        JSON.stringify(payloads.forge ?? { status: "SOLVED", scene: SCENE }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify(
        payloads.council ?? { status: "ASSEMBLED", package: makePackage() },
      ),
      { status: 200 },
    );
  });
}

describe("CouncilRoom — one room, five audiences, same truth", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "acrevia.accepted-session",
      JSON.stringify(PAIR),
    );
    URL.createObjectURL = vi.fn(() => "blob:council");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the assembled package: narrative, fingerprint, capital, plan, saved views", async () => {
    const fetches = fetchMock();
    vi.stubGlobal("fetch", fetches);

    render(<CouncilRoom />);

    expect(
      await screen.findByTestId("council-narrative-headline"),
    ).toHaveTextContent("The church stays. 26 homes become possible.");
    expect(screen.getByTestId("council-same-truth")).toHaveTextContent(
      "a".repeat(32),
    );
    expect(screen.getByTestId("council-capital")).toHaveTextContent(
      "$19,165,142",
    );
    expect(screen.getByTestId("council-capital")).toHaveTextContent(
      "$4,665,142",
    );
    expect(screen.getByTestId("council-plan")).toHaveTextContent("60,000");
    expect(screen.getByTestId("council-saved-views")).toHaveTextContent(
      "SAVED VIEW · Aerial",
    );
    expect(screen.getByTestId("council-next-decision")).toHaveTextContent(
      "funding gap",
    );
  });

  it("switching audiences reframes without changing a single number", async () => {
    vi.stubGlobal("fetch", fetchMock());

    render(<CouncilRoom />);
    await screen.findByTestId("council-narrative-headline");

    const homes = screen.getByTestId("council-fact-homes").textContent;
    const fingerprint = screen.getByTestId("council-same-truth").textContent;

    fireEvent.click(screen.getByTestId("council-audience-neighbor"));
    expect(screen.getByTestId("council-narrative-headline")).toHaveTextContent(
      "3 stories on the block",
    );
    expect(screen.getByTestId("council-fact-homes").textContent).toBe(homes);
    expect(screen.getByTestId("council-same-truth").textContent).toBe(
      fingerprint,
    );

    fireEvent.click(screen.getByTestId("council-audience-council"));
    expect(screen.getByTestId("council-narrative-headline")).toHaveTextContent(
      "RM-1",
    );
    expect(screen.getByTestId("council-fact-homes").textContent).toBe(homes);
  });

  it("one-click export writes a self-contained deck for the current audience", async () => {
    vi.stubGlobal("fetch", fetchMock());
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<CouncilRoom />);
    await screen.findByTestId("council-export");

    fireEvent.click(screen.getByTestId("council-audience-council"));
    fireEvent.click(screen.getByTestId("council-export"));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Blob;
    const html = await blob.text();
    expect(html).toContain("7200 Roosevelt Blvd, Philadelphia, PA");
    expect(html).toContain("CITY / COUNCIL");
    expect(html).toContain("a".repeat(32));
    expect(html).toContain("Saved Forge views");
    expect(html).toContain("Aerial");
    expect(html).toContain("Philadelphia Zoning Code");
    expect(html).toContain("aspect-ratio: 16 / 9");
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("acrevia-council-gis778273000-council.html");
  });

  it("shows the stale panel with recovery scenarios instead of presenting stale truth", async () => {
    let councilCalls = 0;
    const fetches = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void init;
        const url = String(input);
        if (url.includes("/api/forge/scene")) {
          return new Response(JSON.stringify({ error: "unavailable" }), {
            status: 200,
          });
        }
        councilCalls += 1;
        const payload =
          councilCalls === 1
            ? {
                status: "stale-scenario",
                reason:
                  "The requested scenario is not part of the current trusted rebuild.",
                scenarios: makePackage().scenarios,
              }
            : { status: "ASSEMBLED", package: makePackage() };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetches);

    render(<CouncilRoom />);

    const panel = await screen.findByTestId("council-stale");
    expect(panel).toHaveTextContent("can no longer be presented");
    const chip = screen.getByTestId(
      "council-scenario-chip-scenario:solver:mission-balance:abc",
    );
    expect(chip).toHaveTextContent("MISSION BALANCE");

    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByTestId("council-narrative-headline")).toBeTruthy(),
    );
    const recoveryCalls = fetches.mock.calls.filter((call) =>
      String(call[0]).includes("/api/council/package"),
    );
    const recoveryBody = JSON.parse(
      (recoveryCalls[recoveryCalls.length - 1][1] as { body: string }).body,
    ) as { scenarioId?: string };
    expect(recoveryBody.scenarioId).toBe("scenario:solver:mission-balance:abc");
  });
});
