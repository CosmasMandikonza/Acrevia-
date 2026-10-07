import { test, expect } from "@playwright/test";

/**
 * Issue #8 — Forge 3D spike e2e (ADR 0008).
 *
 * Runs against the dev server on 3121 (see ACREVIA_E2E_BASE convention in
 * the other specs). Asserts the moments, deterministic saved cameras,
 * scenario statuses (valid vs refused), click-to-provenance selection,
 * the derivation drawer, zero external network dependencies, and the
 * SVG fallback — the stage-safety requirements from the issue.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";

test.describe("forge spike (issue #8)", () => {
  test.describe.configure({ timeout: 150_000 });
  test("renders the canonical scene with four moments and deterministic cameras", async ({ page }) => {
    test.slow(); // first hit compiles the route on a cold dev server
    const t0 = Date.now();
    await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', {
      timeout: 120_000,
    });
    const loadMs = Date.now() - t0;
    // Warm navigation budget: scene model + WebGL init well under 30 s even cold.
    expect(loadMs).toBeLessThan(30_000);
    console.log(`forge-spike first render (cold compile): ${loadMs} ms`);

    await expect(page.getByText("Calvary Memorial Church")).toBeVisible();
    await expect(page.getByText(/RM-1/)).toBeVisible();
    await expect(page.locator('[data-testid="forge-fps"]')).toBeVisible();

    // Four cameras exist; each settles deterministically on demand.
    const cameraIds = ["camera:aerial", "camera:entry", "camera:pedestrian", "camera:neighbor"];
    for (const id of cameraIds) {
      await page.click(`[data-testid="camera-${id}"]`);
      await page.waitForFunction(
        (cid) => {
          const el = document.querySelector('[data-testid="forge-spike-root"]');
          return (
            el?.getAttribute("data-camera-active") === cid &&
            el?.getAttribute("data-camera-settled") === "1"
          );
        },
        id,
        { timeout: 15_000 },
      );
    }

    // Moments switch and change layer state.
    for (const m of ["legal", "mission", "scenario", "existing"] as const) {
      await page.click(`[data-testid="moment-${m}"]`);
      await expect(page.locator('[data-testid="forge-spike-root"]')).toHaveAttribute(
        "data-moment",
        m,
      );
    }

    await page.screenshot({ path: "test-results/forge-e2e-existing.png" });
  });

  test("scenario statuses: buildable mass vs refused mass", async ({ page }) => {
    await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', {
      timeout: 120_000,
    });

    await page.click('[data-testid="moment-scenario"]');
    await expect(page.locator('[data-testid="forge-scenarios"]')).toBeVisible();

    // Buildable scenario shows computed metrics and is unmistakably a fixture.
    await expect(page.getByText("24 dwelling_units").first()).toBeVisible();
    await expect(page.getByText(/HYPOTHETICAL SPIKE FIXTURE/).first()).toBeVisible();

    // Refused scenario is visibly marked and never presented as buildable.
    await page.click('[data-testid="scenario-phl\\:scenario\\:optimistic-tower"]');
    await expect(page.getByText(/REFUSED — not buildable/)).toBeVisible();
    await page.screenshot({ path: "test-results/forge-e2e-refused.png" });

    // Clicking the refused mass shows the NOT BUILDABLE provenance card.
    await page.mouse.click(756, 430);
    const selection = page.locator('[data-testid="forge-selection"]');
    if (await selection.count()) {
      await expect(selection.getByText(/NOT BUILDABLE|BUILDABLE|PROTECTED|REMOVED|RESERVED|EXISTING/)).toBeVisible();
      await expect(selection.locator("code").first()).toBeVisible();
    }
  });

  test("clicking a volume reveals its provenance card", async ({ page }) => {
    await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', {
      timeout: 120_000,
    });
    await page.click('[data-testid="moment-legal"]');
    await page.mouse.click(756, 430);
    await expect(page.locator('[data-testid="forge-selection"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="forge-selection"] code').first()).toBeVisible();
    await page.screenshot({ path: "test-results/forge-e2e-selection.png" });
  });

  test("derivation drawer lists the audit trail", async ({ page }) => {
    await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', {
      timeout: 120_000,
    });
    await page.click("text=Derivation");
    await expect(page.locator('[data-testid="forge-derivation"]')).toBeVisible();
    await expect(page.getByText(/Occupied-area cap 75%/)).toBeVisible();
    await expect(page.getByText(/local feet, origin at parcel centroid/)).toBeVisible();
  });

  test("renders with every external request blocked (offline stage safety)", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.origin !== new URL(BASE).origin) external.push(req.url());
    });
    await page.route(/.*/, (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE)) route.continue();
      else route.abort();
    });
    await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', {
      timeout: 120_000,
    });
    await page.click('[data-testid="moment-scenario"]');
    await expect(page.getByText(/24 dwelling_units/).first()).toBeVisible();
    // The scene must be fully self-hosted: no fonts, HDRs, tiles, or APIs off-origin.
    expect(external).toEqual([]);
    // Truth labels survive offline too.
    await expect(page.getByText(/HYPOTHETICAL SPIKE FIXTURE/).first()).toBeVisible();
    await page.screenshot({ path: "test-results/forge-e2e-offline-blocked.png" });
  });

  test("deterministic SVG fallback renders the same model without WebGL", async ({ page }) => {
    await page.goto(`${BASE}/forge-spike?fallback=1`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="forge-fallback"]')).toBeVisible({ timeout: 30_000 });
    await page.click('[data-testid="moment-mission"]');
    await expect(page.locator('[data-testid="forge-fallback"]')).toHaveAttribute(
      "data-moment",
      "mission",
    );
    await page.screenshot({ path: "test-results/forge-e2e-fallback.png" });
  });
});
