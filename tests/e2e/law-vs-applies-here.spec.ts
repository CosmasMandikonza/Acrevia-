import { test, expect } from "@playwright/test";

/**
 * LAW vs APPLIES HERE browser regression (PR #28 final closeout): the
 * compiled-law rows must show the LEGAL source (Quick Guide / adopted code)
 * as LAW and the site's own GIS zoning claim as APPLIES HERE — never the
 * first arbitrary claim from the dependency closure.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;

test("compiled law rows separate LAW provenance from APPLIES HERE provenance", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(CANONICAL);
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
  const compiledLaw = page.locator('section[aria-label="Compiled law"]');
  await expect(compiledLaw).toBeVisible({ timeout: 20_000 });
  const rules = compiledLaw.locator('[data-testid="compiled-law-rule"]');
  await expect(rules.first()).toBeVisible({ timeout: 20_000 });

  // Every rule shows BOTH strands.
  const lawRows = compiledLaw.locator('[data-testid="law-provenance"]');
  const appliesRows = compiledLaw.locator('[data-testid="applies-here"]');
  await expect(lawRows.first()).toBeVisible();
  await expect(appliesRows.first()).toBeVisible();
  expect(await lawRows.count()).toBeGreaterThan(5);
  expect(await appliesRows.count()).toBeGreaterThan(5);

  // LAW is the legal text source — never the zoning GIS layer.
  const lawText = (await lawRows.allTextContents()).join(" ");
  expect(lawText).toContain("Quick Guide");
  expect(lawText).not.toContain("zoning GIS");

  // APPLIES HERE carries the district and the official GIS source.
  const appliesText = (await appliesRows.allTextContents()).join(" ");
  expect(appliesText).toContain("RM-1");
  expect(appliesText).toMatch(/zoning[_ ]?(gis|base)/i);

  await page.screenshot({ path: "docs/reviews/issue-5/compiled-law-4-law-vs-applies.png", fullPage: false });
});
