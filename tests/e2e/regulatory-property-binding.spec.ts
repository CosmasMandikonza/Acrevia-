import { test, expect } from "@playwright/test";

/**
 * PROPERTY A → PROPERTY B browser regression (issue #5 review): after
 * viewing Calvary's compiled law, accepting a different property (JFK /
 * 1400 John F Kennedy Blvd — a different district, no Calvary overlays)
 * must show an honest unavailable state and NEVER Calvary-specific facts,
 * footprints, overlays, or /SIX rules.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CALVARY = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const JFK = "1400 John F Kennedy Blvd, Philadelphia, PA";
const REVIEWS = "docs/reviews/issue-5";

test.describe.configure({ mode: "serial" });

test("Property B never inherits Calvary's compiled law or site facts", async ({ page }) => {
  test.setTimeout(420_000); // two full LIVE flows, first-time layers on a cold server

  // Property A: Calvary — compiled law visible.
  await page.goto(CALVARY);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 90_000 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await page.locator('p[role="alert"]').count()) > 0) {
      await page.getByRole("button", { name: /try again/i }).click();
      await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 90_000 });
    } else break;
  }
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /^Evidence$/ }).click();
  const lawA = page.locator('section[aria-label="Compiled law"]');
  await expect(lawA).toBeVisible({ timeout: 20_000 });
  await expect(lawA.getByTestId("compiled-law-rule").first()).toBeVisible({ timeout: 20_000 });
  await expect(lawA.getByText(/38 ft maximum height/)).toBeVisible();
  await page.screenshot({ path: `${REVIEWS}/compiled-law-2-property-a.png`, fullPage: false });

  // Property B: JFK — different district, no Calvary overlays. Depending on
  // the geocode side, JFK resolves through the parcel-ambiguity flow OR a
  // strong single match; handle both.
  await page.getByRole("link", { name: /^Site$/ }).click();
  await page.fill("#site-address", JFK);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await page.waitForFunction(
    () => /select yours|confirm this property|One strong match/i.test(document.body.innerText),
    null,
    { timeout: 150_000 },
  );
  if ((await page.getByRole("heading", { name: /select yours/i }).count()) > 0) {
    const parcelOptions = page.locator("section h3 + ul button");
    const preferred = parcelOptions.filter({ hasText: /kennedy/i });
    await (await preferred.count() > 0 ? preferred.first() : parcelOptions.first()).click();
    await page.getByRole("button", { name: /^confirm \d* ?parcel/i }).click();
  }
  await expect(page.getByRole("heading", { name: /confirm this property|One strong match/i })).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30_000 });

  // Evidence surface: honest unavailable state; NO Calvary law anywhere.
  await page.getByRole("link", { name: /^Evidence$/ }).click();
  const lawB = page.locator('section[aria-label="Compiled law"]');
  await expect(lawB).toBeVisible({ timeout: 20_000 });
  await expect(lawB.getByTestId("compiled-law-unavailable")).toBeVisible({ timeout: 20_000 });
  await expect(lawB.getByText(/will not apply another district/i)).toBeVisible();

  // Contamination checks: no Calvary-specific compiled rules or facts.
  await expect(lawB.getByTestId("compiled-law-rule")).toHaveCount(0);
  await expect(lawB.getByText(/38 ft maximum height/)).toHaveCount(0);
  await expect(lawB.getByText(/\/SIX/i)).toHaveCount(0);
  await expect(lawB.getByText(/Calvary/i)).toHaveCount(0);
  await expect(lawB.getByText(/119,?295/)).toHaveCount(0);
  await page.screenshot({ path: `${REVIEWS}/compiled-law-3-property-b.png`, fullPage: false });
});
