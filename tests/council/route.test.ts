import { describe, expect, it } from "vitest";
import { POST as councilPost } from "../../src/app/api/council/package/route";
import { acceptedPair } from "../copilot/helpers";
import {
  capitalFingerprint,
  evaluateCapital,
} from "../../src/application/capital/calculate";
import { normalizeAssumptions } from "../../src/application/capital/schema";
import type { CouncilPackage } from "../../src/application/council/package";

/**
 * Issue #13 — the ONE trusted council route.
 *
 * Same harness discipline as tests/capital: a REAL committed canonical
 * session, so every assertion exercises the actual trust boundary
 * (verify → hash-gate → compile → replay → solve → record) that
 * /api/proof/snapshot uses, plus the council stale gates on top.
 */

type AssembledPayload = { status: "ASSEMBLED"; package: CouncilPackage };

async function post(body: Record<string, unknown>): Promise<Response> {
  return councilPost(
    new Request("http://localhost/api/council/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function assembled(
  overrides: Record<string, unknown> = {},
  commands: unknown = [],
): Promise<AssembledPayload> {
  const { envelope, receipt } = await acceptedPair();
  const response = await post({
    envelope,
    receipt: receipt as object,
    commands,
    ...overrides,
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as AssembledPayload;
  expect(payload.status).toBe("ASSEMBLED");
  return payload;
}

describe("POST /api/council/package — trusted pipeline", () => {
  it("assembles the package over the current certified scenario", async () => {
    const payload = await assembled({ pathway: "church-led" });
    const pkg = payload.package;
    expect(pkg.selected.scenarioLabel).toBe("MISSION BALANCE");
    expect(pkg.freshness.status).toBe("CURRENT");
    expect(pkg.certificate.freshness).toBe("CURRENT");
    expect(pkg.packageFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(pkg.audienceViews).length).toBe(5);
    expect(pkg.selected.homes).toBeGreaterThan(0);
    // Capital evaluated the SAME scenario the narrative presents.
    expect(pkg.capital).not.toBeNull();
    const expected = capitalFingerprint({
      scenarioId: pkg.selected.scenarioId,
      certificateId: pkg.certificate.id,
      pathway: "church-led",
      assumptions: normalizeAssumptions("church-led", {}),
    });
    expect(pkg.capital?.fingerprint).toBe(expected);
  });

  it("capital is optional: no pathway ships an honest null", async () => {
    const payload = await assembled();
    expect(payload.package.capital).toBeNull();
    expect(payload.package.facts["total-development-cost"]).toBeUndefined();
    // The canonical state carries blocking reviews, so the decision ladder
    // correctly leads there; with no blockers it would lead to capital.
    expect(payload.package.nextDecision.headline).toMatch(/blocking|capital/);
  });

  it("is deterministic: identical requests assemble identical packages", async () => {
    const { envelope, receipt } = await acceptedPair();
    const body = {
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
    };
    const [first, second] = await Promise.all([post(body), post(body)]);
    const a = (await first.json()) as AssembledPayload;
    const b = (await second.json()) as AssembledPayload;
    expect(a.package.packageFingerprint).toBe(b.package.packageFingerprint);
    expect(JSON.stringify(a.package)).toBe(JSON.stringify(b.package));
  });

  it("switching the scenario changes the package fingerprint", async () => {
    const base = await assembled({ pathway: "church-led" });
    const other = base.package.scenarios.find(
      (scenario) => scenario.scenarioId !== base.package.selected.scenarioId,
    );
    const switched = await assembled({
      pathway: "church-led",
      scenarioId: other?.scenarioId,
    });
    expect(switched.package.selected.scenarioId).toBe(other?.scenarioId);
    expect(switched.package.selected.homes).toBe(other?.homes);
    expect(switched.package.packageFingerprint).not.toBe(
      base.package.packageFingerprint,
    );
  });

  it("capital assumptions are bounded by the shared capital schema", async () => {
    const { envelope, receipt } = await acceptedPair();
    const rejected = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "church-led",
      assumptions: { hardCostPerSqFt: 1_000_000 },
    });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { name: string }).name).toBe(
      "InvalidCapitalAssumptions",
    );
  });
});

describe("POST /api/council/package — fail-closed gates", () => {
  it("rejects a foreign scenario id as stale (council never presents it)", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      scenarioId: "scenario:solver:foreign:deadbeef",
    });
    expect(response.status).toBe(200); // recoverable, not a crash
    const payload = (await response.json()) as {
      status: string;
      reason: string;
      scenarios: Array<{ scenarioId: string; label: string }>;
    };
    expect(payload.status).toBe("stale-scenario");
    expect(payload.scenarios.length).toBeGreaterThan(0);
    expect(payload.reason).toContain("never presents");
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
    expect(((await response.json()) as { name: string }).name).toBe(
      "PairVerificationError",
    );
  });

  it("requires the accepted pair", async () => {
    const response = await post({ commands: [], pathway: "church-led" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("envelope, receipt");
  });

  it("validates the ownership pathway", async () => {
    const { envelope, receipt } = await acceptedPair();
    const response = await post({
      envelope,
      receipt: receipt as object,
      commands: [],
      pathway: "sell-everything",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { name: string }).name).toBe(
      "InvalidPathway",
    );
  });

  it("capital numbers equal the pure engine on the same facts", async () => {
    const payload = await assembled({ pathway: "ground-lease" });
    const pkg = payload.package;
    const facts = {
      scenarioId: pkg.selected.scenarioId,
      certificateId: pkg.certificate.id,
      scenarioLabel: pkg.selected.scenarioLabel,
      homes: pkg.selected.homes,
      floors: pkg.selected.floors,
      footprintSqFt: pkg.selected.footprintSqFt,
      parkingStalls: pkg.selected.parkingStalls,
    };
    const direct = evaluateCapital(facts, "ground-lease", {});
    expect(pkg.capital?.totalDevelopmentCost).toBe(
      `$${Math.round(direct.cost.totalDevelopmentCost).toLocaleString("en-US")}`,
    );
    expect(pkg.capital?.fundingGap).toBe(
      `$${Math.round(direct.funding.fundingGap).toLocaleString("en-US")}`,
    );
  });
});
