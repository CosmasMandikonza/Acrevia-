import { describe, expect, it } from "vitest";
import { POST as capitalPost } from "../../src/app/api/capital/evaluate/route";
import { acceptedPair } from "../copilot/helpers";

/**
 * Issue #12 — the ONE trusted capital route.
 *
 * Same harness discipline as tests/proof and tests/copilot: a REAL committed
 * canonical session (signed envelope + receipt), so every assertion exercises
 * the actual trust boundary (verify → hash-gate → compile → replay → solve →
 * record) that /api/proof/snapshot uses, plus the capital gates on top.
 */

type EvaluatedPayload = {
  status: "EVALUATED";
  fingerprint: string;
  engineVersion: string;
  scenario: {
    scenarioId: string;
    certificateId: string;
    scenarioLabel: string;
    homes: number;
    floors: number;
    footprintSqFt: number;
    grossResidentialSqFt: number;
    freshness: string;
    solverVersion: string;
  };
  pathway: {
    id: string;
    label: string;
    tagline: string;
    ownershipNote: string;
  };
  assumptions: Record<string, number> & { opexMode: string };
  cost: { totalDevelopmentCost: number; hardCost: number; land: number };
  operating: { netOperatingIncome: number; affordableHomes: number };
  funding: { identifiedCapital: number; fundingGap: number };
  sensitivity: Array<{ variantId: string; deltaTotalCost: number }>;
  expertRequired: Array<{ id: string }>;
  councilProjection: string[];
  scenarios: Array<{
    scenarioId: string;
    label: string;
    homes: number;
    freshness: string;
  }>;
};

async function post(body: Record<string, unknown>): Promise<Response> {
  return capitalPost(
    new Request("http://localhost/api/capital/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/capital/evaluate — trusted pipeline", () => {
  it("evaluates the current recorded scenario over the verified accepted pair", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as EvaluatedPayload;

    expect(payload.status).toBe("EVALUATED");
    // Scenario facts come from the CURRENT certificate-pinned rebuild.
    expect(payload.scenario.homes).toBeGreaterThan(0);
    expect(payload.scenario.grossResidentialSqFt).toBe(
      payload.scenario.footprintSqFt * payload.scenario.floors,
    );
    expect(payload.scenario.freshness).toBe("CURRENT");
    expect(payload.scenario.scenarioLabel).toBe("HOUSING MAX"); // first recorded scenario
    expect(payload.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.engineVersion).toBe("capital/preliminary-v1");
    expect(payload.sensitivity.map((row) => row.variantId)).toHaveLength(5);
    expect(payload.expertRequired.length).toBeGreaterThanOrEqual(2);
    expect(payload.scenarios.length).toBeGreaterThanOrEqual(1);
    // Deterministic numbers from the canonical scenario — sanity, not fixture-copying.
    expect(payload.cost.totalDevelopmentCost).toBeGreaterThan(0);
    expect(payload.cost.totalDevelopmentCost).toBe(
      payload.cost.hardCost +
        Math.round(payload.cost.hardCost * 0.18) +
        Math.round(
          (payload.cost.hardCost + Math.round(payload.cost.hardCost * 0.18)) *
            0.08,
        ) +
        payload.assumptions.siteInfrastructure +
        payload.assumptions.financingCarry +
        payload.assumptions.landCost,
    );
  });

  it("is deterministic: identical requests produce the identical fingerprint", async () => {
    const { envelope, receipt } = await acceptedPair();
    const body = {
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
    };
    const [first, second] = await Promise.all([post(body), post(body)]);
    const a = (await first.json()) as EvaluatedPayload;
    const b = (await second.json()) as EvaluatedPayload;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.cost.totalDevelopmentCost).toBe(b.cost.totalDevelopmentCost);
  });

  it("ownership pathway changes scenario economics (AC3) and the fingerprint", async () => {
    const { envelope, receipt } = await acceptedPair();
    const churchLed = (await (
      await post({
        envelope,
        receipt: receipt as object,
        commands: [],
        pathway: "church-led",
      })
    ).json()) as EvaluatedPayload;
    const groundLease = (await (
      await post({
        envelope,
        receipt: receipt as object,
        commands: [],
        pathway: "ground-lease",
      })
    ).json()) as EvaluatedPayload;

    expect(churchLed.cost.land).toBe(1_800_000);
    expect(groundLease.cost.land).toBe(0);
    expect(groundLease.funding.identifiedCapital).not.toBe(
      churchLed.funding.identifiedCapital,
    );
    expect(groundLease.fingerprint).not.toBe(churchLed.fingerprint);
    // Same engine → same operating sketch regardless of pathway.
    expect(groundLease.operating.netOperatingIncome).toBe(
      churchLed.operating.netOperatingIncome,
    );
  });

  it("applies bounded assumption overrides (AC2) and re-derives every number", async () => {
    const { envelope, receipt } = await acceptedPair();
    const base = (await (
      await post({
        envelope,
        receipt: receipt as object,
        commands: [],
        pathway: "church-led",
      })
    ).json()) as EvaluatedPayload;
    const raised = (await (
      await post({
        envelope,
        receipt: receipt as object,
        commands: [],
        pathway: "church-led",
        assumptions: { hardCostPerSqFt: 300, affordabilityTargetPct: 60 },
      })
    ).json()) as EvaluatedPayload;

    expect(raised.cost.hardCost).toBeGreaterThan(base.cost.hardCost);
    expect(raised.operating.affordableHomes).toBeGreaterThan(
      base.operating.affordableHomes,
    );
    expect(raised.fingerprint).not.toBe(base.fingerprint);
  });

  it("propagates numbers into the Council-readable projection (AC8)", async () => {
    const { envelope, receipt } = await acceptedPair();
    const payload = (await (
      await post({
        envelope,
        receipt: receipt as object,
        commands: [],
        pathway: "church-led",
      })
    ).json()) as EvaluatedPayload;
    expect(payload.councilProjection.length).toBe(4);
    const first = payload.councilProjection[0];
    expect(first).toContain(payload.scenario.scenarioLabel);
    expect(first).toContain(`${payload.scenario.homes} homes`);
    expect(first).toContain(
      payload.cost.totalDevelopmentCost.toLocaleString("en-US"),
    );
    // The gap sentence states the deterministic position.
    expect(payload.councilProjection.join(" ")).toMatch(
      /gap of \$|exactly matches|exceeds/,
    );
  });
});

