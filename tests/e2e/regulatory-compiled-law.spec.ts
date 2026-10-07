import { test, expect } from "@playwright/test";

/**
 * COMPILED LAW browser journey (issue #5): after accepting the canonical
 * Calvary property, the Evidence surface shows the compiled, executable law
 * with values, locators, sources, and evidence states — and honest
 * unresolved dimensions. Screenshots under docs/reviews/issue-5/.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const REVIEWS = "docs/reviews/issue-5";

test.describe.configure({ mode: "serial" });

test("accepted property shows compiled executable law on the Evidence surface", async ({ page }) => {
  test.slow();
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 60_000,
  });
  // LIVE tiers can transiently fail; retry like a user would.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const failure = page.locator('p[role="alert"]');
    if ((await failure.count()) > 0) {
      await page.getByRole("button", { name: /try again/i }).click();
      await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
        timeout: 90_000,
      });
    } else {
      break;
    }
  }
  if ((await page.getByText(/zoning layer unavailable/i).count()) > 0) {
    await page.getByRole("button", { name: /resolve property/i }).click();
    await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
      timeout: 90_000,
    });
  }
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: /^Evidence$/ }).click();
  const compiledLaw = page.locator('section[aria-label="Compiled law"]');
  await expect(compiledLaw).toBeVisible({ timeout: 20_000 });

  // Executable rules render with values and provenance.
  const rules = compiledLaw.locator('[data-testid="compiled-law-rule"]');
  await expect(rules.first()).toBeVisible({ timeout: 15_000 });
  expect(await rules.count()).toBeGreaterThan(8);
  await expect(compiledLaw.getByText(/38 ft maximum height/)).toBeVisible();
  await expect(compiledLaw.getByText(/0 spaces required/)).toBeVisible();
  await expect(compiledLaw.getByText(/VERIFIED/).first()).toBeVisible();
  await expect(compiledLaw.getByText(/SOURCE CONFIRMED/).first()).toBeVisible();
  await expect(compiledLaw.getByText(/Table 14-701-2/).first()).toBeVisible();

  // Honest unresolved dimensions.
  await expect(compiledLaw.getByText(/Unresolved: far/i)).toBeVisible();

  await page.screenshot({ path: `${REVIEWS}/compiled-law-1-evidence.png`, fullPage: false });
});
