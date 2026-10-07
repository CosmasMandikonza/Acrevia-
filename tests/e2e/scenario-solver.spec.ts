import { test, expect, type Page } from "@playwright/test";

/**
 * Scenario Solver journey (issue #7) on the canonical Calvary property.
 *
 * resolve → accept → confirm the three canonical mission rules → Scenarios:
 * the solver computes LAW ∩ MISSION over the accepted project. The frontier
 * renders with three proven ceilings; a 70-home goal is proven FEASIBLE; a
 * 123-home goal returns the unmistakable NO VERIFIED SOLUTION panel with
 * mechanically proven binding constraints and nearest alternatives beneath.
 * The dramatic result must emerge from the truth — no number is hard-coded.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const CANONICAL_SENTENCE =
  "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We are not selling the land.";
const REVIEWS = "docs/reviews/issue-7";

async function resolveAndAccept(page: Page) {
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 60_000,
  });
  if ((await page.getByText(/zoning layer unavailable/i).count()) > 0) {
    await page.getByRole("button", { name: /resolve property/i }).click();
  }
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  const mission = page.locator('section[aria-label="Mission Compiler"]');
  await expect(mission).toBeVisible({ timeout: 15_000 });
  return mission;
}

async function confirmCanonicalMissions(page: Page) {
  const mission = await resolveAndAccept(page);
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(CANONICAL_SENTENCE);
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("WHAT ACREVIA UNDERSTOOD")).toBeVisible({ timeout: 10_000 });

  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("PRESERVE · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("SUNDAY PARKING · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  return mission;
}

test.describe.configure({ mode: "serial" });

test("frontier renders three proven ceilings and honest unknowns", async ({ page }) => {
  test.slow();
  await confirmCanonicalMissions(page);
  await page.getByRole("link", { name: "Scenarios" }).click();
  const solver = page.locator('section[aria-label="Scenario solver"]');
  await expect(solver.getByText("THREE CEILINGS, PROVEN SEPARATELY")).toBeVisible({
    timeout: 30_000,
  });

  // The three ceilings, each with its own basis, and the binding one named.
  await expect(solver.getByText("LEGAL DENSITY CAPACITY")).toBeVisible();
  await expect(solver.getByText("BUILDING MASSING CAPACITY")).toBeVisible();
  await expect(solver.getByText("PHYSICAL SITE CAPACITY")).toBeVisible();
  await expect(solver.getByText(/BINDING — the tightest truth/).first()).toBeVisible();
  await expect(solver.getByText(/Overall verified capacity: \d+ homes/)).toBeVisible();

  // Frontier scenarios with presentation labels applied after the math.
  await expect(solver.getByText("HOUSING MAX", { exact: false })).toBeVisible();
  await expect(solver.getByText("MISSION BALANCE", { exact: false })).toBeVisible();

  // Unknowns stay unknown — setbacks and the formula parking never default.
  await expect(solver.getByText(/front setback: EXPERT REQUIRED/).first()).toBeVisible();
  await expect(solver.getByText(/side setback: NOT EVALUATED/).first()).toBeVisible();
  await expect(solver.getByText(/NOT EVALUATED/, { exact: false }).first()).toBeVisible();

  // Assumptions are listed and pinned by every certificate.
  await expect(solver.getByText("ASSUMPTIONS — EVERY CERTIFICATE PINS THESE")).toBeVisible();

  await page.screenshot({ path: `${REVIEWS}/scenarios-1-frontier.png`, fullPage: true });
});

test("70 homes is proven feasible — the goal test never rounds in the church's favor", async ({
  page,
}) => {
  test.slow();
  await confirmCanonicalMissions(page);
  await page.getByRole("link", { name: "Scenarios" }).click();
  const solver = page.locator('section[aria-label="Scenario solver"]');
  await expect(solver.getByText("THREE CEILINGS, PROVEN SEPARATELY")).toBeVisible({
    timeout: 30_000,
  });

  await solver.getByLabel("Homes to test").fill("70");
  await solver.getByRole("button", { name: "Prove it" }).click();
  await expect(solver.getByText("VERIFIED SCENARIOS — THE PARETO FRONTIER")).toBeVisible({
    timeout: 30_000,
  });
  // A 70-home goal constrains the frontier to scenarios with ≥ 70 homes.
  const homesText = await solver.getByText(/homes$/).first().textContent();
  expect(Number(/(\d+)/.exec(homesText ?? "")?.[1] ?? 0)).toBeGreaterThanOrEqual(70);
  await expect(
    solver.getByTestId("no-verified-solution"),
  ).toHaveCount(0);

  await page.screenshot({ path: `${REVIEWS}/scenarios-2-target-70-feasible.png`, fullPage: true });
});

test("123 homes is NO VERIFIED SOLUTION — proven, with binding constraints and alternatives", async ({
  page,
}) => {
  test.slow();
  await confirmCanonicalMissions(page);
  await page.getByRole("link", { name: "Scenarios" }).click();
  const solver = page.locator('section[aria-label="Scenario solver"]');
  await expect(solver.getByText("THREE CEILINGS, PROVEN SEPARATELY")).toBeVisible({
    timeout: 30_000,
  });

  // The first impossible target is one above the proven maximum; assert the
  // maximum from the page itself rather than hard-coding 122.
  const overall = await solver
    .getByText(/Overall verified capacity: (\d+) homes/)
    .first()
    .textContent();
  const max = Number(/(\d+)/.exec(overall ?? "")?.[1] ?? 0);
  expect(max).toBeGreaterThan(0);

  await solver.getByLabel("Homes to test").fill(String(max + 1));
  await solver.getByRole("button", { name: "Prove it" }).click();

  const noSolution = solver.getByTestId("no-verified-solution");
  await expect(noSolution).toBeVisible({ timeout: 30_000 });
  await expect(noSolution.getByText("NO VERIFIED SOLUTION")).toBeVisible();
  await expect(
    noSolution.getByText(/cannot be built on this parcel within the law and the church/),
  ).toBeVisible();
  await expect(
    noSolution.getByText(/maximum proven feasible is/),
  ).toBeVisible();
  await expect(
    noSolution.getByText("WHAT CLOSES THE DOOR — MECHANICALLY PROVEN"),
  ).toBeVisible();
  // Mission-locked constraints are labeled, never proposed for removal.
  await expect(
    noSolution.getByText(/MISSION-LOCKED — never proposed for removal/).first(),
  ).toBeVisible();
  // Relaxation proof shows the capacity delta from the re-solve.
  await expect(
    noSolution.getByText(/unlocks\s+\+\d+ homes/).first(),
  ).toBeVisible();
  // Nearest verified alternatives appear beneath the refusal.
  await expect(
    solver.getByText("NEAREST VERIFIED ALTERNATIVES BENEATH THE GOAL"),
  ).toBeVisible();

  // Ceilings are always whole HOMES — a square-footage value mislabeled as
  // homes (e.g. "49,433.715 homes") is a units bug and must never render.
  await expect(solver.getByText(/\d[\d,]*\.\d+ homes/)).toHaveCount(0);

  await page.screenshot({ path: `${REVIEWS}/scenarios-3-no-solution.png`, fullPage: true });
});
