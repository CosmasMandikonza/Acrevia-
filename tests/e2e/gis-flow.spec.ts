import { test, expect } from "@playwright/test";

test("canonical Philadelphia resolution with visible map layers", async ({ page }) => {
  await page.goto("http://localhost:3121/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site");
  await expect(page.getByRole("textbox")).toBeVisible();

  await page.getByRole("button", { name: /resolve property/i }).click();

  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/US Census Geocoder/i)).toBeVisible();

  const map = page.locator("[aria-label*='Property resolution map']");
  await expect(map).toHaveAttribute("data-acrevia-layers", /hint-point/, { timeout: 15000 });
  await expect(map).toHaveAttribute("data-acrevia-layers", /parcel-fill/);

  await page.screenshot({ path: "test-results/gis-resolution-1-confirm.png" });

  await page.getByRole("button", { name: /accept this property/i }).click();

  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/RM-1/i).first()).toBeVisible({ timeout: 30000 });
  await expect(map).toHaveAttribute("data-acrevia-layers", /structure-fill/, { timeout: 15000 });

  await page.screenshot({ path: "test-results/gis-resolution-2-accepted.png" });
});

test("Acrevia data layers survive basemap unavailability", async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 404, body: "blocked for test" }),
  );

  await page.goto("http://localhost:3121/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site");
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 30000 });

  const map = page.locator("[aria-label*='Property resolution map']");
  await expect(map).toHaveAttribute("data-acrevia-layers", /hint-point/, { timeout: 15000 });
  await expect(map).toHaveAttribute("data-acrevia-layers", /parcel-fill/);
  await expect(page.getByText(/US Census Geocoder/i)).toBeVisible();

  await page.screenshot({ path: "test-results/gis-resolution-3-neutral.png" });
});
