import { test, expect } from "@playwright/test";

test("canonical Philadelphia resolution renders visible geometry", async ({ page }) => {
  test.slow(); // LIVE provider layers can exceed the default budget under suite load
  await page.goto("http://localhost:3121/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site");
  await expect(page.getByRole("textbox")).toBeVisible();

  await page.getByRole("button", { name: /resolve property/i }).click();

  // Resolution completes — confirmation panel appears.
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/US Census Geocoder/i)).toBeVisible();

  // REAL rendered geometry: SVG fallback has actual parcel/hint DOM elements.
  await expect(page.getByTestId("parcel-geometry").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("geocode-hint")).toBeVisible({ timeout: 15000 });

  // The parcel path has actual SVG geometry (non-empty `d` attribute).
  const parcelPath = page.getByTestId("parcel-geometry").first();
  const d = await parcelPath.getAttribute("d");
  expect(d).toBeTruthy();
  expect(d!.length).toBeGreaterThan(10); // real polygon, not a degenerate point

  await page.screenshot({ path: "test-results/gis-resolution-1-confirm.png" });

  // Accept the property.
  await page.getByRole("button", { name: /accept this property/i }).click();

  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/RM-1/i).first()).toBeVisible({ timeout: 30000 });

  // Structure footprint is now rendered as real SVG geometry.
  await expect(page.getByTestId("structure-geometry").first()).toBeVisible({ timeout: 15000 });
  const structureD = await page.getByTestId("structure-geometry").first().getAttribute("d");
  expect(structureD).toBeTruthy();

  await page.screenshot({ path: "test-results/gis-resolution-2-accepted.png" });
});

test("verified geometry survives basemap unavailability (SVG fallback)", async ({ page }) => {
  test.slow(); // LIVE provider layers can exceed the default budget under suite load
  // Block OSM tiles to simulate basemap outage.
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 404, body: "blocked for test" }),
  );

  await page.goto("http://localhost:3121/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site");
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 30000 });

  // Acrevia geometry elements exist as real DOM/SVG, not just React intent.
  await expect(page.getByTestId("parcel-geometry").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("geocode-hint")).toBeVisible({ timeout: 15000 });

  // Evidence rail still populated.
  await expect(page.getByText(/US Census Geocoder/i)).toBeVisible();

  await page.screenshot({ path: "test-results/gis-resolution-3-neutral.png" });
});
