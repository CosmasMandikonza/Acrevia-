import { test, expect, type Page } from "@playwright/test";

/**
 * Site browser hardening (feat/site-browser-hardening).
 *
 * Covers the failure/restore behaviors discovered by interactive browser QA:
 * visible NO_MATCH failures, pre-accept facts, single-commit double-click
 * protection, and the session-restore trust invariant — sessionStorage is
 * never a source of verified truth. A stored envelope restores only after the
 * server re-verifies its full-session signature (POST /api/gis/verify);
 * tampered storage is discarded and never displayed.
 *
 * Run against a running Acrevia server (default: local dev server on 3121):
 *   ACREVIA_E2E_BASE=http://localhost:3121 npx playwright test tests/e2e/site-hardening.spec.ts
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;

async function resolveCanonical(page: Page) {
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  // Pre-accept context: zoning/structure facts render before acceptance.
  await expect(page.getByText(/RM-1/).first()).toBeVisible({ timeout: 60_000 });
}

async function acceptProperty(page: Page) {
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
}

test("short-address failure is visible and actionable", async ({ page }) => {
  await page.goto(CANONICAL);
  await page.fill("#site-address", "7200 Roosevelt Blvd");
  await page.getByRole("button", { name: /resolve property/i }).click();

  // Next.js also mounts an empty route-announcer div[role=alert]; scope to the
  // resolution failure paragraph.
  const alert = page.locator('p[role="alert"]');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/no match in the public address registry/i);
  await expect(alert).toContainText(/add the city and state/i);
  await expect(alert.getByRole("button", { name: /try again/i })).toBeVisible();
  // No geometry was resolved, so none is displayed as fact.
  await expect(page.getByTestId("parcel-geometry")).toHaveCount(0);
});

test("double-click Accept commits exactly once", async ({ page }) => {
  await resolveCanonical(page);

  let commitPosts = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/gis/commit") && request.method() === "POST") {
      commitPosts += 1;
    }
  });

  await page.getByRole("button", { name: /accept this property/i }).click({ clickCount: 2 });
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  // Give any stray second commit a moment to fire before asserting the count.
  await page.waitForTimeout(1500);
  expect(commitPosts).toBe(1);
});

test("valid signed envelope restores the accepted state after reload", async ({ page }) => {
  await resolveCanonical(page);
  await acceptProperty(page);
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });

  // The stored envelope must pass server verification before any of this renders.
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/RM-1/i).first()).toBeVisible();
  await expect(page.locator(".toolbar-status")).toContainText(/revision \d+/);
  await expect(page.locator('section[aria-label="Evidence"] li')).not.toHaveCount(0);
});

test("tampered sessionStorage envelope is rejected and discarded on reload", async ({ page }) => {
  await resolveCanonical(page);
  await acceptProperty(page);

  // Forge provider-derived facts in storage: zoning district, owner name, and
  // parcel geometry inside the signed envelope, plus an owner in the display record.
  await page.evaluate(() => {
    const ENVELOPE_KEY = "acrevia.accepted-envelope";
    const RECORD_KEY = "acrevia.accepted-property";
    const stored = JSON.parse(window.sessionStorage.getItem(ENVELOPE_KEY) ?? "{}");
    stored.envelope.session.parcelContexts[0].zoningBase.district = "CA-999-TAMPERED";
    stored.envelope.session.parcelCandidates[0].ownerName = "TAMPERED OWNER LLC";
    stored.envelope.session.parcelCandidates[0].geometry = {
      type: "Polygon",
      coordinates: [
        [
          [-74.0, 40.0],
          [-74.001, 40.0],
          [-74.001, 40.001],
          [-74.0, 40.001],
          [-74.0, 40.0],
        ],
      ],
    };
    window.sessionStorage.setItem(ENVELOPE_KEY, JSON.stringify(stored));
    const record = JSON.parse(window.sessionStorage.getItem(RECORD_KEY) ?? "{}");
    record.ownerName = "TAMPERED OWNER LLC";
    record.zoningSummary = "CA-999-TAMPERED";
    window.sessionStorage.setItem(RECORD_KEY, JSON.stringify(record));
  });

  const verifyFailed = page.waitForResponse(
    (response) => response.url().includes("/api/gis/verify") && response.status() === 400,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyFailed;

  // Corrupted state is discarded: no accepted state, no forged facts displayed.
  await page.waitForTimeout(1500);
  await expect(page.getByRole("heading", { name: /property accepted/i })).toHaveCount(0);
  await expect(page.getByText(/TAMPERED OWNER LLC/i)).toHaveCount(0);
  await expect(page.getByText(/CA-999-TAMPERED/i)).toHaveCount(0);
  await expect(page.locator(".toolbar-status")).toContainText(/ready to resolve/i);

  const storage = await page.evaluate(() => ({
    envelope: window.sessionStorage.getItem("acrevia.accepted-envelope"),
    record: window.sessionStorage.getItem("acrevia.accepted-property"),
  }));
  expect(storage.envelope).toBeNull();
  expect(storage.record).toBeNull();
});
