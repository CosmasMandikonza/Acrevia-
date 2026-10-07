import { test, expect, type Page } from "@playwright/test";

/**
 * Scenario Solver journey (issue #7) on the canonical Calvary property.
 *
 * resolve → accept → confirm the three canonical mission rules → Scenarios:
 * the solver computes LAW ∩ MISSION over the accepted project with INTEGER
 * HOMES as the decision variable (exact required footprints, derived parking
 * range, three independently computed modeled ceilings). The displayed
 * scenarios carry CURRENT ScenarioCertificates. A 70-home goal is supported
 * within modeled scope; a goal one above the modeled upper bound returns the
 * unmistakable NO VERIFIED SOLUTION panel with mechanically proven binding
 * constraints and nearest supported alternatives beneath. No number is
 * hard-coded — the bound is read from the page.
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

async function openScenarios(page: Page) {
  await page.getByRole("link", { name: "Scenarios" }).click();
  const solver = page.locator('section[aria-label="Scenario solver"]');
  await expect(solver.getByText("THREE MODELED CEILINGS, COMPUTED INDEPENDENTLY")).toBeVisible({
    timeout: 30_000,
  });
  return solver;
}

test.describe.configure({ mode: "serial" });

test("frontier renders three independent modeled ceilings and honest unknowns", async ({ page }) => {
  test.slow();
  await confirmCanonicalMissions(page);
  const solver = await openScenarios(page);

  // The three modeled ceilings, each with its own basis; the binding one named.
  await expect(solver.getByText("LEGAL DENSITY CAPACITY")).toBeVisible();
  await expect(solver.getByText("BUILDING MASSING CAPACITY")).toBeVisible();
  await expect(solver.getByText("PHYSICAL SITE AREA-BUDGET CEILING")).toBeVisible();
  await expect(solver.getByText(/BINDING — the tightest modeled truth/).first()).toBeVisible();
  await expect(solver.getByText(/Modeled capacity upper bound: \d+ homes/)).toBeVisible();
  // Area arithmetic is honest about what it does not prove.
  await expect(solver.getByText(/Area arithmetic does not prove physical placement/)).toBeVisible();

  // Frontier scenarios with presentation labels applied after the math.
  await expect(solver.getByText("HOUSING MAX", { exact: false })).toBeVisible();
  await expect(solver.getByText("MISSION BALANCE", { exact: false })).toBeVisible();
  await expect(solver.getByText("LOW CHANGE", { exact: false })).toBeVisible();

  // Every displayed scenario carries a CURRENT ScenarioCertificate.
  const certificates = solver.getByTestId("scenario-certificate");
  await expect(certificates.first()).toBeVisible({ timeout: 10_000 });
  const count = await certificates.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i += 1) {
    await expect(certificates.nth(i).getByText("CURRENT")).toBeVisible();
  }

  // Unknowns stay unknown — setbacks and the formula parking never default.
  await expect(solver.getByText(/front setback: EXPERT REQUIRED/).first()).toBeVisible();
  await expect(solver.getByText(/side setback: NOT EVALUATED/).first()).toBeVisible();

  // Assumptions are listed and pinned by every certificate.
  await expect(solver.getByText("ASSUMPTIONS — EVERY CERTIFICATE PINS THESE")).toBeVisible();

  await page.screenshot({ path: `${REVIEWS}/scenarios-1-frontier.png`, fullPage: true });
});

test("70 homes is supported within modeled scope — the goal test never rounds in the church's favor", async ({
  page,
}) => {
  test.slow();
  await confirmCanonicalMissions(page);
  const solver = await openScenarios(page);

  await solver.getByLabel("Homes to test").fill("70");
  await solver.getByRole("button", { name: "Prove it" }).click();
  await expect(solver.getByText("SUPPORTED SCENARIOS WITHIN MODELED SCOPE")).toBeVisible({
    timeout: 30_000,
  });
  // A 70-home goal presents the frontier at or above the goal.
  const homesText = await solver.getByText(/homes$/).first().textContent();
  expect(Number(/(\d+)/.exec(homesText ?? "")?.[1] ?? 0)).toBeGreaterThanOrEqual(70);
  await expect(solver.getByTestId("no-verified-solution")).toHaveCount(0);
  // Certificates remain CURRENT on the goal solve.
  await expect(solver.getByTestId("scenario-certificate").first().getByText("CURRENT")).toBeVisible();

  await page.screenshot({ path: `${REVIEWS}/scenarios-2-target-70-supported.png`, fullPage: true });
});

test("one above the modeled upper bound is NO VERIFIED SOLUTION — proven, with binding constraints and alternatives", async ({
  page,
}) => {
  test.slow();
  await confirmCanonicalMissions(page);
  const solver = await openScenarios(page);

  // The first refused target is one above the modeled upper bound; read the
  // bound from the page itself rather than hard-coding it.
  const overall = await solver
    .getByText(/Modeled capacity upper bound: (\d+) homes/)
    .first()
    .textContent();
  const bound = Number(/(\d+)/.exec(overall ?? "")?.[1] ?? 0);
  expect(bound).toBeGreaterThan(0);

  await solver.getByLabel("Homes to test").fill(String(bound + 1));
  await solver.getByRole("button", { name: "Prove it" }).click();

  const noSolution = solver.getByTestId("no-verified-solution");
  await expect(noSolution).toBeVisible({ timeout: 30_000 });
  await expect(noSolution.getByText("NO VERIFIED SOLUTION")).toBeVisible();
  await expect(
    noSolution.getByText(/cannot be built on this parcel within the law and the church/),
  ).toBeVisible();
  await expect(noSolution.getByText(/modeled upper bound is/)).toBeVisible();
  await expect(
    noSolution.getByText("WHAT CLOSES THE DOOR — MECHANICALLY PROVEN"),
  ).toBeVisible();
  // Mission-locked constraints are labeled, never proposed for removal.
  await expect(
    noSolution.getByText(/MISSION-LOCKED — never proposed for removal/).first(),
  ).toBeVisible();
  // Relaxation proof shows the capacity delta from the shared-model re-solve.
  await expect(noSolution.getByText(/unlocks\s+\+\d+ homes/).first()).toBeVisible();
  // Nearest supported alternatives appear beneath the refusal.
  await expect(
    solver.getByText("NEAREST SUPPORTED ALTERNATIVES BENEATH THE GOAL"),
  ).toBeVisible();

  // Ceilings are always whole HOMES — a square-footage value mislabeled as
  // homes (e.g. "49,433.715 homes") is a units bug and must never render.
  await expect(solver.getByText(/\d[\d,]*\.\d+ homes/)).toHaveCount(0);

  await page.screenshot({ path: `${REVIEWS}/scenarios-3-no-solution.png`, fullPage: true });
});
