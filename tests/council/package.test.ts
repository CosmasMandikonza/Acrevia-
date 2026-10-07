import { describe, expect, it } from "vitest";
import {
  acceptedPair,
  CANONICAL_MISSION_COMMANDS,
  copilotContextFor,
} from "../copilot/helpers";
import {
  buildCouncilPackage,
  COUNCIL_AUDIENCES,
  type CouncilPackage,
} from "../../src/application/council/package";

/**
 * Issue #13 — the ONE deterministic Council assembly.
 *
 * Same harness discipline as tests/capital and tests/copilot: a REAL
 * committed canonical session with the canonical mission commands, pushed
 * through the same trusted rebuild (buildTrustedProofContext) the route
 * uses. These tests hold the core Council invariant: five audiences, one
 * fact table, zero factual drift.
 */

async function assemble(
  commands = CANONICAL_MISSION_COMMANDS,
  options: Parameters<typeof buildCouncilPackage>[1] = {},
): Promise<CouncilPackage> {
  const pair = await acceptedPair();
  const { trusted } = await copilotContextFor(pair, commands);
  const assembly = buildCouncilPackage(trusted, options);
  if (assembly.status !== "assembled") {
    throw new Error(`assembly failed: ${assembly.status}`);
  }
  return assembly.package;
}