describe("POST /api/capital/evaluate — fail-closed gates", () => {
  it("rejects a foreign scenarioId as STALE — capital never evaluates what it cannot re-certify", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
      scenarioId: "scenario:solver:housing-max:does-not-exist",
    });
    expect(response.status).toBe(200); // a legitimate, recoverable state — not a crash
    const payload = (await response.json()) as {
      status: string;
      reason: string;
      scenarios: EvaluatedPayload["scenarios"];
    };
    expect(payload.status).toBe("stale-scenario");
    expect(payload.reason).toContain("never evaluates");
    expect(payload.scenarios.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid pathway", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "lihtc-magic",
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; name: string };
    expect(payload.name).toBe("InvalidPathway");
  });

  it("rejects out-of-bounds and unknown assumption keys", async () => {
    const { envelope, receipt } = await acceptedPair();
    const base = {
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led" as const,
    };
    const negative = await post({
      ...base,
      assumptions: { hardCostPerSqFt: -5 },
    });
    expect(negative.status).toBe(400);
    expect(((await negative.json()) as { name: string }).name).toBe(
      "InvalidCapitalAssumptions",
    );

    const unknown = await post({ ...base, assumptions: { interestRate: 7 } });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { name: string }).name).toBe(
      "InvalidCapitalAssumptions",
    );
  });

  it("rejects a tampered envelope at the shared trust boundary", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope: { ...envelope, signature: "deadbeef" },
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { name: string };
    expect(payload.name).toBe("PairVerificationError");
  });

  it("requires the accepted pair and mission log", async () => {
    const response = await post({ pathway: "church-led", commands: [] });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("accepted { envelope, receipt } pair");
  });
});
