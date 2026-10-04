import { test, expect } from "@playwright/test";

test("canonical Philadelphia resolution flow renders progressively", async ({ page }) => {
  await page.goto("http://localhost:3114/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site");
  await expect(page.getByRole("textbox")).toBeVisible();

  // One click resolves the pre-filled address.
  await page.getByRole("button", { name: /resolve property/i }).click();

  // Single registry match: the confirmation panel appears (never a silent pick).
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/US Census Geocoder/i)).toBeVisible();
  await expect(page.getByText(/tiger-interpolated/i)).toBeVisible();

  await page.screenshot({ path: "test-results/gis-resolution-1-confirm.png" });

  // Accept the property → confirm + context + atomic graph commit.
  await page.getByRole("button", { name: /accept this property/i }).click();

  // The committed state shows the graph summary with Calvary + RM-1.
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/RM-1/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Development Graph project/i)).toBeVisible({ timeout: 30000 });

  await page.screenshot({ path: "test-results/gis-resolution-2-accepted.png" });
});