describe("buildCouncilPackage — projection over trusted state", () => {
  it("selects MISSION BALANCE by default and pins its certificate", async () => {
    const pkg = await assemble();
    expect(pkg.selected.scenarioLabel).toBe("MISSION BALANCE");
    expect(pkg.freshness.status).toBe("CURRENT");
    expect(pkg.certificate.freshness).toBe("CURRENT");
    expect(pkg.certificate.certificateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.scenarios.length).toBeGreaterThan(1);
  });

  it("is deterministic: one trusted context assembles byte-identically", async () => {
    const pair = await acceptedPair();
    const { trusted } = await copilotContextFor(
      pair,
      CANONICAL_MISSION_COMMANDS,
    );
    const first = buildCouncilPackage(trusted, {});
    const second = buildCouncilPackage(trusted, {});
    expect(first.status).toBe("assembled");
    expect(second.status).toBe("assembled");
    if (first.status !== "assembled" || second.status !== "assembled") return;
    expect(canonical(first.package)).toBe(canonical(second.package));
    expect(first.package.packageFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the package fingerprint when the scenario changes", async () => {
    const pkg = await assemble();
    const other = pkg.scenarios.find(
      (scenario) => scenario.scenarioId !== pkg.selected.scenarioId,
    );
    expect(other).toBeDefined();
    const switched = await assemble(CANONICAL_MISSION_COMMANDS, {
      scenarioId: other?.scenarioId,
    });
    expect(switched.selected.scenarioId).toBe(other?.scenarioId);
    expect(switched.packageFingerprint).not.toBe(pkg.packageFingerprint);
  });

  it("changes the package fingerprint when a mission rule changes", async () => {
    const withCapital = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "church-led" },
    });
    // Same scenario, one fewer mission rule → different certificate/revision
    // identity → different package fingerprint.
    const fewer = await assemble(CANONICAL_MISSION_COMMANDS.slice(0, 2), {
      capital: { pathway: "church-led" },
    });
    expect(fewer.packageFingerprint).not.toBe(withCapital.packageFingerprint);
  });

  it("folds the Capital fingerprint in, and capital absence is visible", async () => {
    const without = await assemble();
    const withCapital = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "church-led" },
    });
    expect(without.capital).toBeNull();
    expect(withCapital.capital).not.toBeNull();
    expect(withCapital.packageFingerprint).not.toBe(without.packageFingerprint);
    expect(withCapital.capital?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(withCapital.facts["total-development-cost"]?.value).toBe(
      withCapital.capital?.totalDevelopmentCost,
    );
    const groundLease = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "ground-lease" },
    });
    expect(groundLease.capital?.fingerprint).not.toBe(
      withCapital.capital?.fingerprint,
    );
  });

  it("carries exactly the five audiences, every emphasis factKey resolved", async () => {
    const pkg = await assemble();
    expect(Object.keys(pkg.audienceViews).sort()).toEqual(
      [...COUNCIL_AUDIENCES].sort(),
    );
    for (const audience of COUNCIL_AUDIENCES) {
      const view = pkg.audienceViews[audience];
      for (const item of view.emphasis) {
        expect(
          pkg.facts[item.factKey],
          `${audience}:${item.factKey}`,
        ).toBeDefined();
      }
    }
  });

  it("THE invariant: no audience copy drifts from the fact table", async () => {
    const pkg = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "church-led" },
    });
    const homes = pkg.facts["homes"].value;
    const parking = pkg.facts["parking"].value; // e.g. "86 spaces"
    const parkingNumber = parking.replace(" spaces", "");
    for (const audience of COUNCIL_AUDIENCES) {
      const view = pkg.audienceViews[audience];
      const text = [view.headline, ...view.lead, view.cta].join(" ");
      const homesMentions = text.match(/(\d[\d,]*) homes/g) ?? [];
      expect(homesMentions.length, audience).toBeGreaterThan(0);
      for (const mention of homesMentions) {
        expect(mention, `${audience} homes drift`).toBe(`${homes} homes`);
      }
      const spaceMentions = text.match(/(\d[\d,]*) spaces/g) ?? [];
      for (const mention of spaceMentions) {
        expect(mention, `${audience} parking drift`).toBe(
          `${parkingNumber} spaces`,
        );
      }
    }
  });

  it("frames each audience from the same state without inventing claims", async () => {
    const pkg = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "church-led" },
    });
    // Pastor: stewardship — the sanctuary the congregation actually protected.
    expect(pkg.mission.preservedStructureLabels.length).toBeGreaterThan(0);
    expect(pkg.audienceViews.pastoral.headline).toContain("The church stays.");
    // Neighbor: conceptual-not-decided language, scale first.
    expect(pkg.audienceViews.neighbor.lead.join(" ")).toContain(
      "feasibility study, not a plan",
    );
    // City/council: the zoning basis is explicit.
    expect(pkg.audienceViews.council.headline).toContain(pkg.project.district);
    expect(pkg.audienceViews.council.cta).toContain("not a permit application");
    // Professional: certificate identity is on the surface.
    expect(pkg.audienceViews.professional.headline).toContain("Certificate");
    expect(pkg.audienceViews.professional.detail).toBe("audit");
    // Board: the next decision IS the board's call to action.
    expect(pkg.audienceViews.board.cta).toBe(pkg.nextDecision.headline);
  });

  it("next decision is a deterministic ladder: blocking reviews first", async () => {
    const pkg = await assemble(CANONICAL_MISSION_COMMANDS, {
      capital: { pathway: "church-led" },
    });
    const blocking = pkg.evidence.expertReviews.filter(
      (review) =>
        review.severity === "blocking" && review.reviewStatus === "OPEN",
    );
    if (blocking.length > 0) {
      expect(pkg.nextDecision.blockers.length).toBeGreaterThan(0);
      expect(pkg.nextDecision.headline).toContain("blocking");
    } else {
      // Canonical benchmark state seeds open questions; if that ever changes,
      // the ladder must fall through to capital, never to a fabricated decision.
      expect(pkg.nextDecision.headline.length).toBeGreaterThan(0);
    }
  });

  it("facts match the deterministic solve for the selected scenario", async () => {
    const pair = await acceptedPair();
    const { trusted } = await copilotContextFor(
      pair,
      CANONICAL_MISSION_COMMANDS,
    );
    const assembly = buildCouncilPackage(trusted, {});
    expect(assembly.status).toBe("assembled");
    if (assembly.status !== "assembled") return;
    const balance = trusted.solve.scenarios.find(
      (scenario) => scenario.label === "MISSION BALANCE",
    );
    expect(balance).toBeDefined();
    expect(assembly.package.selected.homes).toBe(balance?.point.homes);
    expect(assembly.package.facts["homes"].value).toBe(
      balance?.point.homes.toLocaleString("en-US"),
    );
    expect(assembly.package.facts["height-limit"].value).toBe(
      `${trusted.solve.geometry.heightCeilingFt.toLocaleString("en-US")} ft`,
    );
  });

  it("fails closed on a foreign scenario id", async () => {
    const pair = await acceptedPair();
    const { trusted } = await copilotContextFor(
      pair,
      CANONICAL_MISSION_COMMANDS,
    );
    const assembly = buildCouncilPackage(trusted, {
      scenarioId: "scenario:solver:foreign:deadbeef",
    });
    expect(assembly.status).toBe("stale-scenario");
    if (assembly.status === "stale-scenario") {
      expect(assembly.scenarios.length).toBeGreaterThan(0);
      expect(assembly.reason).toContain("never presents");
    }
  });
});

function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortDeep(record[key])]),
    );
  }
  return value;
}
