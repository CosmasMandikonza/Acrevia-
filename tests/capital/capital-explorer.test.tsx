import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CapitalExplorer } from "../../src/components/capital/capital-explorer";

/**
 * Issue #12 — the ONE Capital surface. Component-level contract: it renders
 * ONLY server-derived numbers (fingerprint, gap, PRELIMINARY labels), and
 * user actions (pathway switch) re-POST to the single trusted route rather
 * than computing anything locally.
 */

const PAIR = {
  envelope: {
    session: { sessionId: "capital-test", confirmedParcelIds: ["778273000"] },
    signature: "envelope-sig",
  },
  receipt: {
    payload: { projectId: "gis:778273000" },
    signature: "receipt-sig",
  },
};

function fixture(pathway: "church-led" | "ground-lease", fingerprint: string) {
  return {
    status: "EVALUATED" as const,
    fingerprint,
    engineVersion: "capital/preliminary-v1",
    scenario: {
      scenarioId: "scenario:solver:housing-max:test01",
      certificateId: "scenario:solver:housing-max:test01:certificate",
      scenarioLabel: "HOUSING MAX",
      homes: 42,
      floors: 3,
      footprintSqFt: 16_800,
      parkingStalls: 84,
      grossResidentialSqFt: 50_400,
      freshness: "CURRENT",
      solverVersion: "solver/exact-integer-homes v2",
    },
    pathway: {
      id: pathway,
      label: pathway === "church-led" ? "Church-led" : "Ground lease",
      tagline: "tagline",
      ownershipNote: "ownership note",
    },
    assumptions: {
      hardCostPerSqFt: 240,
      softCostPct: 18,
      contingencyPct: 8,
      siteInfrastructure: 1_500_000,
      financingCarry: 450_000,
      landCost: pathway === "church-led" ? 1_800_000 : 0,
      annualRevenuePerHome: 21_600,
      occupancyPct: 93,
      opexMode: "pct",
      operatingExpensePct: 35,
      annualOperatingExpensePerHome: 7_800,
      affordabilityTargetPct: 40,
      affordableRevenueFactor: 0.6,
      churchContribution: pathway === "church-led" ? 3_500_000 : 0,
      partnerContribution: pathway === "church-led" ? 0 : 2_000_000,
      debtProceeds: pathway === "church-led" ? 8_000_000 : 10_000_000,
      grantsSubsidy: 3_000_000,
      otherFunding: 0,
    },
    cost: {
      hardCost: 12_096_000,
      softCost: 2_177_280,
      siteInfrastructure: 1_500_000,
      contingency: 1_141_862,
      financingCarry: 450_000,
      land: pathway === "church-led" ? 1_800_000 : 0,
      totalDevelopmentCost: pathway === "church-led" ? 19_165_142 : 17_365_142,
    },
    operating: {
      homes: 42,
      affordableHomes: 17,
      marketHomes: 25,
      grossPotentialRevenue: 736_128,
      effectiveGrossRevenue: 684_599,
      operatingExpenses: 239_610,
      netOperatingIncome: 444_989,
      noiPerHome: 10_594,
      noiYieldOnCostPct: 2.3,
    },
    funding: {
      sources: [
        {
          key: "churchContribution",
          label: "Church contribution",
          amount: pathway === "church-led" ? 3_500_000 : 0,
        },
        {
          key: "partnerContribution",
          label: "Partner contribution",
          amount: pathway === "church-led" ? 0 : 2_000_000,
        },
        {
          key: "debtProceeds",
          label: "Debt proceeds",
          amount: pathway === "church-led" ? 8_000_000 : 10_000_000,
        },
        {
          key: "grantsSubsidy",
          label: "Grants & subsidy (unattributed)",
          amount: 3_000_000,
        },
        { key: "otherFunding", label: "Other funding", amount: 0 },
      ],
      identifiedCapital: pathway === "church-led" ? 14_500_000 : 15_000_000,
      fundingGap: pathway === "church-led" ? 4_665_142 : 2_365_142,
      gapPctOfCost: pathway === "church-led" ? 24.3 : 13.6,
    },
    sensitivity: [
      {
        variantId: "base",
        label: "Base",
        change: "as entered",
        totalDevelopmentCost: 19_165_142,
        deltaTotalCost: 0,
        fundingGap: 4_665_142,
        deltaFundingGap: 0,
        netOperatingIncome: 444_989,
        deltaNetOperatingIncome: 0,
      },
      {
        variantId: "hard-cost-plus-10",
        label: "Hard cost +10%",
        change: "hard cost per sq ft × 1.10",
        totalDevelopmentCost: 20_532_270,
        deltaTotalCost: 1_367_128,
        fundingGap: 6_032_270,
        deltaFundingGap: 1_367_128,
        netOperatingIncome: 444_989,
        deltaNetOperatingIncome: 0,
      },
      {
        variantId: "revenue-minus-10",
        label: "Revenue −10%",
        change: "annual revenue per home × 0.90",
        totalDevelopmentCost: 19_165_142,
        deltaTotalCost: 0,
        fundingGap: 4_665_142,
        deltaFundingGap: 0,
        netOperatingIncome: 400_491,
        deltaNetOperatingIncome: -44_498,
      },
      {
        variantId: "occupancy-minus-5",
        label: "Occupancy −5 pts",
        change: "occupancy − 5 percentage points",
        totalDevelopmentCost: 19_165_142,
        deltaTotalCost: 0,
        fundingGap: 4_665_142,
        deltaFundingGap: 0,
        netOperatingIncome: 421_089,
        deltaNetOperatingIncome: -23_900,
      },
      {
        variantId: "affordability-plus-10",
        label: "Affordability +10 pts",
        change: "affordability target + 10 percentage points",
        totalDevelopmentCost: 19_165_142,
        deltaTotalCost: 0,
        fundingGap: 4_665_142,
        deltaFundingGap: 0,
        netOperatingIncome: 423_439,
        deltaNetOperatingIncome: -21_550,
      },
    ],
    expertRequired: [
      {
        id: "expert:professional-cost-estimate",
        title: "Professional cost estimate",
        detail: "detail",
      },
      {
        id: "expert:gap-strategy",
        title: "Funding gap requires a capital strategy",
        detail: "detail",
      },
    ],
    councilProjection: [
      "The HOUSING MAX scenario (42 homes, 17 of them affordable at the current target) carries a preliminary total development cost of $19,165,142.",
      "Identified funding covers $14,500,000, leaving a preliminary gap of $4,665,142 (24.3% of cost).",
      "Third sentence.",
      "Fourth sentence.",
    ],
    scenarios: [
      {
        scenarioId: "scenario:solver:housing-max:test01",
        certificateId: "scenario:solver:housing-max:test01:certificate",
        label: "HOUSING MAX",
        homes: 42,
        freshness: "CURRENT",
      },
      {
        scenarioId: "scenario:solver:low-change:test02",
        certificateId: "scenario:solver:low-change:test02:certificate",
        label: "LOW CHANGE",
        homes: 21,
        freshness: "CURRENT",
      },
    ],
  };
}

describe("CapitalExplorer — one surface over server truth", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "acrevia.accepted-session",
      JSON.stringify(PAIR),
    );
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders only server-derived numbers: fingerprint, certificate, PRELIMINARY, gap, sensitivity, expert items", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(fixture("church-led", "a".repeat(64))), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<CapitalExplorer />);

    const fingerprint = await screen.findByTestId("capital-fingerprint");
    expect(fingerprint.textContent).toContain("aaaaaaaaaaaaaaaa");
    expect(
      screen.getAllByTestId("capital-preliminary").length,
    ).toBeGreaterThanOrEqual(1);
    const gap = screen.getByTestId("capital-gap");
    expect(gap.textContent).toContain("$4,665,142");
    expect(screen.getByTestId("capital-sensitivity")).toBeTruthy();
    expect(screen.getByTestId("capital-expert-required").textContent).toContain(
      "Funding gap requires a capital strategy",
    );
    expect(screen.getByTestId("capital-council").textContent).toContain(
      "HOUSING MAX scenario",
    );
    // The gap short-amount and certificate freshness come from the response only.
    expect(screen.getByTestId("capital-basis").textContent).toContain(
      "CURRENT",
    );
  });

  it("switching the ownership pathway re-POSTs to the same trusted route (never computes locally)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          pathway?: string;
        };
        const payload =
          body.pathway === "ground-lease"
            ? fixture("ground-lease", "b".repeat(64))
            : fixture("church-led", "a".repeat(64));
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CapitalExplorer />);
    await screen.findByTestId("capital-fingerprint");

    fireEvent.click(screen.getByTestId("pathway-ground-lease"));

    await waitFor(() => {
      expect(screen.getByTestId("capital-fingerprint").textContent).toContain(
        "bbbbbbbbbbbbbbbb",
      );
    });
    const calls = fetchMock.mock.calls as Array<[unknown, RequestInit?]>;
    const lastBody = JSON.parse(String(calls[calls.length - 1]?.[1]?.body)) as {
      envelope: unknown;
      receipt: unknown;
      commands: unknown;
      pathway: string;
    };
    expect(lastBody.pathway).toBe("ground-lease");
    expect(lastBody.envelope).toBeDefined();
    expect(lastBody.receipt).toBeDefined();
    expect(Array.isArray(lastBody.commands)).toBe(true);
    // The gap re-renders from the new server result — pathway economics moved.
    await waitFor(() => {
      expect(screen.getByTestId("capital-gap").textContent).toContain(
        "$2,365,142",
      );
    });
  });
});
